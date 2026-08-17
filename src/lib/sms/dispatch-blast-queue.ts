import type { SupabaseClient } from "@supabase/supabase-js";
import { computeSendBefore, isWithinSendWindow } from "@/lib/sms/blackout";
import { resolveBlastBody, screenBlastRecipient } from "@/lib/sms/blast-body";
import { validateSmsBody } from "@/lib/sms/compliance";
import type { SmsProvider, OutboundSms, SendResult } from "@/lib/sms/provider";
import { gatedProviderFactory } from "@/lib/sms/send-guard";
import { countSegments } from "@/lib/sms/segments";
import { isInboxUnsafePurpose } from "@/lib/sms/sender-purpose";
import { appendOutboundMessage, upsertOutboundThread } from "@/lib/sms/thread-write";

export const RUN_BATCH_CAP = 500;
const WRITE_CHUNK = 25;
const STALE_CLAIM_MINUTES = 15;

export interface DispatchSummary {
  blasts_seen: number;
  blasts_blocked_by_window: string[];
  blasts_paused_non_compliant: string[];
  blasts_completed: string[];
  stale_claims_recovered: number;
  sent: number;
  blocked: number;
  failed: number;
  opted_out: number;
  skipped: number;
  errors: Array<{ blast_id: string; error: string }>;
}

