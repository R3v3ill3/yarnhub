import type { SupabaseClient } from "@supabase/supabase-js";
import { computeSendBefore, isWithinSendWindow } from "@/lib/sms/blackout";
import { resolveBlastBody, screenBlastRecipient } from "@/lib/sms/blast-body";
import { validateSmsBody } from "@/lib/sms/compliance";
import type { SmsProvider, OutboundSms, SendResult } from "@/lib/sms/provider";
import { gatedProviderFactory } from "@/lib/sms/send-guard";
import { countSegments } from "@/lib/sms/segments";
import { isInboxUnsafePurpose } from "@/lib/sms/sender-purpose";
import { appendOutboundMessage, upsertOutboundThread } from "@/lib/sms/thread-write";

const WRITE_CHUNK = 25;
const STALE_CLAIM_MINUTES = 15;
export const P2P_RUN_BATCH_CAP = 50;

export interface P2pDispatchSummary {
  sends_seen: number;
  sends_blocked_by_window: string[];
  sends_paused_non_compliant: string[];
  sends_completed: string[];
  stale_claims_recovered: number;
  sent: number;
  blocked: number;
  failed: number;
  opted_out: number;
  skipped: number;
  errors: Array<{ send_id: string; error: string }>;
}

interface P2pSendRow {
  id: string;
  organisation_id: string;
  body_template: string;
  sender_number_id: string;
  timezone: string;
  blackout_override: boolean;
  status: string;
  created_by: string | null;
}

interface ItemRow {
  id: string;
  contact_id: string;
  phone_e164: string;
  body: string;
  sort_order: number;
}

interface ContactRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone_e164: string;
  sms_opt_out: boolean;
}

async function inChunks<T>(items: T[], fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += WRITE_CHUNK) {
    await Promise.all(items.slice(i, i + WRITE_CHUNK).map(fn));
  }
}

async function countItems(
  admin: SupabaseClient,
  sendId: string,
  statuses: string[],
): Promise<number> {
  const { count } = await admin
    .from("sms_p2p_send_items")
    .select("id", { count: "exact", head: true })
    .eq("send_id", sendId)
    .in("status", statuses);
  return count ?? 0;
}

async function mirrorSuccessfulSends(
  admin: SupabaseClient,
  args: {
    orgId: string;
    ourNumberId: string;
    senderUserId: string | null;
    sends: Array<{
      contactId: string;
      phoneE164: string;
      providerMessageId: string | null;
      body: string;
    }>;
  },
): Promise<void> {
  if (args.sends.length === 0) return;
  const sentAt = new Date().toISOString();
  for (const send of args.sends) {
    const conversationId = await upsertOutboundThread(admin, {
      orgId: args.orgId,
      ourNumberId: args.ourNumberId,
      phoneE164: send.phoneE164,
      contactId: send.contactId,
      sentAt,
    });
    await appendOutboundMessage(admin, {
      orgId: args.orgId,
      conversationId,
      body: send.body,
      phoneE164: send.phoneE164,
      senderUserId: args.senderUserId,
      providerMessageId: send.providerMessageId,
      status: "sent",
    });
  }
}

