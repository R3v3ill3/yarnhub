/**
 * Rail state for the P2P workspace (OA Phase 10, adapted).
 *
 * Item send status and conversation state are merged into one ladder
 * so the rail, its sort, and the "Needs reply" filter read from one place.
 *
 * Palette rule: these states drive desaturated tints. Do not reuse
 * rating colours — Yarnhub has no assessments on the rail.
 */

export type SmsRailState =
  | "not_messaged"
  | "sending"
  | "messaged"
  | "new_reply"
  | "needs_response"
  | "in_conversation"
  | "closed"
  | "opted_out"
  | "failed";

export type YarnhubConversationState = "open" | "needs_reply" | "closed";

export interface RailItemLike {
  status: string;
  sms_opt_out: boolean;
  conversation_state: YarnhubConversationState | null;
  unread_count: number;
}

/**
 * Precedence, highest first:
 *   opted_out → failed → new_reply (unread) → needs_response
 *   → in_conversation / closed / messaged → sending / not_messaged
 */
export function deriveRailState(item: RailItemLike): SmsRailState {
  if (item.sms_opt_out || item.status === "opted_out" || item.status === "blocked") {
    return "opted_out";
  }
  if (item.status === "failed") return "failed";

  if (item.conversation_state != null) {
    if (item.conversation_state !== "closed" && item.unread_count > 0) {
      return "new_reply";
    }
    switch (item.conversation_state) {
      case "needs_reply":
        return "needs_response";
      case "open":
        return "in_conversation";
      case "closed":
        return "closed";
    }
  }

  if (item.status === "sending" || item.status === "queued") return "sending";
  if (item.status === "sent") return "messaged";
  return "not_messaged";
}

const RANK: Record<SmsRailState, number> = {
  new_reply: 0,
  needs_response: 1,
  in_conversation: 2,
  failed: 3,
  messaged: 4,
  sending: 5,
  not_messaged: 6,
  closed: 7,
  opted_out: 8,
};

export function railStateRank(state: SmsRailState): number {
  return RANK[state];
}

export function isActionable(state: SmsRailState): boolean {
  return state === "new_reply" || state === "needs_response";
}

export function shouldPulse(state: SmsRailState): boolean {
  return state === "new_reply";
}