interface BlastRow {
  id: string;
  organisation_id: string;
  body: string;
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
  blastId: string,
  statuses: string[],
): Promise<number> {
  const { count } = await admin
    .from("sms_blast_items")
    .select("id", { count: "exact", head: true })
    .eq("blast_id", blastId)
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

export async function dispatchDueBlasts(
  admin: SupabaseClient,
  now: Date = new Date(),
  getProvider: (orgId: string) => Promise<SmsProvider> = gatedProviderFactory(admin),
): Promise<DispatchSummary> {
  const summary: DispatchSummary = {
    blasts_seen: 0,
    blasts_blocked_by_window: [],
    blasts_paused_non_compliant: [],
    blasts_completed: [],
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
    .from("sms_blast_items")
    .update({ status: "queued", claimed_at: null })
    .eq("status", "sending")
    .lt("claimed_at", staleCutoff)
    .select("id");
  if (recoverErr) {
    console.error("dispatch-sms-queue: stale-claim recovery failed:", recoverErr);
  } else {
    summary.stale_claims_recovered = recovered?.length ?? 0;
  }

  const { data: blastsRaw, error: blastErr } = await admin
    .from("sms_blasts")
    .select(
      "id, organisation_id, body, sender_number_id, timezone, blackout_override, status, created_by",
    )
    .in("status", ["queued", "sending"])
    .or(`scheduled_for.is.null,scheduled_for.lte.${now.toISOString()}`)
    .order("created_at", { ascending: true });
  if (blastErr) throw blastErr;

  const blasts = (blastsRaw ?? []) as BlastRow[];
  summary.blasts_seen = blasts.length;
  let capacity = RUN_BATCH_CAP;
  const providers = new Map<string, SmsProvider>();

  for (const blast of blasts) {
    if (capacity <= 0) break;
    const tz = blast.timezone;

    try {
      if (!blast.blackout_override && !isWithinSendWindow(now, tz)) {
        summary.blasts_blocked_by_window.push(blast.id);
        const nextBefore = computeSendBefore(now, tz, false);
        await admin
          .from("sms_blast_items")
          .update({ send_before: nextBefore.toISOString() })
          .eq("blast_id", blast.id)
          .eq("status", "queued")
          .lt("send_before", now.toISOString());
        continue;
      }

      const { data: candidates } = await admin
        .from("sms_blast_items")
        .select("id")
        .eq("blast_id", blast.id)
        .eq("status", "queued")
        .order("sort_order", { ascending: true })
        .limit(capacity);

      if (!candidates?.length) {
        const remaining = await countItems(admin, blast.id, ["queued", "sending"]);
        if (remaining === 0 && blast.status === "sending") {
          await admin
            .from("sms_blasts")
            .update({ status: "sent", completed_at: now.toISOString() })
            .eq("id", blast.id);
          summary.blasts_completed.push(blast.id);
        }
        continue;
      }

      const template = blast.body.trim();
      if (!template) throw new Error("Blast body is empty");

      const { data: org } = await admin
        .from("organisations")
        .select("name")
        .eq("id", blast.organisation_id)
        .single();
      const compliance = validateSmsBody(template, org?.name ?? "");
      if (!compliance.ok) {
        await admin.from("sms_blasts").update({ status: "paused" }).eq("id", blast.id);
        summary.blasts_paused_non_compliant.push(blast.id);
        summary.errors.push({
          blast_id: blast.id,
          error: `Paused — non-compliant body: ${compliance.errors.join(" ")}`,
        });
        continue;
      }

      const { data: sender } = await admin
        .from("sms_numbers")
        .select("id, phone_e164, purpose, status, organisation_id")
        .eq("id", blast.sender_number_id)
        .eq("organisation_id", blast.organisation_id)
        .maybeSingle();
      if (!sender || sender.status !== "active") {
        throw new Error("Sender number missing or retired");
      }
      if (isInboxUnsafePurpose(sender.purpose)) {
        await admin.from("sms_blasts").update({ status: "paused" }).eq("id", blast.id);
        summary.errors.push({
          blast_id: blast.id,
          error: "Paused — sender is reserved for surveys or relays",
        });
        continue;
      }

      if (blast.status === "queued") {
        await admin.from("sms_blasts").update({ status: "sending" }).eq("id", blast.id);
      }

      const { data: claimedRaw, error: claimErr } = await admin
        .from("sms_blast_items")
        .update({ status: "sending", claimed_at: now.toISOString() })
        .in(
          "id",
          candidates.map((c) => c.id),
        )
        .eq("status", "queued")
        .select("id, contact_id, phone_e164, sort_order");
      if (claimErr) throw claimErr;
      const claimed = ((claimedRaw ?? []) as ItemRow[]).sort(
        (a, b) => a.sort_order - b.sort_order,
      );
      capacity -= claimed.length;
      if (claimed.length === 0) continue;

      const contactIds = claimed.map((i) => i.contact_id);
      const contactById = new Map<string, ContactRow>();
      for (let i = 0; i < contactIds.length; i += 500) {
        const { data: contacts } = await admin
          .from("contacts")
          .select("id, first_name, last_name, phone_e164, sms_opt_out")
          .eq("organisation_id", blast.organisation_id)
          .in("id", contactIds.slice(i, i + 500));
        for (const c of (contacts ?? []) as ContactRow[]) {
          contactById.set(c.id, c);
        }
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
        const body = resolveBlastBody(template, {
          first_name: contact.first_name ?? undefined,
          last_name: contact.last_name ?? undefined,
          org_name: org?.name,
        });
        sendable.push({ item, contact, to: screened.to, body });
      }

      await inChunks(screenedOut, async ({ item, status, reason }) => {
        await admin
          .from("sms_blast_items")
          .update({ status, failure_reason: reason })
          .eq("id", item.id)
          .eq("status", "sending");
      });
      summary.opted_out += screenedOut.filter((s) => s.status === "opted_out").length;
      summary.skipped += screenedOut.filter((s) => s.status === "skipped").length;

      if (sendable.length > 0) {
        const logRows = sendable.map(({ item, contact, to, body }) => ({
          organisation_id: blast.organisation_id,
          blast_id: blast.id,
          blast_item_id: item.id,
          contact_id: contact.id,
          phone_e164: to,
          body,
          segments: countSegments(body).segments,
          status: "queued",
        }));
        const { data: sendLogRows, error: logErr } = await admin
          .from("sms_send_log")
          .upsert(logRows, { onConflict: "blast_item_id" })
          .select("id, blast_item_id");
        if (logErr) throw logErr;
        const sendIdByItem = new Map<string, string>(
          (sendLogRows ?? []).map((r) => [r.blast_item_id as string, r.id as string]),
        );

        const batch: OutboundSms[] = sendable.map(({ item, to, body }) => ({
          to,
          body,
          sender: sender.phone_e164 as string,
          customRef: sendIdByItem.get(item.id) ?? item.id,
        }));

        let provider = providers.get(blast.organisation_id);
        if (!provider) {
          provider = await getProvider(blast.organisation_id);
          providers.set(blast.organisation_id, provider);
        }

        const firstId = sendable[0].item.id;
        const lastId = sendable[sendable.length - 1].item.id;
        const idempotencyKey = `sms-blast-${blast.id}-${firstId}-${lastId}`;
        let results: SendResult[];
        try {
          results = await provider.sendBatch(batch, { idempotencyKey });
        } catch (sendErr) {
          const reason =
            sendErr instanceof Error ? sendErr.message : "Provider send failed";
          console.error(
            `dispatch-sms-queue: whole-batch send failed for blast ${blast.id} ` +
              `(Idempotency-Key: ${idempotencyKey}): ${reason}`,
          );
          await inChunks(sendable, async ({ item }) => {
            await admin
              .from("sms_blast_items")
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
            const sendId = sendIdByItem.get(item.id);
            const sentAt = new Date().toISOString();
            if (result?.status === "success") {
              await admin
                .from("sms_blast_items")
                .update({
                  status: "sent",
                  provider_message_id: result.providerMessageId,
                  sent_at: sentAt,
                  failure_reason: null,
                })
                .eq("id", item.id);
              if (sendId) {
                await admin
                  .from("sms_send_log")
                  .update({
                    status: "sent",
                    provider_message_id: result.providerMessageId,
                    sent_at: sentAt,
                    cost: result.cost ?? null,
                  })
                  .eq("id", sendId);
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
                .from("sms_blast_items")
                .update({
                  status: "blocked",
                  failure_reason: "Recipient unsubscribed at provider",
                })
                .eq("id", item.id);
              if (sendId) {
                await admin
                  .from("sms_send_log")
                  .update({
                    status: "blocked",
                    failure_reason: "Recipient unsubscribed at provider",
                  })
                  .eq("id", sendId);
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
                .from("sms_blast_items")
                .update({ status: "failed", failure_reason: reason })
                .eq("id", item.id);
              if (sendId) {
                await admin
                  .from("sms_send_log")
                  .update({
                    status: "failed",
                    failed_at: sentAt,
                    failure_reason: reason,
                  })
                  .eq("id", sendId);
              }
              summary.failed += 1;
            }
          },
        );

        try {
          await mirrorSuccessfulSends(admin, {
            orgId: blast.organisation_id,
            ourNumberId: sender.id as string,
            senderUserId: blast.created_by,
            sends: successes,
          });
        } catch (mirrorErr) {
          console.error(
            `dispatch-sms-queue: conversation mirror failed for blast ${blast.id}:`,
            mirrorErr,
          );
        }
      }

      const remaining = await countItems(admin, blast.id, ["queued", "sending"]);
      if (remaining === 0) {
        await admin
          .from("sms_blasts")
          .update({ status: "sent", completed_at: now.toISOString() })
          .eq("id", blast.id);
        summary.blasts_completed.push(blast.id);
      }
    } catch (err) {
      summary.errors.push({
        blast_id: blast.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}
