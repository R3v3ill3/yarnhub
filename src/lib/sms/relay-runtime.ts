import type { SupabaseClient } from "@supabase/supabase-js";
import type { SmsProvider, SendResult } from "@/lib/sms/provider";
import { isWithinSendWindow } from "@/lib/sms/blackout";
import { gatedProviderFactory } from "@/lib/sms/send-guard";
import {
  GENERIC_MEMBER_CONTEXT,
  RELAY_FIRST_FORWARD_CONFIRMATION,
  RELAY_PAUSED_REPLY,
  chooseBridgeMember,
  composeForwardBody,
  composeTargetReplyBody,
  decideMemberForward,
  matchPhoneInList,
  relayOptedOutReply,
  resolveRelayDirection,
  type RelayMemberContext,
} from "@/lib/sms/relay-engine";

const UNIQUE_VIOLATION = "23505";
const BRIDGE_CANDIDATE_LIMIT = 25;
const RELAY_FORWARD_RUN_CAP = 100;
const STALE_CLAIM_MINUTES = 15;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export const LIVE_RELAY_STATUSES = ["active", "paused"] as const;

export function isLiveRelayStatus(
  status: string | null | undefined,
): status is "active" | "paused" {
  return status === "active" || status === "paused";
}

export interface RelayRow {
  id: string;
  organisation_id: string;
  number_id: string;
  name: string;
  status: "active" | "paused" | "ended";
  prefix_template: string | null;
  suffix_template: string | null;
  timezone: string;
  quiet_hours_respected: boolean;
  moderation_required: boolean;
}

export interface RelayTargetRow {
  id: string;
  organisation_id: string;
  relay_id: string;
  phone_e164: string;
  display_name: string | null;
  is_active: boolean;
}

export async function findLiveRelayByNumberId(
  db: Db,
  orgId: string,
  numberId: string,
): Promise<RelayRow | null> {
  const { data, error } = await db
    .from("sms_relays")
    .select("*")
    .eq("organisation_id", orgId)
    .eq("number_id", numberId)
    .in("status", [...LIVE_RELAY_STATUSES])
    .limit(1);
  if (error) throw error;
  const relay = (data?.[0] as RelayRow | undefined) ?? null;
  if (!relay) return null;

  const { data: numberRow, error: numErr } = await db
    .from("sms_numbers")
    .select("purpose")
    .eq("id", numberId)
    .maybeSingle();
  if (numErr) throw numErr;
  if (numberRow?.purpose !== "relay") {
    console.warn(
      `relay ${relay.id} points at number ${numberId} with purpose ` +
        `'${numberRow?.purpose ?? "missing"}' — relay leg refused`,
    );
    return null;
  }
  return relay;
}

export async function loadRelayTargets(db: Db, relayId: string): Promise<RelayTargetRow[]> {
  const { data, error } = await db
    .from("sms_relay_targets")
    .select("*")
    .eq("relay_id", relayId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as RelayTargetRow[];
}

async function sendFromRelay(
  provider: SmsProvider,
  args: {
    to: string;
    body: string;
    senderDigits: string;
    customRef: string;
    idempotencyKey: string;
  },
): Promise<SendResult | null> {
  try {
    const results = await provider.sendBatch(
      [
        {
          to: args.to,
          body: args.body,
          sender: args.senderDigits,
          customRef: args.customRef,
        },
      ],
      { idempotencyKey: args.idempotencyKey },
    );
    return results[0] ?? null;
  } catch (err) {
    console.error(`relay send failed (${args.customRef}):`, err);
    return null;
  }
}

async function insertRelayMessage(
  db: Db,
  row: Record<string, unknown> & { organisation_id: string; provider_message_id: string | null },
): Promise<string | null> {
  if (row.provider_message_id) {
    const { data: existing } = await db
      .from("sms_relay_messages")
      .select("id")
      .eq("organisation_id", row.organisation_id)
      .eq("provider_message_id", row.provider_message_id)
      .maybeSingle();
    if (existing?.id) return null;
  }
  const { data, error } = await db.from("sms_relay_messages").insert(row).select("id").single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return null;
    throw error;
  }
  return data.id as string;
}