export async function dispatchDueP2pSends(
  admin: SupabaseClient,
  now: Date = new Date(),
  getProvider: (orgId: string) => Promise<SmsProvider> = gatedProviderFactory(admin),
): Promise<P2pDispatchSummary> {
  const summary: P2pDispatchSummary = {
    sends_seen: 0,
    sends_blocked_by_window: [],
    sends_paused_non_compliant: [],
    sends_completed: [],
    stale_claims_recovered: 0,
    sent: 0,
    blocked: 0,
    failed: 0,
    opted_out: 0,
    skipped: 0,
    errors: [],
  };

  const staleCutoff = new Date(
    now.getTime() - STALE_CLAIM_MINUTES * 60 * 1000,
  ).toISOString();
  const { data: recovered, error: recoverErr } = await admin
    .from("sms_p2p_send_items")
    .update({ status: "queued", claimed_at: null })
    .eq("status", "sending")
    .lt("claimed_at", staleCutoff)
    .select("id");
  if (recoverErr) {
    console.error("dispatch-p2p: stale-claim recovery failed:", recoverErr);
  } else {
    summary.stale_claims_recovered = recovered?.length ?? 0;
  }

  const { data: sendsRaw, error: sendErr } = await admin
    .from("sms_p2p_sends")
    .select(
      "id, organisation_id, body_template, sender_number_id, timezone, blackout_override, status, created_by",
    )
    .in("status", ["queued", "sending"])
    .order("created_at", { ascending: true });
  if (sendErr) throw sendErr;

  const sends = (sendsRaw ?? []) as P2pSendRow[];
  summary.sends_seen = sends.length;
  let capacity = P2P_RUN_BATCH_CAP;
  const providers = new Map<string, SmsProvider>();

  for (const send of sends) {
    if (capacity <= 0) break;
    const tz = send.timezone;

    try {
      if (!send.blackout_override && !isWithinSendWindow(now, tz)) {
        summary.sends_blocked_by_window.push(send.id);
        const nextBefore = computeSendBefore(now, tz, false);
        await admin
          .from("sms_p2p_send_items")
          .update({ send_before: nextBefore.toISOString() })
          .eq("send_id", send.id)
          .eq("status", "queued")
          .lt("send_before", now.toISOString());
        continue;
      }

      const { data: candidates } = await admin
        .from("sms_p2p_send_items")
        .select("id")
        .eq("send_id", send.id)
        .eq("status", "queued")
        .order("sort_order", { ascending: true })
        .limit(capacity);

      if (!candidates?.length) {
        const remaining = await countItems(admin, send.id, ["queued", "sending"]);
        if (remaining === 0 && send.status === "sending") {
          await admin
            .from("sms_p2p_sends")
            .update({ status: "sent", completed_at: now.toISOString() })
            .eq("id", send.id);
          summary.sends_completed.push(send.id);
        }
        continue;
      }

      const template = send.body_template.trim();
      if (!template) throw new Error("P2P body is empty");

      const { data: org } = await admin
        .from("organisations")
        .select("name")
        .eq("id", send.organisation_id)
        .single();
      const compliance = validateSmsBody(template, org?.name ?? "");
      if (!compliance.ok) {
        await admin.from("sms_p2p_sends").update({ status: "paused" }).eq("id", send.id);
        summary.sends_paused_non_compliant.push(send.id);
        summary.errors.push({
          send_id: send.id,
          error: `Paused — non-compliant body: ${compliance.errors.join(" ")}`,
        });
        continue;
      }

      const { data: sender } = await admin
        .from("sms_numbers")
        .select("id, phone_e164, purpose, status")
        .eq("id", send.sender_number_id)
        .eq("organisation_id", send.organisation_id)
        .maybeSingle();
      if (!sender || sender.status !== "active") {
        throw new Error("Sender number missing or retired");
      }
      if (isInboxUnsafePurpose(sender.purpose)) {
        await admin.from("sms_p2p_sends").update({ status: "paused" }).eq("id", send.id);
        summary.errors.push({
          send_id: send.id,
          error: "Paused — sender is reserved for surveys or relays",
        });
        continue;
      }

      if (send.status === "queued") {
        await admin.from("sms_p2p_sends").update({ status: "sending" }).eq("id", send.id);
      }

      const { data: claimedRaw, error: claimErr } = await admin
        .from("sms_p2p_send_items")
        .update({ status: "sending", claimed_at: now.toISOString() })
        .in(
          "id",
          candidates.map((c) => c.id),
        )
        .eq("status", "queued")
        .select("id, contact_id, phone_e164, body, sort_order");
      if (claimErr) throw claimErr;
      const claimed = ((claimedRaw ?? []) as ItemRow[]).sort(
        (a, b) => a.sort_order - b.sort_order,
      );
      capacity -= claimed.length;
      if (claimed.length === 0) continue;

      const contactIds = claimed.map((i) => i.contact_id);
      const contactById = new Map<string, ContactRow>();
      const { data: contacts } = await admin
        .from("contacts")
        .select("id, first_name, last_name, phone_e164, sms_opt_out")
        .eq("organisation_id", send.organisation_id)
        .in("id", contactIds);
      for (const c of (contacts ?? []) as ContactRow[]) {
        contactById.set(c.id, c);
      }

      const sendable: Array<{ item: ItemRow; contact: ContactRow; to: string; body: string }> =
        [];
      const screenedOut: Array<{ item: ItemRow; status: string; reason: string }> = [];
      for (const item of claimed) {
        const contact = contactById.get(item.contact_id);
        if (!contact) {
          screenedOut.push({ item, status: "skipped", reason: "Contact not found" });
          continue;
        }
        const screened = screenBlastRecipient({
          sms_opt_out: contact.sms_opt_out,
          phone_e164: item.phone_e164 || contact.phone_e164,
        });
        if (!screened.ok) {
          screenedOut.push({ item, status: screened.status, reason: screened.reason });
          continue;
        }
        const body =
          item.body.trim() ||
          resolveBlastBody(template, {
            first_name: contact.first_name ?? undefined,
            last_name: contact.last_name ?? undefined,
            org_name: org?.name,
          });
        sendable.push({ item, contact, to: screened.to, body });
      }

      await inChunks(screenedOut, async ({ item, status, reason }) => {
        await admin
          .from("sms_p2p_send_items")
          .update({ status, failure_reason: reason })
          .eq("id", item.id)
          .eq("status", "sending");
      });
      summary.opted_out += screenedOut.filter((s) => s.status === "opted_out").length;
      summary.skipped += screenedOut.filter((s) => s.status === "skipped").length;

      if (sendable.length > 0) {
        const logRows = sendable.map(({ item, contact, to, body }) => ({
          organisation_id: send.organisation_id,
          p2p_item_id: item.id,
          contact_id: contact.id,
          phone_e164: to,
          body,
          segments: countSegments(body).segments,
          status: "queued",
        }));
        const { data: sendLogRows, error: logErr } = await admin
          .from("sms_send_log")
          .upsert(logRows, { onConflict: "p2p_item_id" })
          .select("id, p2p_item_id");
        if (logErr) throw logErr;
        const sendIdByItem = new Map<string, string>(
          (sendLogRows ?? []).map((r) => [r.p2p_item_id as string, r.id as string]),
        );

        const batch: OutboundSms[] = sendable.map(({ item, to, body }) => ({
          to,
          body,
          sender: sender.phone_e164 as string,
          customRef: sendIdByItem.get(item.id) ?? item.id,
        }));

        let provider = providers.get(send.organisation_id);
        if (!provider) {
          provider = await getProvider(send.organisation_id);
          providers.set(send.organisation_id, provider);
        }

        const firstId = sendable[0].item.id;
        const lastId = sendable[sendable.length - 1].item.id;
        const idempotencyKey = `sms-p2p-${send.id}-${firstId}-${lastId}`;
        let results: SendResult[];
        try {
          results = await provider.sendBatch(batch, { idempotencyKey });
        } catch (sendErr) {
          const reason =
            sendErr instanceof Error ? sendErr.message : "Provider send failed";
          await inChunks(sendable, async ({ item }) => {
            await admin
              .from("sms_p2p_send_items")
              .update({ status: "failed", failure_reason: reason })
              .eq("id", item.id)
              .eq("status", "sending");
          });
          summary.failed += sendable.length;
          throw sendErr;
        }

        const successes: Array<{
          contactId: string;
          phoneE164: string;
          providerMessageId: string | null;
          body: string;
        }> = [];

        await inChunks(
          sendable.map((s, i) => ({ ...s, result: results[i] })),
          async ({ item, contact, to, body, result }) => {
            const logId = sendIdByItem.get(item.id);
            const sentAt = new Date().toISOString();
            if (result?.status === "success") {
              await admin
                .from("sms_p2p_send_items")
                .update({
                  status: "sent",
                  provider_message_id: result.providerMessageId,
                  sent_at: sentAt,
                  failure_reason: null,
                })
                .eq("id", item.id);
              if (logId) {
                await admin
                  .from("sms_send_log")
                  .update({
                    status: "sent",
                    provider_message_id: result.providerMessageId,
                    sent_at: sentAt,
                    cost: result.cost ?? null,
                  })
                  .eq("id", logId);
              }
              successes.push({
                contactId: contact.id,
                phoneE164: to,
                providerMessageId: result.providerMessageId,
                body,
              });
              summary.sent += 1;
            } else if (result?.status === "blocked") {
              await admin
                .from("sms_p2p_send_items")
                .update({
                  status: "blocked",
                  failure_reason: "Recipient unsubscribed at provider",
                })
                .eq("id", item.id);
              if (logId) {
                await admin
                  .from("sms_send_log")
                  .update({
                    status: "blocked",
                    failure_reason: "Recipient unsubscribed at provider",
                  })
                  .eq("id", logId);
              }
              await admin
                .from("contacts")
                .update({
                  sms_opt_out: true,
                  sms_opt_out_at: sentAt,
                  sms_opt_out_source: "provider_unsubscribe",
                })
                .eq("id", contact.id)
                .eq("sms_opt_out", false);
              summary.blocked += 1;
            } else {
              const reason = result?.error ?? "Provider send failed";
              await admin
                .from("sms_p2p_send_items")
                .update({ status: "failed", failure_reason: reason })
                .eq("id", item.id);
              if (logId) {
                await admin
                  .from("sms_send_log")
                  .update({
                    status: "failed",
                    failed_at: sentAt,
                    failure_reason: reason,
                  })
                  .eq("id", logId);
              }
              summary.failed += 1;
            }
          },
        );

        try {
          await mirrorSuccessfulSends(admin, {
            orgId: send.organisation_id,
            ourNumberId: sender.id as string,
            senderUserId: send.created_by,
            sends: successes,
          });
        } catch (mirrorErr) {
          console.error(`dispatch-p2p: conversation mirror failed for ${send.id}:`, mirrorErr);
        }
      }

      const remaining = await countItems(admin, send.id, ["queued", "sending"]);
      if (remaining === 0) {
        await admin
          .from("sms_p2p_sends")
          .update({ status: "sent", completed_at: now.toISOString() })
          .eq("id", send.id);
        summary.sends_completed.push(send.id);
      }
    } catch (err) {
      summary.errors.push({
        send_id: send.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}
