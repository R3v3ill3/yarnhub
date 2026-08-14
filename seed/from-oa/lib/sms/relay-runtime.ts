/**
 * Server-side relay runtime (brief §6, Phase 6) — the I/O layer
 * around the pure engine in `relay-engine.ts`. Shared by the webhook
 * relay leg (both directions), the timers cron (quiet-hours-deferred
 * forwards), and the moderation route (approve → forward now).
 *
 * Everything here runs on the SERVICE-ROLE client: all three relay
 * tables are service-role-write-only. Relay configuration is gated
 * by explicit can_write_to_campaign checks in the management routes;
 * the webhook trusts the stored relay row PLUS the number-purpose
 * belt in findLiveRelayByNumberId (purpose must be 'relay').
 *
 * Conversation policy (decided in-phase, per the Phase 6 plan):
 * relay traffic creates NO sms_conversations rows — it is a distinct
 * surface with its own log — but worker-matched member messages DO
 * insert sms_interactions rows (no activity/cta fields) so the
 * worker history shows them.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SmsProvider, SendResult } from "@/lib/sms/provider";
import { isWithinSendWindow } from "@/lib/sms/blackout";
import {
  GENERIC_MEMBER_CONTEXT,
  RELAY_FIRST_FORWARD_CONFIRMATION,
  RELAY_OPTED_OUT_REPLY,
  RELAY_PAUSED_REPLY,
  chooseBridgeMember,
  composeForwardBody,
  composeTargetReplyBody,
  decideMemberForward,
  matchPhoneInList,
  resolveRelayDirection,
  type RelayMemberContext,
} from "@/lib/sms/relay-engine";
import type {
  SmsRelayMessageRow,
  SmsRelayRow,
  SmsRelayTargetRow,
} from "@/types/sms";

const UNIQUE_VIOLATION = "23505";
/** sms_interactions.phone_number is VARCHAR(30) — clamp provider input. */
const PHONE_NUMBER_MAX = 30;
/** Bridging-map lookback (rows fetched for chooseBridgeMember). */
const BRIDGE_CANDIDATE_LIMIT = 25;
/** Deferred forwards processed per cron run. */
const RELAY_FORWARD_RUN_CAP = 100;
/** 'sending' claims older than this are assumed crashed and re-queued. */
const STALE_CLAIM_MINUTES = 15;

// Untyped admin/service client (relay tables are not in generated
// types until the migration is applied).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

/** The relay statuses the webhook leg intercepts a number for. */
export const LIVE_RELAY_STATUSES = ["active", "paused"] as const;

/**
 * The one live (active|paused) relay on a number — the partial
 * unique index guarantees at most one exists. An 'ended' relay
 * releases the number back to normal conversation routing.
 *
 * Belt (routing-hijack guard): the number itself must carry
 * purpose 'relay' in sms_numbers — assign_sms_number is the only
 * writer of purpose, and it is admin-gated. Even if a rogue relay
 * row appeared pointing at an organiser/survey number, it never
 * routes: the relay leg stays inert and conversational routing
 * proceeds untouched.
 */
export async function findLiveRelayByNumberId(
  db: Db,
  numberId: number,
): Promise<SmsRelayRow | null> {
  const { data, error } = await db
    .from("sms_relays")
    .select("*")
    .eq("number_id", numberId)
    .in("status", [...LIVE_RELAY_STATUSES])
    .limit(1);
  if (error) throw error;
  const relay = (data?.[0] as SmsRelayRow | undefined) ?? null;
  if (!relay) return null;

  const { data: numberRow, error: numErr } = await db
    .from("sms_numbers")
    .select("purpose")
    .eq("number_id", numberId)
    .maybeSingle();
  if (numErr) throw numErr;
  if (numberRow?.purpose !== "relay") {
    console.warn(
      `relay ${relay.relay_id} points at number ${numberId} with purpose ` +
        `'${numberRow?.purpose ?? "missing"}' — relay leg refused (routing-hijack guard)`,
    );
    return null;
  }
  return relay;
}

