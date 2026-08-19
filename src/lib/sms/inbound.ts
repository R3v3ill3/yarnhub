/**
 * Pure inbound webhook decisions — org isolation, STOP, thread attach.
 * I/O lives in the route handler.
 */

import { isStartKeyword, isStopKeyword } from "@/lib/sms/survey-engine";
import {
  findNumberForInbound,
  resolveInboundConversation,
  type RoutingNumber,
} from "@/lib/sms/conversation-routing";
import type { SmsWebhookEvent } from "@/lib/sms/provider/types";

export type WebhookAuthDecision = "ok" | "unauthorized";

export function decideWebhookAuth(args: {
  providerName: string;
  hasWebhookSecret: boolean;
  hmacOk: boolean;
}): WebhookAuthDecision {
  if (args.providerName === "mock") {
    if (!args.hasWebhookSecret) return "ok";
    return args.hmacOk ? "ok" : "unauthorized";
  }
  return args.hmacOk ? "ok" : "unauthorized";
}

export function resolveOwnedInboundNumber(args: {
  orgId: string;
  numbers: RoutingNumber[];
  to: string | null | undefined;
}): RoutingNumber | null {
  const owned = args.numbers.filter((n) => n.organisation_id === args.orgId);
  return findNumberForInbound(owned, args.to);
}

export function isStopEvent(event: SmsWebhookEvent): boolean {
  if (event.type === "unsubscribe") return true;
  if (event.type === "inbound") return isStopKeyword(event.body);
  return false;
}

export function isStartEvent(event: SmsWebhookEvent): boolean {
  if (event.type !== "inbound") return false;
  return isStartKeyword(event.body);
}

export type InboundLeg = "stop" | "start" | "survey" | "relay" | "inbox";

/**
 * Webhook precedence: STOP always wins, then START (opt back in),
 * then a live survey on the member phone, then a live relay on the
 * to-number, else inbox.
 */
export function decideInboundLeg(args: {
  isStop: boolean;
  isStart?: boolean;
  hasLiveSurvey: boolean;
  hasLiveRelay: boolean;
}): InboundLeg {
  if (args.isStop) return "stop";
  if (args.isStart) return "start";
  if (args.hasLiveSurvey) return "survey";
  if (args.hasLiveRelay) return "relay";
  return "inbox";
}

export const LIVE_SURVEY_SESSION_STATES = ["invited", "active"] as const;

export function isLiveSurveySessionState(state: string | null | undefined): boolean {
  return state === "invited" || state === "active";
}

/** True when two invited/active sessions share (organisation_id, phone_e164). */
export function liveSurveySessionsConflict(
  sessions: Array<{ organisation_id: string; phone_e164: string; state: string }>,
): boolean {
  const seen = new Set<string>();
  for (const session of sessions) {
    if (!isLiveSurveySessionState(session.state)) continue;
    const key = `${session.organisation_id}:${session.phone_e164}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

export function inboundPhoneAndTo(event: SmsWebhookEvent): {
  from: string;
  to: string;
  body: string;
  providerMessageId: string | null;
} | null {
  if (event.type === "inbound") {
    return {
      from: event.from,
      to: event.to,
      body: event.body,
      providerMessageId: event.providerMessageId,
    };
  }
  if (event.type === "unsubscribe") {
    return {
      from: event.from,
      to: event.to,
      body: "STOP",
      providerMessageId: event.providerMessageId,
    };
  }
  return null;
}

export function routeInboundThread(args: {
  orgId: string;
  numbers: RoutingNumber[];
  to: string | null | undefined;
  phoneE164: string | null;
  existingConversationId: string | null;
}) {
  const number = resolveOwnedInboundNumber({
    orgId: args.orgId,
    numbers: args.numbers,
    to: args.to,
  });
  return {
    number,
    decision: resolveInboundConversation({
      phoneE164: args.phoneE164,
      number,
      existingConversationId: args.existingConversationId,
    }),
  };
}