async function isPhoneOptedOut(db: Db, orgId: string, phoneE164: string): Promise<boolean> {
  const { data } = await db
    .from("contacts")
    .select("id")
    .eq("organisation_id", orgId)
    .eq("phone_e164", phoneE164)
    .eq("sms_opt_out", true)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function loadMemberContext(
  db: Db,
  orgId: string,
  contactId: string | null,
): Promise<RelayMemberContext> {
  if (!contactId) return GENERIC_MEMBER_CONTEXT;
  const { data } = await db
    .from("contacts")
    .select("first_name, last_name")
    .eq("id", contactId)
    .eq("organisation_id", orgId)
    .maybeSingle();
  if (!data) return GENERIC_MEMBER_CONTEXT;
  return {
    first_name: (data.first_name as string | null) ?? "",
    last_name: (data.last_name as string | null) ?? "",
    employer_name: "",
  };
}

async function findContactId(
  db: Db,
  orgId: string,
  phoneE164: string,
): Promise<string | null> {
  const { data } = await db
    .from("contacts")
    .select("id")
    .eq("organisation_id", orgId)
    .eq("phone_e164", phoneE164)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export interface RelayForwardOutcome {
  claimed: boolean;
  sent: number;
  failed: number;
  error?: string;
}

export async function forwardRelayMessageNow(
  db: Db,
  provider: SmsProvider,
  args: {
    relayMessageId: string;
    forwardedBody: string;
    senderDigits: string;
    destinations: Array<{ phone_e164: string }>;
  },
): Promise<RelayForwardOutcome> {
  const { relayMessageId, forwardedBody, senderDigits, destinations } = args;
  if (destinations.length === 0) {
    await db
      .from("sms_relay_messages")
      .update({ forward_status: "held" })
      .eq("id", relayMessageId)
      .eq("forward_status", "queued");
    return { claimed: false, sent: 0, failed: 0, error: "No active targets" };
  }

  const nowIso = new Date().toISOString();
  const { data: claimed, error: claimErr } = await db
    .from("sms_relay_messages")
    .update({ forward_status: "sending", claimed_at: nowIso })
    .eq("id", relayMessageId)
    .eq("forward_status", "queued")
    .select("id");
  if (claimErr) throw claimErr;
  if (!claimed || claimed.length === 0) {
    return { claimed: false, sent: 0, failed: 0 };
  }

  let results: SendResult[] | null = null;
  try {
    results = await provider.sendBatch(
      destinations.map((t) => ({
        to: t.phone_e164,
        body: forwardedBody,
        sender: senderDigits,
        customRef: `relay-fwd-${relayMessageId}`,
      })),
      { idempotencyKey: `sms-relay-fwd-${relayMessageId}` },
    );
  } catch (err) {
    console.error(`relay forward failed (message ${relayMessageId}) — reverting claim:`, err);
    await db
      .from("sms_relay_messages")
      .update({ forward_status: "queued", claimed_at: null })
      .eq("id", relayMessageId)
      .eq("forward_status", "sending");
    return {
      claimed: true,
      sent: 0,
      failed: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const successes = results.filter((r) => r.status === "success");
  const firstId =
    successes.find((r) => r.providerMessageId)?.providerMessageId ?? null;
  if (successes.length > 0) {
    await db
      .from("sms_relay_messages")
      .update({
        forward_status: "sent",
        forwarded_at: new Date().toISOString(),
        forward_provider_message_id: firstId,
      })
      .eq("id", relayMessageId)
      .eq("forward_status", "sending");
  } else {
    await db
      .from("sms_relay_messages")
      .update({ forward_status: "failed" })
      .eq("id", relayMessageId)
      .eq("forward_status", "sending");
  }
  return {
    claimed: true,
    sent: successes.length,
    failed: results.length - successes.length,
    error:
      successes.length === 0
        ? (results[0]?.error ?? "All target forwards failed")
        : undefined,
  };
}

export interface RelayInboundResult {
  handled: true;
  response: Record<string, unknown>;
}

export async function processRelayInbound(
  db: Db,
  provider: SmsProvider,
  args: {
    relay: RelayRow;
    number: { id: string; phone_e164: string };
    event: { from: string; body: string | null; providerMessageId: string | null };
    phoneE164: string | null;
    orgName: string;
    receivedAt: string;
  },
): Promise<RelayInboundResult> {
  const { relay, number, event, phoneE164, orgName, receivedAt } = args;
  const senderDigits = number.phone_e164.replace(/^\+/, "");
  const targets = await loadRelayTargets(db, relay.id);
  const direction = resolveRelayDirection(
    targets.map((t) => ({
      target_id: t.id,
      phone_e164: t.phone_e164,
      display_name: t.display_name,
      is_active: t.is_active,
    })),
    event.from,
  );

  if (direction.direction === "target_to_member") {
    const target = targets.find((t) => t.id === String(direction.target.target_id));
    const { data: candidatesRaw } = await db
      .from("sms_relay_messages")
      .select("id, contact_id, member_phone_e164, forwarded_at")
      .eq("relay_id", relay.id)
      .eq("direction", "member_to_target")
      .not("forwarded_at", "is", null)
      .order("forwarded_at", { ascending: false })
      .limit(BRIDGE_CANDIDATE_LIMIT);
    const candidates = (
      (candidatesRaw ?? []) as Array<{
        id: string;
        contact_id: string | null;
        member_phone_e164: string | null;
        forwarded_at: string | null;
      }>
    )
      .filter((c) => matchPhoneInList(targets, c.member_phone_e164) == null)
      .map((c) => ({
        relay_message_id: c.id,
        member_worker_id: c.contact_id,
        member_phone_e164: c.member_phone_e164,
        forwarded_at: c.forwarded_at,
      }));
    const bridge = chooseBridgeMember(candidates);

    let holdReason: string | null = null;
    if (!bridge) holdReason = "no_bridged_member";
    else if (relay.status === "paused") holdReason = "relay_paused";
    else if (await isPhoneOptedOut(db, relay.organisation_id, bridge.member_phone_e164 as string)) {
      holdReason = "member_opted_out";
    }

    const bridgeBody = composeTargetReplyBody(target?.display_name ?? null, event.body ?? "");
    const relayMessageId = await insertRelayMessage(db, {
      organisation_id: relay.organisation_id,
      relay_id: relay.id,
      direction: "target_to_member",
      contact_id: bridge?.member_worker_id ?? null,
      member_phone_e164: bridge?.member_phone_e164 ?? null,
      target_id: target?.id ?? null,
      body: event.body,
      forwarded_body: bridge ? bridgeBody : null,
      moderation_status: "auto_approved",
      provider_message_id: event.providerMessageId,
      forward_status: holdReason ? "held" : "queued",
      created_at: receivedAt,
    });
    if (relayMessageId == null) {
      return { handled: true, response: { ok: true, deduplicated: true } };
    }
    if (holdReason) {
      return {
        handled: true,
        response: { ok: true, relay_id: relay.id, held: holdReason },
      };
    }

    const outcome = await forwardRelayMessageNow(db, provider, {
      relayMessageId,
      forwardedBody: bridgeBody,
      senderDigits,
      destinations: [{ phone_e164: bridge!.member_phone_e164 as string }],
    });
    return {
      handled: true,
      response: {
        ok: true,
        relay_id: relay.id,
        bridged_to_member: outcome.sent > 0,
      },
    };
  }

  if (!phoneE164) {
    return { handled: true, response: { ok: true, unmatched: true } };
  }

  const contactId = await findContactId(db, relay.organisation_id, phoneE164);
  const optedOut = await isPhoneOptedOut(db, relay.organisation_id, phoneE164);
  if (optedOut) {
    const relayMessageId = await insertRelayMessage(db, {
      organisation_id: relay.organisation_id,
      relay_id: relay.id,
      direction: "member_to_target",
      contact_id: contactId,
      member_phone_e164: phoneE164,
      body: event.body,
      moderation_status: "auto_approved",
      provider_message_id: event.providerMessageId,
      forward_status: "held",
      created_at: receivedAt,
    });
    if (relayMessageId == null) {
      return { handled: true, response: { ok: true, deduplicated: true } };
    }
    await sendFromRelay(provider, {
      to: phoneE164,
      body: relayOptedOutReply(orgName),
      senderDigits,
      customRef: `relay-decline-${relayMessageId}`,
      idempotencyKey: `sms-relay-decline-${relayMessageId}`,
    });
    return {
      handled: true,
      response: { ok: true, relay_id: relay.id, held: "opted_out" },
    };
  }

  const context = await loadMemberContext(db, relay.organisation_id, contactId);
  const forwardedBody = composeForwardBody({
    prefixTemplate: relay.prefix_template,
    suffixTemplate: relay.suffix_template,
    memberBody: event.body ?? "",
    context,
  });

  if (!isLiveRelayStatus(relay.status)) {
    return { handled: true, response: { ok: true, relay_id: relay.id } };
  }

  const decision = decideMemberForward({
    relayStatus: relay.status,
    moderationRequired: relay.moderation_required,
    quietHoursRespected: relay.quiet_hours_respected,
    withinWindow: isWithinSendWindow(new Date(), relay.timezone),
  });

  const { count: priorCount } = await db
    .from("sms_relay_messages")
    .select("id", { count: "exact", head: true })
    .eq("relay_id", relay.id)
    .eq("direction", "member_to_target")
    .eq("member_phone_e164", phoneE164);
  const isFirstMessage = (priorCount ?? 0) === 0;

  const relayMessageId = await insertRelayMessage(db, {
    organisation_id: relay.organisation_id,
    relay_id: relay.id,
    direction: "member_to_target",
    contact_id: contactId,
    member_phone_e164: phoneE164,
    body: event.body,
    forwarded_body: forwardedBody,
    moderation_status:
      decision.kind === "pending_moderation" ? "pending" : "auto_approved",
    provider_message_id: event.providerMessageId,
    forward_status:
      decision.kind === "held_paused" || decision.kind === "pending_moderation"
        ? "held"
        : "queued",
    created_at: receivedAt,
  });
  if (relayMessageId == null) {
    return { handled: true, response: { ok: true, deduplicated: true } };
  }

  if (decision.kind === "held_paused") {
    await sendFromRelay(provider, {
      to: phoneE164,
      body: RELAY_PAUSED_REPLY,
      senderDigits,
      customRef: `relay-paused-${relayMessageId}`,
      idempotencyKey: `sms-relay-paused-${relayMessageId}`,
    });
    return {
      handled: true,
      response: { ok: true, relay_id: relay.id, held: "relay_paused" },
    };
  }
  if (decision.kind === "pending_moderation") {
    return {
      handled: true,
      response: { ok: true, relay_id: relay.id, moderation: "pending" },
    };
  }
  if (decision.kind === "deferred_quiet_hours") {
    return {
      handled: true,
      response: { ok: true, relay_id: relay.id, queued: "quiet_hours" },
    };
  }

  const outcome = await forwardRelayMessageNow(db, provider, {
    relayMessageId,
    forwardedBody,
    senderDigits,
    destinations: targets.filter((t) => t.is_active),
  });
  if (outcome.sent > 0 && isFirstMessage) {
    await sendFromRelay(provider, {
      to: phoneE164,
      body: RELAY_FIRST_FORWARD_CONFIRMATION,
      senderDigits,
      customRef: `relay-confirm-${relayMessageId}`,
      idempotencyKey: `sms-relay-confirm-${relayMessageId}`,
    });
  }
  return {
    handled: true,
    response: {
      ok: true,
      relay_id: relay.id,
      forwarded_to: outcome.sent,
      forward_failed: outcome.failed > 0 && outcome.sent === 0 ? true : undefined,
    },
  };
}

export interface RelayForwardsSummary {
  relays_seen: number;
  relays_blocked_by_window: string[];
  stale_claims_recovered: number;
  forwarded: number;
  failed: number;
  errors: Array<{ relay_id: string; error: string }>;
}

export async function processQueuedRelayForwards(
  db: Db,
  now: Date,
  getProvider: (orgId: string) => Promise<SmsProvider> = gatedProviderFactory(db),
): Promise<RelayForwardsSummary> {
  const summary: RelayForwardsSummary = {
    relays_seen: 0,
    relays_blocked_by_window: [],
    stale_claims_recovered: 0,
    forwarded: 0,
    failed: 0,
    errors: [],
  };

  const staleCutoff = new Date(
    now.getTime() - STALE_CLAIM_MINUTES * 60 * 1000,
  ).toISOString();
  const { data: recovered, error: recoverErr } = await db
    .from("sms_relay_messages")
    .update({ forward_status: "queued", claimed_at: null })
    .eq("forward_status", "sending")
    .lt("claimed_at", staleCutoff)
    .select("id");
  if (recoverErr) {
    console.error("relay forwards: stale-claim recovery failed:", recoverErr);
  } else {
    summary.stale_claims_recovered = recovered?.length ?? 0;
  }

  const { data: relaysRaw, error } = await db
    .from("sms_relays")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) {
    summary.errors.push({ relay_id: "", error: error.message });
    return summary;
  }
  const relays = (relaysRaw ?? []) as RelayRow[];
  summary.relays_seen = relays.length;
  let budget = RELAY_FORWARD_RUN_CAP;
  const providers = new Map<string, SmsProvider>();

  for (const relay of relays) {
    if (budget <= 0) break;
    try {
      if (relay.quiet_hours_respected && !isWithinSendWindow(now, relay.timezone)) {
        summary.relays_blocked_by_window.push(relay.id);
        continue;
      }

      const { data: queuedRaw } = await db
        .from("sms_relay_messages")
        .select("id, direction, forwarded_body, member_phone_e164")
        .eq("relay_id", relay.id)
        .eq("forward_status", "queued")
        .in("moderation_status", ["auto_approved", "approved"])
        .order("created_at", { ascending: true })
        .limit(budget);
      const queued = (queuedRaw ?? []) as Array<{
        id: string;
        direction: string;
        forwarded_body: string | null;
        member_phone_e164: string | null;
      }>;
      if (queued.length === 0) continue;

      const { data: numberRow } = await db
        .from("sms_numbers")
        .select("id, phone_e164, status")
        .eq("id", relay.number_id)
        .maybeSingle();
      if (!numberRow || numberRow.status !== "active") {
        throw new Error("Relay number missing or retired");
      }
      const senderDigits = (numberRow.phone_e164 as string).replace(/^\+/, "");
      const activeTargets = (await loadRelayTargets(db, relay.id)).filter((t) => t.is_active);

      let provider = providers.get(relay.organisation_id);
      if (!provider) {
        provider = await getProvider(relay.organisation_id);
        providers.set(relay.organisation_id, provider);
      }

      for (const row of queued) {
        if (budget <= 0) break;
        const destinations =
          row.direction === "member_to_target"
            ? activeTargets
            : row.member_phone_e164
              ? [{ phone_e164: row.member_phone_e164 }]
              : [];
        budget -= 1;
        const outcome = await forwardRelayMessageNow(db, provider, {
          relayMessageId: row.id,
          forwardedBody: row.forwarded_body ?? "",
          senderDigits,
          destinations,
        });
        if (!outcome.claimed) continue;
        if (outcome.sent > 0) summary.forwarded += 1;
        else {
          summary.failed += 1;
          if (outcome.error) {
            summary.errors.push({ relay_id: relay.id, error: outcome.error });
          }
        }
      }
    } catch (err) {
      summary.errors.push({
        relay_id: relay.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}
