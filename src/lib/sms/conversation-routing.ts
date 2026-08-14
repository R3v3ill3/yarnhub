/**
 * Pure inbound-conversation routing (brief §7.0):
 *
 *   `to` number → owning organiser's number row → open conversation on
 *   the (number, member phone) pair → else most-recent open context for
 *   a matched worker on that number → else CREATE (triage when the
 *   worker is unmatched, needs_response when matched; campaign scope
 *   from the correlated / most recent send within 7 days).
 *
 * Kept pure (no I/O) so the precedence is unit-testable; the webhook
 * gathers the candidate rows and applies the returned decision.
 */

import type { SmsConversationState } from "@/types/sms";

/** Campaign scope from a prior send only within this window. */
export const RECENT_SEND_WINDOW_DAYS = 7;

export interface RoutingNumber {
  number_id: number;
  phone_e164: string;
  organiser_id: number | null;
}

export interface RoutingOpenConversation {
  conversation_id: number;
  campaign_id: number | null;
  worker_id: number | null;
  last_message_at: string | null;
  /** How this candidate was found: the (number, phone) pair, or a matched worker on the number. */
  matched_on: "phone" | "worker";
}

export interface RoutingInput {
  /** Normalised member phone (E.164) — null when unparseable. */
  phoneE164: string | null;
  /** Workers matched on phone_e164 (may be empty). */
  matchedWorkerIds: number[];
  /** Our number the message arrived on — null when no registry match. */
  number: RoutingNumber | null;
  /** Open (state != 'closed') conversations on this number for the pair/worker. */
  openConversations: RoutingOpenConversation[];
  /** Correlated or most recent sms_send_log row for the matched worker. */
  recentSend: { campaign_id: number | null; created_at: string } | null;
  now?: Date;
}

export type RoutingDecision =
  | { action: "none"; reason: "no_number" | "no_phone" }
  | { action: "attach"; conversationId: number }
  | {
      action: "create";
      conversation: {
        our_number_id: number;
        worker_id: number | null;
        phone_e164: string;
        campaign_id: number | null;
        state: Extract<SmsConversationState, "triage" | "needs_response">;
      };
    };

/** Significant AU mobile digits (last 9, after stripping 0/61 prefixes). */
function significantDigits(raw: string): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  let rest = digits;
  if (rest.startsWith("61")) rest = rest.slice(2);
  if (rest.startsWith("0")) rest = rest.slice(1);
  return rest.length === 9 ? rest : null;
}

/**
 * Tolerant match of a webhook `to` value against the number registry
 * (providers variously send `+614…`, `614…` or `04…`).
 */
export function findNumberForInbound<T extends { phone_e164: string }>(
  numbers: T[],
  to: string | null | undefined,
): T | null {
  if (!to) return null;
  const target = significantDigits(to);
  if (!target) {
    // Non-AU-mobile shapes (e.g. shared shortcodes): exact digit match only.
    const rawDigits = to.replace(/\D/g, "");
    if (!rawDigits) return null;
    return (
      numbers.find((n) => n.phone_e164.replace(/\D/g, "") === rawDigits) ?? null
    );
  }
  return (
    numbers.find((n) => significantDigits(n.phone_e164) === target) ?? null
  );
}

function sortCandidates(
  convs: RoutingOpenConversation[],
): RoutingOpenConversation[] {
  return [...convs].sort((a, b) => {
    // Campaign-scoped threads outrank the org-wide scope.
    const aScoped = a.campaign_id != null ? 0 : 1;
    const bScoped = b.campaign_id != null ? 0 : 1;
    if (aScoped !== bScoped) return aScoped - bScoped;
    // Then most recent activity.
    const aT = a.last_message_at ? Date.parse(a.last_message_at) : 0;
    const bT = b.last_message_at ? Date.parse(b.last_message_at) : 0;
    if (aT !== bT) return bT - aT;
    return b.conversation_id - a.conversation_id;
  });
}

export function resolveInboundConversation(
  input: RoutingInput,
): RoutingDecision {
  const {
    phoneE164,
    matchedWorkerIds,
    number,
    openConversations,
    recentSend,
  } = input;

  if (!number) return { action: "none", reason: "no_number" };
  if (!phoneE164) return { action: "none", reason: "no_phone" };

  // 1. Open thread on the (number, member phone) pair — campaign-scoped
  //    preferred, then most recent.
  const pairMatches = sortCandidates(
    openConversations.filter((c) => c.matched_on === "phone"),
  );
  if (pairMatches.length > 0) {
    return { action: "attach", conversationId: pairMatches[0].conversation_id };
  }

  // 2. Most-recent open context for a matched worker on this number
  //    (covers the member texting from a differently-recorded number).
  if (matchedWorkerIds.length > 0) {
    const workerMatches = sortCandidates(
      openConversations.filter(
        (c) =>
          c.matched_on === "worker" &&
          c.worker_id != null &&
          matchedWorkerIds.includes(c.worker_id),
      ),
    );
    if (workerMatches.length > 0) {
      return {
        action: "attach",
        conversationId: workerMatches[0].conversation_id,
      };
    }
  }

  // 3. Create. Campaign scope from a prior send within the window.
  const workerId = matchedWorkerIds[0] ?? null;
  let campaignId: number | null = null;
  if (workerId != null && recentSend?.campaign_id != null) {
    const now = input.now ?? new Date();
    const sentAt = Date.parse(recentSend.created_at);
    const windowMs = RECENT_SEND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    if (Number.isFinite(sentAt) && now.getTime() - sentAt <= windowMs) {
      campaignId = recentSend.campaign_id;
    }
  }

  return {
    action: "create",
    conversation: {
      our_number_id: number.number_id,
      worker_id: workerId,
      phone_e164: phoneE164,
      campaign_id: campaignId,
      state: workerId != null ? "needs_response" : "triage",
    },
  };
}