export async function loadRelayTargets(
  db: Db,
  relayId: number,
): Promise<SmsRelayTargetRow[]> {
  const { data, error } = await db
    .from("sms_relay_targets")
    .select("*")
    .eq("relay_id", relayId)
    .order("target_id", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SmsRelayTargetRow[];
}

/** Provider send wrapper — a throw returns null (caller decides). */
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

/**
 * Insert a relay-message row, idempotent on provider_message_id.
 * Returns the row id when NEW, null on redelivery (the gate for
 * every side effect).
 */
async function insertRelayMessage(
  db: Db,
  row: Record<string, unknown> & { provider_message_id: string | null },
): Promise<number | null> {
  if (row.provider_message_id) {
    const { data, error } = await db
      .from("sms_relay_messages")
      .upsert(row, {
        onConflict: "provider_message_id",
        ignoreDuplicates: true,
      })
      .select("relay_message_id");
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return null;
      throw error;
    }
    return (data?.[0]?.relay_message_id as number | undefined) ?? null;
  }
  const { data, error } = await db
    .from("sms_relay_messages")
    .insert(row)
    .select("relay_message_id")
    .single();
  if (error) throw error;
  return data.relay_message_id as number;
}

/**
 * Worker-history record for a worker-matched member message (the
 * Phase 1 idiom: no activity/cta/maps fields, so trg_sms_to_rating
 * stays a no-op). Deduped on external_message_id.
 */
async function insertRelayInteraction(
  db: Db,
  args: {
    workerId: number;
    campaignId: number | null;
    fromRaw: string;
    phoneE164: string;
    body: string | null;
    providerMessageId: string | null;
    receivedAt: string;
  },
): Promise<void> {
  if (args.providerMessageId) {
    const { data: existing } = await db
      .from("sms_interactions")
      .select("id")
      .eq("external_message_id", args.providerMessageId)
      .maybeSingle();
    if (existing) return;
  }
  const { error } = await db.from("sms_interactions").insert({
    worker_id: args.workerId,
    campaign_id: args.campaignId,
    direction: "inbound",
    phone_number: args.fromRaw.slice(0, PHONE_NUMBER_MAX),
    phone_e164: args.phoneE164,
    body: args.body,
    external_message_id: args.providerMessageId,
    received_at: args.receivedAt,
    notes: "SMS relay (member message)",
  });
  if (error && error.code !== UNIQUE_VIOLATION) {
    console.error("relay interaction insert failed:", error);
  }
}

