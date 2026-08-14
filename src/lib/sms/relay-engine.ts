/**
 * Pure relay logic (brief §6 — relay-with-attribution, Phase 6).
 *
 * Everything decision-shaped lives here so it is unit-testable
 * without I/O: direction resolution (is the sender a relay target or
 * a member?), the bridging-map choice (WHICH member a target reply
 * goes back to), prefix/suffix template rendering, and the
 * member-forward decision ladder (paused → moderation → quiet hours
 * → forward now). The quiet-hours boundary itself reuses the tested
 * `isWithinSendWindow` from `lib/sms/blackout.ts` — callers pass the
 * resulting boolean in.
 *
 * I/O lives in `lib/sms/relay-runtime.ts` (service-role, the
 * survey-runtime idiom).
 */

import { TEMPLATE_TOKEN_RE } from "@/lib/comms/template-variables";

// ─── Reply copy ─────────────────────────────────────────────────────

/** Auto-reply to a member texting a PAUSED relay. */
export const RELAY_PAUSED_REPLY =
  "Message received — forwarding is currently paused.";

/**
 * Polite decline to an opted-out member (their inbound message is a
 * direct request, so a single transactional response is compliant —
 * but the message is never forwarded).
 */
export const RELAY_OPTED_OUT_REPLY =
  "You have opted out of SMS from Offshore Alliance, so this message was not passed on. Reply START to opt back in.";

/**
 * One-time confirmation on the member's FIRST forwarded message on a
 * relay (avoids per-message chattiness). Only sent when the forward
 * actually went out — never for held/queued/pending messages.
 */
export const RELAY_FIRST_FORWARD_CONFIRMATION =
  "Your message has been passed on. Replies will come from this number.";

/** Prefix context for a member we could not match to a worker. */
export const GENERIC_MEMBER_CONTEXT: RelayMemberContext = {
  first_name: "A member",
  last_name: "",
  employer_name: "",
};

// ─── Direction resolution ───────────────────────────────────────────

/** Significant AU mobile digits (last 9, after stripping 0/61 prefixes). */
function significantDigits(raw: string): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  let rest = digits;
  if (rest.startsWith("61")) rest = rest.slice(2);
  if (rest.startsWith("0")) rest = rest.slice(1);
  return rest.length === 9 ? rest : null;
}

export interface RelayTargetLike {
  target_id: number;
  phone_e164: string;
  display_name: string | null;
  is_active: boolean;
}

/**
 * Tolerant match of a raw phone value against a list of stored
 * numbers (`+614…` / `614…` / `04…` all match; non-AU shapes fall
 * back to exact digit comparison). Shared by target-direction
 * matching, the own-number target guard (a platform sms_number can
 * never be a relay target — kills relay rings and self-targets),
 * and bridge-candidate exclusion.
 */
export function matchPhoneInList<T extends { phone_e164: string }>(
  rows: T[],
  phone: string | null | undefined,
): T | null {
  if (!phone) return null;
  const target = significantDigits(phone);
  if (!target) {
    const rawDigits = phone.replace(/\D/g, "");
    if (!rawDigits) return null;
    return (
      rows.find((r) => r.phone_e164.replace(/\D/g, "") === rawDigits) ?? null
    );
  }
  return rows.find((r) => significantDigits(r.phone_e164) === target) ?? null;
}

/**
 * Tolerant match of a webhook `from` value against the relay's
 * targets. Only ACTIVE targets count — a deactivated target texting
 * the relay number is treated as a member (their reply no longer
 * bridges).
 */
export function matchRelayTarget<T extends RelayTargetLike>(
  targets: T[],
  from: string | null | undefined,
): T | null {
  return matchPhoneInList(
    targets.filter((t) => t.is_active),
    from,
  );
}

export type RelayDirectionDecision<T extends RelayTargetLike> =
  | { direction: "target_to_member"; target: T }
  | { direction: "member_to_target" };

/** Inbound on a relay number: a target replying, or a member writing in. */
export function resolveRelayDirection<T extends RelayTargetLike>(
  targets: T[],
  from: string | null | undefined,
): RelayDirectionDecision<T> {
  const target = matchRelayTarget(targets, from);
  if (target) return { direction: "target_to_member", target };
  return { direction: "member_to_target" };
}

