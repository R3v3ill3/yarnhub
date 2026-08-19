import { describe, expect, it } from "vitest";
import {
  deriveRailState,
  isActionable,
  railStateRank,
  shouldPulse,
  type RailItemLike,
} from "../chat-rail-state";

function item(overrides: Partial<RailItemLike> = {}): RailItemLike {
  return {
    status: "sent",
    sms_opt_out: false,
    conversation_state: "open",
    unread_count: 0,
    ...overrides,
  };
}

describe("deriveRailState", () => {
  it("ranks opt-out above unread", () => {
    expect(
      deriveRailState(item({ sms_opt_out: true, unread_count: 2, conversation_state: "needs_reply" })),
    ).toBe("opted_out");
  });

  it("pulses on unread inbound", () => {
    expect(deriveRailState(item({ unread_count: 1, conversation_state: "needs_reply" }))).toBe(
      "new_reply",
    );
    expect(shouldPulse("new_reply")).toBe(true);
    expect(isActionable("new_reply")).toBe(true);
  });

  it("treats seen needs_reply as needs_response", () => {
    expect(deriveRailState(item({ conversation_state: "needs_reply", unread_count: 0 }))).toBe(
      "needs_response",
    );
    expect(isActionable("needs_response")).toBe(true);
    expect(shouldPulse("needs_response")).toBe(false);
  });

  it("sorts actionable rows first", () => {
    expect(railStateRank("new_reply")).toBeLessThan(railStateRank("messaged"));
    expect(railStateRank("needs_response")).toBeLessThan(railStateRank("closed"));
  });
});
