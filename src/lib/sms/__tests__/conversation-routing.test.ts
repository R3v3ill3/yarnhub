import { describe, expect, it } from "vitest";
import {
  findNumberForInbound,
  resolveInboundConversation,
  RECENT_SEND_WINDOW_DAYS,
  type RoutingInput,
  type RoutingOpenConversation,
} from "@/lib/sms/conversation-routing";

const NUMBER = { number_id: 3, phone_e164: "+61485900180", organiser_id: 7 };
const NOW = new Date("2026-08-10T10:00:00Z");

function input(overrides: Partial<RoutingInput> = {}): RoutingInput {
  return {
    phoneE164: "+61400100014",
    matchedWorkerIds: [42],
    number: NUMBER,
    openConversations: [],
    recentSend: null,
    now: NOW,
    ...overrides,
  };
}

function conv(
  overrides: Partial<RoutingOpenConversation> = {},
): RoutingOpenConversation {
  return {
    conversation_id: 1,
    campaign_id: null,
    worker_id: 42,
    last_message_at: "2026-08-01T00:00:00Z",
    matched_on: "phone",
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

describe("resolveInboundConversation — precedence", () => {
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

  it("attaches to an open pair conversation before anything else", () => {
    const decision = resolveInboundConversation(
      input({
        openConversations: [
          conv({ conversation_id: 11, matched_on: "phone" }),
          conv({ conversation_id: 12, matched_on: "worker" }),
        ],
        recentSend: { campaign_id: 5, created_at: NOW.toISOString() },
      }),
    );
    expect(decision).toEqual({ action: "attach", conversationId: 11 });
  });

  it("prefers the campaign-scoped pair conversation over a more recent org-wide one", () => {
    const decision = resolveInboundConversation(
      input({
        openConversations: [
          conv({
            conversation_id: 21,
            campaign_id: null,
            last_message_at: "2026-08-09T00:00:00Z",
          }),
          conv({
            conversation_id: 22,
            campaign_id: 9,
            last_message_at: "2026-08-01T00:00:00Z",
          }),
        ],
      }),
    );
    expect(decision).toEqual({ action: "attach", conversationId: 22 });
  });

  it("breaks campaign-scoped ties by recency", () => {
    const decision = resolveInboundConversation(
      input({
        openConversations: [
          conv({
            conversation_id: 31,
            campaign_id: 1,
            last_message_at: "2026-08-01T00:00:00Z",
          }),
          conv({
            conversation_id: 32,
            campaign_id: 2,
            last_message_at: "2026-08-05T00:00:00Z",
          }),
        ],
      }),
    );
    expect(decision).toEqual({ action: "attach", conversationId: 32 });
  });

  it("falls back to the matched worker's open conversation on this number", () => {
    const decision = resolveInboundConversation(
      input({
        openConversations: [
          conv({ conversation_id: 41, matched_on: "worker", worker_id: 42 }),
          // Another worker's thread must never be attached to.
          conv({ conversation_id: 42, matched_on: "worker", worker_id: 99 }),
        ],
      }),
    );
    expect(decision).toEqual({ action: "attach", conversationId: 41 });
  });

  it("ignores worker-matched candidates when no worker matched", () => {
    const decision = resolveInboundConversation(
      input({
        matchedWorkerIds: [],
        openConversations: [
          conv({ conversation_id: 51, matched_on: "worker" }),
        ],
      }),
    );
    expect(decision.action).toBe("create");
  });
});

describe("resolveInboundConversation — creation", () => {
  it("creates needs_response for a matched worker, carrying the recent send's campaign", () => {
    const decision = resolveInboundConversation(
      input({
        recentSend: {
          campaign_id: 5,
          created_at: "2026-08-08T00:00:00Z",
        },
      }),
    );
    expect(decision).toEqual({
      action: "create",
      conversation: {
        our_number_id: 3,
        worker_id: 42,
        phone_e164: "+61400100014",
        campaign_id: 5,
        state: "needs_response",
      },
    });
  });

  it("creates triage with no campaign for unmatched inbound", () => {
    const decision = resolveInboundConversation(
      input({
        matchedWorkerIds: [],
        recentSend: { campaign_id: 5, created_at: NOW.toISOString() },
      }),
    );
    expect(decision).toEqual({
      action: "create",
      conversation: {
        our_number_id: 3,
        worker_id: null,
        phone_e164: "+61400100014",
        campaign_id: null,
        state: "triage",
      },
    });
  });

  it("drops campaign scope when the send is older than the window", () => {
    const staleMs =
      NOW.getTime() - (RECENT_SEND_WINDOW_DAYS * 24 * 60 * 60 * 1000 + 1000);
    const decision = resolveInboundConversation(
      input({
        recentSend: {
          campaign_id: 5,
          created_at: new Date(staleMs).toISOString(),
        },
      }),
    );
    expect(decision.action).toBe("create");
    if (decision.action === "create") {
      expect(decision.conversation.campaign_id).toBeNull();
      expect(decision.conversation.state).toBe("needs_response");
    }
  });

  it("keeps campaign scope exactly at the window boundary", () => {
    const boundaryMs =
      NOW.getTime() - RECENT_SEND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const decision = resolveInboundConversation(
      input({
        recentSend: {
          campaign_id: 5,
          created_at: new Date(boundaryMs).toISOString(),
        },
      }),
    );
    if (decision.action === "create") {
      expect(decision.conversation.campaign_id).toBe(5);
    } else {
      throw new Error("expected create");
    }
  });
});
