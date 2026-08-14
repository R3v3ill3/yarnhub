import { describe, expect, it } from "vitest";
import {
  findNumberForInbound,
  resolveInboundConversation,
  type RoutingInput,
} from "@/lib/sms/conversation-routing";

const NUMBER = {
  id: "num-3",
  organisation_id: "org-a",
  phone_e164: "+61485900180",
};

function input(overrides: Partial<RoutingInput> = {}): RoutingInput {
  return {
    phoneE164: "+61400100014",
    number: NUMBER,
    existingConversationId: null,
    ...overrides,
  };
}

describe("findNumberForInbound", () => {
  const numbers = [
    { phone_e164: "+61485900180" },
    { phone_e164: "+61485900181" },
  ];

  it("matches E.164, digits-only and local forms of the same number", () => {
    for (const to of ["+61485900180", "61485900180", "0485900180"]) {
      expect(findNumberForInbound(numbers, to)?.phone_e164).toBe(
        "+61485900180",
      );
    }
  });

  it("returns null for unknown or empty to-numbers", () => {
    expect(findNumberForInbound(numbers, "+61400999888")).toBeNull();
    expect(findNumberForInbound(numbers, "")).toBeNull();
    expect(findNumberForInbound(numbers, null)).toBeNull();
    expect(findNumberForInbound(numbers, "not-a-number")).toBeNull();
  });

  it("falls back to exact digit match for non-AU-mobile shapes", () => {
    const short = [{ phone_e164: "487001" }];
    expect(findNumberForInbound(short, "487001")?.phone_e164).toBe("487001");
    expect(findNumberForInbound(short, "487002")).toBeNull();
  });
});

describe("resolveInboundConversation", () => {
  it("bails out when the to-number is not in the registry", () => {
    expect(resolveInboundConversation(input({ number: null }))).toEqual({
      action: "none",
      reason: "no_number",
    });
  });

  it("bails out when the from-number cannot be normalised", () => {
    expect(resolveInboundConversation(input({ phoneE164: null }))).toEqual({
      action: "none",
      reason: "no_phone",
    });
  });

  it("attaches to the existing (org, number, phone) thread", () => {
    expect(
      resolveInboundConversation(input({ existingConversationId: "conv-11" })),
    ).toEqual({ action: "attach", conversationId: "conv-11" });
  });

  it("creates a thread on the unique (number, phone) pair", () => {
    expect(resolveInboundConversation(input())).toEqual({
      action: "create",
      conversation: {
        our_number_id: "num-3",
        phone_e164: "+61400100014",
      },
    });
  });
});