/** True when any worker on this phone has opted out. */
async function isPhoneOptedOut(db: Db, phoneE164: string): Promise<boolean> {
  const { data } = await db
    .from("workers")
    .select("worker_id")
    .eq("phone_e164", phoneE164)
    .eq("sms_opt_out", true)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

/** Worker merge-field context for prefix/suffix rendering. */
async function loadMemberContext(
  db: Db,
  workerId: number | null,
): Promise<RelayMemberContext> {
  if (workerId == null) return GENERIC_MEMBER_CONTEXT;
  const { data } = await db
    .from("workers")
    .select("first_name, last_name, employers(employer_name)")
    .eq("worker_id", workerId)
    .maybeSingle();
  if (!data) return GENERIC_MEMBER_CONTEXT;
  const employer = data.employers as
    | { employer_name: string | null }
    | { employer_name: string | null }[]
    | null;
  const employerName = Array.isArray(employer)
    ? (employer[0]?.employer_name ?? "")
    : (employer?.employer_name ?? "");
  return {
    first_name: (data.first_name as string | null) ?? "",
    last_name: (data.last_name as string | null) ?? "",
    employer_name: employerName ?? "",
  };
}

export interface RelayForwardOutcome {
  claimed: boolean;
  sent: number;
  failed: number;
  error?: string;
}

/**
 * The single forward path for BOTH directions (webhook forward-now,
 * cron drain, moderation approve). Dispatch-queue claim idiom:
 * 'queued' → 'sending' + claimed_at (guarded — overlapping runs
 * lose the claim), send the stored forwarded_body to every
 * destination from the relay number, then 'sending' → 'sent' +
 * forwarded_at on ANY success (first forward's provider id
 * recorded). forwarded_at is stamped ONLY after a successful
 * provider result — a never-delivered message must not become a
 * bridging-map candidate. All-failed → 'failed'; a provider THROW
 * reverts the claim to 'queued' so a later tick retries; claims
 * stranded by a crash are swept back to 'queued' by the cron.
 */
export async function forwardRelayMessageNow(
  db: Db,
  provider: SmsProvider,
  args: {
    relayMessageId: number;
    forwardedBody: string;
    senderDigits: string;
    /** member→target: all active targets; target→member: the bridged member. */
    destinations: Array<{ phone_e164: string }>;
  },
): Promise<RelayForwardOutcome> {
  const { relayMessageId, forwardedBody, senderDigits, destinations } = args;
  if (destinations.length === 0) {
    // Nothing to forward to: hold rather than fail — staff can add
    // a target and the row stays visible in the log.
    await db
      .from("sms_relay_messages")
      .update({ forward_status: "held" })
      .eq("relay_message_id", relayMessageId)
      .eq("forward_status", "queued");
    return { claimed: false, sent: 0, failed: 0, error: "No active targets" };
  }

  const nowIso = new Date().toISOString();
  const { data: claimed, error: claimErr } = await db
    .from("sms_relay_messages")
    .update({ forward_status: "sending", claimed_at: nowIso })
    .eq("relay_message_id", relayMessageId)
    .eq("forward_status", "queued")
    .select("relay_message_id");
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
    console.error(
      `relay forward failed (message ${relayMessageId}) — reverting claim:`,
      err,
    );
    await db
      .from("sms_relay_messages")
      .update({ forward_status: "queued", claimed_at: null })
      .eq("relay_message_id", relayMessageId)
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
      .eq("relay_message_id", relayMessageId)
      .eq("forward_status", "sending");
  } else {
    await db
      .from("sms_relay_messages")
      .update({ forward_status: "failed" })
      .eq("relay_message_id", relayMessageId)
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

export interface RelayInboundArgs {
  relay: SmsRelayRow;
  /** The relay number's registry row (already matched by the webhook). */
  number: { number_id: number; phone_e164: string };
  event: {
    from: string;
    body: string | null;
    providerMessageId: string | null;
  };
  /** Normalised member phone — null when unparseable. */
  phoneE164: string | null;
  /** Workers matched on phone_e164 (webhook-supplied). */
  matchedWorkerIds: number[];
  receivedAt: string;
}

export interface RelayInboundResult {
  handled: true;
  response: Record<string, unknown>;
}

/**
 * The webhook relay leg — both directions. Fires only when the
 * to-number carries a live (active|paused) relay; STOP/unsubscribe
 * are handled upstream in the webhook precedence.
 */
export async function processRelayInbound(
  db: Db,
  provider: SmsProvider,
  args: RelayInboundArgs,
): Promise<RelayInboundResult> {
  const { relay, number, event, phoneE164, matchedWorkerIds, receivedAt } =
    args;
  const senderDigits = number.phone_e164.replace(/^\+/, "");
  const targets = await loadRelayTargets(db, relay.relay_id);
  const direction = resolveRelayDirection(targets, event.from);

  // ── Target → member ─────────────────────────────────────────
  if (direction.direction === "target_to_member") {
    const target = direction.target;

    // Bridging map: the last member whose message was actually
    // forwarded on this relay (pure chooseBridgeMember over the
    // recent candidates). Candidates whose phone matches ANY target
    // of the relay — active OR inactive — are excluded: a
    // deactivated target's own texts route through the member leg,
    // and letting them win the bridge would capture other targets'
    // replies.
    const { data: candidatesRaw } = await db
      .from("sms_relay_messages")
      .select("relay_message_id, member_worker_id, member_phone_e164, forwarded_at")
      .eq("relay_id", relay.relay_id)
      .eq("direction", "member_to_target")
      .not("forwarded_at", "is", null)
      .order("forwarded_at", { ascending: false })
      .limit(BRIDGE_CANDIDATE_LIMIT);
    const candidates = (
      (candidatesRaw ?? []) as Array<{
        relay_message_id: number;
        member_worker_id: number | null;
        member_phone_e164: string | null;
        forwarded_at: string | null;
      }>
    ).filter((c) => matchPhoneInList(targets, c.member_phone_e164) == null);
    const bridge = chooseBridgeMember(candidates);

    // Forwardable only when bridged, relay active, and the member
    // has not opted out since. Target replies are conversational —
    // never quiet-hours-blocked (the Phase 2 1:1 rule).
    let holdReason: string | null = null;
    if (!bridge) holdReason = "no_bridged_member";
    else if (relay.status === "paused") holdReason = "relay_paused";
    else if (await isPhoneOptedOut(db, bridge.member_phone_e164 as string)) {
      holdReason = "member_opted_out";
    }

    // The bridge body is stored on the row (forwarded_body) so a
    // transient provider failure retries byte-identical copy via
    // the cron drain.
    const bridgeBody = composeTargetReplyBody(
      target.display_name,
      event.body ?? "",
    );
    const relayMessageId = await insertRelayMessage(db, {
      relay_id: relay.relay_id,
      direction: "target_to_member",
      member_worker_id: bridge?.member_worker_id ?? null,
      member_phone_e164: bridge?.member_phone_e164 ?? null,
      target_id: target.target_id,
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
      console.warn(
        `relay ${relay.relay_id}: target reply held (${holdReason})`,
      );
      return {
        handled: true,
        response: { ok: true, relay_id: relay.relay_id, held: holdReason },
      };
    }

    const bridgedPhone = bridge!.member_phone_e164 as string;
    const outcome = await forwardRelayMessageNow(db, provider, {
      relayMessageId,
      forwardedBody: bridgeBody,
      senderDigits,
      destinations: [{ phone_e164: bridgedPhone }],
    });
    return {
      handled: true,
      response: {
        ok: true,
        relay_id: relay.relay_id,
        bridged_to_member: outcome.sent > 0,
      },
    };
  }

  // ── Member → target ─────────────────────────────────────────
  if (!phoneE164) {
    // Unparseable member number: nothing to store or reply to
    // (mirrors the Phase 1/2 unmatched behaviour).
    return { handled: true, response: { ok: true, unmatched: true } };
  }
  const workerId = matchedWorkerIds[0] ?? null;

  // Consent (worker-level opt-out; provider-side STOP is upstream).
  const optedOut = await isPhoneOptedOut(db, phoneE164);
  if (optedOut) {
    const relayMessageId = await insertRelayMessage(db, {
      relay_id: relay.relay_id,
      direction: "member_to_target",
      member_worker_id: workerId,
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
      body: RELAY_OPTED_OUT_REPLY,
      senderDigits,
      customRef: `relay-decline-${relayMessageId}`,
      idempotencyKey: `sms-relay-decline-${relayMessageId}`,
    });
    return {
      handled: true,
      response: { ok: true, relay_id: relay.relay_id, held: "opted_out" },
    };
  }

  // Render the forward AT RECEIPT TIME (deferred/moderated forwards
  // keep the wording current at receipt).
  const context = await loadMemberContext(db, workerId);
  const forwardedBody = composeForwardBody({
    prefixTemplate: relay.prefix_template,
    suffixTemplate: relay.suffix_template,
    memberBody: event.body ?? "",
    context,
  });

  const decision = decideMemberForward({
    relayStatus: relay.status as "active" | "paused",
    moderationRequired: relay.moderation_required,
    quietHoursRespected: relay.quiet_hours_respected,
    withinWindow: isWithinSendWindow(new Date(), relay.timezone),
  });

  // First-EVER member message on this relay → one confirmation
  // (only when the forward actually goes out now).
  const { count: priorCount } = await db
    .from("sms_relay_messages")
    .select("relay_message_id", { count: "exact", head: true })
    .eq("relay_id", relay.relay_id)
    .eq("direction", "member_to_target")
    .eq("member_phone_e164", phoneE164);
  const isFirstMessage = (priorCount ?? 0) === 0;

  const relayMessageId = await insertRelayMessage(db, {
    relay_id: relay.relay_id,
    direction: "member_to_target",
    member_worker_id: workerId,
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

  // Worker history (no inbox conversation — relay is its own surface).
  if (workerId != null) {
    await insertRelayInteraction(db, {
      workerId,
      campaignId: relay.campaign_id,
      fromRaw: event.from,
      phoneE164,
      body: event.body,
      providerMessageId: event.providerMessageId,
      receivedAt,
    });
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
      response: { ok: true, relay_id: relay.relay_id, held: "relay_paused" },
    };
  }
  if (decision.kind === "pending_moderation") {
    return {
      handled: true,
      response: { ok: true, relay_id: relay.relay_id, moderation: "pending" },
    };
  }
  if (decision.kind === "deferred_quiet_hours") {
    return {
      handled: true,
      response: { ok: true, relay_id: relay.relay_id, queued: "quiet_hours" },
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
      relay_id: relay.relay_id,
      forwarded_to: outcome.sent,
      forward_failed: outcome.failed > 0 && outcome.sent === 0 ? true : undefined,
    },
  };
}

export interface RelayForwardsSummary {
  relays_seen: number;
  relays_blocked_by_window: number[];
  stale_claims_recovered: number;
  forwarded: number;
  failed: number;
  errors: Array<{ relay_id: number; error: string }>;
}

/**
 * Cron drain (appended to /api/cron/sms-survey-timers): forward
 * 'queued' approved rows — BOTH directions — on ACTIVE relays
 * whose window is open, and nothing else. Held / pending /
 * rejected rows are never touched here. member→target rows fan out
 * to the active targets; target→member rows retry the stored
 * bridge reply to the member (a transient provider outage must
 * retry, not drop the reply forever). Plus a stale-claim sweep:
 * 'sending' rows whose run crashed are re-queued after 15 minutes.
 */
export async function processQueuedRelayForwards(
  db: Db,
  provider: SmsProvider,
  now: Date,
): Promise<RelayForwardsSummary> {
  const summary: RelayForwardsSummary = {
    relays_seen: 0,
    relays_blocked_by_window: [],
    stale_claims_recovered: 0,
    forwarded: 0,
    failed: 0,
    errors: [],
  };

  // Stale-claim recovery (dispatch-queue idiom): 'sending' rows
  // whose run crashed mid-flight. Small accepted re-send risk —
  // the claim is the primary guard.
  const staleCutoff = new Date(
    now.getTime() - STALE_CLAIM_MINUTES * 60 * 1000,
  ).toISOString();
  const { data: recovered, error: recoverErr } = await db
    .from("sms_relay_messages")
    .update({ forward_status: "queued", claimed_at: null })
    .eq("forward_status", "sending")
    .lt("claimed_at", staleCutoff)
    .select("relay_message_id");
  if (recoverErr) {
    console.error("relay forwards: stale-claim recovery failed:", recoverErr);
  } else if (recovered && recovered.length > 0) {
    summary.stale_claims_recovered = recovered.length;
    console.warn(
      `relay forwards: recovered ${recovered.length} stale 'sending' claims ` +
        `(messages ${recovered
          .map((r) => r.relay_message_id)
          .join(", ")}) — possible earlier crash; small re-send risk accepted`,
    );
  }

  const { data: relaysRaw, error } = await db
    .from("sms_relays")
    .select("*")
    .eq("status", "active")
    .order("relay_id", { ascending: true });
  if (error) {
    summary.errors.push({ relay_id: 0, error: error.message });
    return summary;
  }
  const relays = (relaysRaw ?? []) as SmsRelayRow[];
  summary.relays_seen = relays.length;
  let budget = RELAY_FORWARD_RUN_CAP;

  for (const relay of relays) {
    if (budget <= 0) break;
    try {
      if (
        relay.quiet_hours_respected &&
        !isWithinSendWindow(now, relay.timezone)
      ) {
        summary.relays_blocked_by_window.push(relay.relay_id);
        continue;
      }

      const { data: queuedRaw } = await db
        .from("sms_relay_messages")
        .select(
          "relay_message_id, direction, forwarded_body, member_phone_e164",
        )
        .eq("relay_id", relay.relay_id)
        .eq("forward_status", "queued")
        .in("moderation_status", ["auto_approved", "approved"])
        .order("relay_message_id", { ascending: true })
        .limit(budget);
      const queued = (queuedRaw ?? []) as Array<
        Pick<
          SmsRelayMessageRow,
          | "relay_message_id"
          | "direction"
          | "forwarded_body"
          | "member_phone_e164"
        >
      >;
      if (queued.length === 0) continue;

      const { data: numberRow } = await db
        .from("sms_numbers")
        .select("number_id, phone_e164, status")
        .eq("number_id", relay.number_id)
        .maybeSingle();
      if (!numberRow || numberRow.status !== "active") {
        throw new Error("Relay number missing or retired");
      }
      const senderDigits = (numberRow.phone_e164 as string).replace(/^\+/, "");
      const activeTargets = (await loadRelayTargets(db, relay.relay_id)).filter(
        (t) => t.is_active,
      );

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
          relayMessageId: row.relay_message_id,
          forwardedBody: row.forwarded_body ?? "",
          senderDigits,
          destinations,
        });
        if (!outcome.claimed) continue;
        if (outcome.sent > 0) summary.forwarded += 1;
        else {
          summary.failed += 1;
          if (outcome.error) {
            summary.errors.push({
              relay_id: relay.relay_id,
              error: outcome.error,
            });
          }
        }
      }
    } catch (err) {
      summary.errors.push({
        relay_id: relay.relay_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}