// ─── Bridging map (target reply → member) ───────────────────────────

export interface BridgeCandidate {
  relay_message_id: number;
  member_worker_id: number | null;
  member_phone_e164: string | null;
  /** NULL = never actually forwarded (held/queued/pending). */
  forwarded_at: string | null;
}

/**
 * The bridging map (brief §6): a target's reply goes back to the
 * LAST member whose message was actually FORWARDED on this relay —
 * a held/queued/pending message never reached the target, so it can
 * not be what they are replying to. Most recent `forwarded_at` wins;
 * ties (same timestamp) break on the higher relay_message_id.
 * Returns null when no member has ever been forwarded (the caller
 * stores the reply un-bridged and does not forward).
 */
export function chooseBridgeMember(
  candidates: BridgeCandidate[],
): BridgeCandidate | null {
  const forwarded = candidates.filter(
    (c) => c.forwarded_at != null && c.member_phone_e164 != null,
  );
  if (forwarded.length === 0) return null;
  forwarded.sort((a, b) => {
    const aT = Date.parse(a.forwarded_at as string) || 0;
    const bT = Date.parse(b.forwarded_at as string) || 0;
    if (aT !== bT) return bT - aT;
    return b.relay_message_id - a.relay_message_id;
  });
  return forwarded[0];
}

// ─── Template rendering ─────────────────────────────────────────────

export interface RelayMemberContext {
  first_name?: string;
  last_name?: string;
  employer_name?: string;
  [key: string]: string | undefined;
}

/**
 * Render a prefix/suffix template with worker merge fields. Known
 * tokens resolve from the context; unknown/unresolved tokens are
 * STRIPPED (a literal `{{x}}` must never reach an external target),
 * then doubled spaces collapse — the dispatch-cron idiom.
 */
export function renderRelayTemplate(
  template: string | null | undefined,
  context: RelayMemberContext,
): string {
  if (!template) return "";
  return template
    .replace(TEMPLATE_TOKEN_RE, (_match, key: string) => context[key] ?? "")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();
}

/**
 * member→target forward body: rendered prefix + member message +
 * rendered suffix, newline-joined, empty parts dropped.
 */
export function composeForwardBody(args: {
  prefixTemplate: string | null;
  suffixTemplate: string | null;
  memberBody: string;
  context: RelayMemberContext;
}): string {
  const parts = [
    renderRelayTemplate(args.prefixTemplate, args.context),
    args.memberBody.trim(),
    renderRelayTemplate(args.suffixTemplate, args.context),
  ].filter((p) => p.length > 0);
  return parts.join("\n");
}

/**
 * target→member bridge body: prefixed with the target's display name
 * ("<display_name>: …") for clarity — the member may be mid-thread
 * with the relay on other traffic. No prefix when no name is set,
 * so the reply reads naturally.
 */
export function composeTargetReplyBody(
  displayName: string | null | undefined,
  body: string,
): string {
  const trimmed = body.trim();
  const name = displayName?.trim();
  return name ? `${name}: ${trimmed}` : trimmed;
}

// ─── Member-forward decision ladder ─────────────────────────────────

export type MemberForwardDecision =
  /** Relay paused → store 'held', auto-reply RELAY_PAUSED_REPLY. */
  | { kind: "held_paused" }
  /** Moderation required → ('pending','held'), no forward yet. */
  | { kind: "pending_moderation" }
  /** Quiet hours closed → 'queued'; the cron forwards at window open. */
  | { kind: "deferred_quiet_hours" }
  /** Forward to all active targets now. */
  | { kind: "forward_now" };

/**
 * The precedence is deliberate: pause beats moderation (a paused
 * relay must not accumulate a moderation queue that forwards on
 * resume), moderation beats quiet hours (approval re-checks the
 * window when it happens).
 */
export function decideMemberForward(args: {
  relayStatus: "active" | "paused";
  moderationRequired: boolean;
  quietHoursRespected: boolean;
  withinWindow: boolean;
}): MemberForwardDecision {
  if (args.relayStatus === "paused") return { kind: "held_paused" };
  if (args.moderationRequired) return { kind: "pending_moderation" };
  if (args.quietHoursRespected && !args.withinWindow) {
    return { kind: "deferred_quiet_hours" };
  }
  return { kind: "forward_now" };
}
