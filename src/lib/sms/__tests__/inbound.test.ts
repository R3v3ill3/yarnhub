import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decideWebhookAuth, isStartEvent, isStopEvent, routeInboundThread } from "../inbound";
import { MobileMessageProvider } from "../provider/mobile-message-provider";
import type { RoutingNumber } from "../conversation-routing";

const ORG_A = "org-a";
const ORG_B = "org-b";

const numbers: RoutingNumber[] = [
  { id: "num-a", organisation_id: ORG_A, phone_e164: "+61400000001" },
  { id: "num-b", organisation_id: ORG_B, phone_e164: "+61400000002" },
];

describe("decideWebhookAuth", () => {
  it("allows unsigned mock traffic when no secret is stored", () => {
    expect(
      decideWebhookAuth({
        providerName: "mock",
        hasWebhookSecret: false,
        hmacOk: false,
      }),
    ).toBe("ok");
  });

  it("requires HMAC for Mobile Message", () => {
    expect(
      decideWebhookAuth({
        providerName: "mobile_message",
        hasWebhookSecret: true,
        hmacOk: false,
      }),
    ).toBe("unauthorized");
    expect(
      decideWebhookAuth({
        providerName: "mobile_message",
        hasWebhookSecret: true,
        hmacOk: true,
      }),
    ).toBe("ok");
  });
});

describe("webhook org isolation", () => {
  it("attaches inbound on org A only to org A numbers", () => {
    const { number, decision } = routeInboundThread({
      orgId: ORG_A,
      numbers,
      to: "+61400000001",
      phoneE164: "+61411111111",
      existingConversationId: null,
    });
    expect(number?.id).toBe("num-a");
    expect(decision.action).toBe("create");
    if (decision.action === "create") {
      expect(decision.conversation.our_number_id).toBe("num-a");
    }
  });

  it("rejects inbound whose to-number belongs to another org", () => {
    const { number, decision } = routeInboundThread({
      orgId: ORG_A,
      numbers,
      to: "+61400000002",
      phoneE164: "+61411111111",
      existingConversationId: "should-not-use",
    });
    expect(number).toBeNull();
    expect(decision).toEqual({ action: "none", reason: "no_number" });
  });

  it("never routes org B traffic onto an org A conversation id", () => {
    const { number, decision } = routeInboundThread({
      orgId: ORG_B,
      numbers,
      to: "+61400000001",
      phoneE164: "+61411111111",
      existingConversationId: "org-a-thread",
    });
    expect(number).toBeNull();
    expect(decision.action).toBe("none");
  });
});

describe("isStopEvent", () => {
  it("treats STOP bodies and unsubscribe events as opt-out", () => {
    expect(
      isStopEvent({
        type: "inbound",
        from: "+61411111111",
        to: "+61400000001",
        body: "STOP",
        providerMessageId: "1",
        originalMessageId: null,
        originalCustomRef: null,
        receivedAt: null,
      }),
    ).toBe(true);
    expect(
      isStopEvent({
        type: "unsubscribe",
        from: "+61411111111",
        to: "+61400000001",
        providerMessageId: "1",
        receivedAt: null,
      }),
    ).toBe(true);
    expect(
      isStopEvent({
        type: "inbound",
        from: "+61411111111",
        to: "+61400000001",
        body: "hello",
        providerMessageId: "1",
        originalMessageId: null,
        originalCustomRef: null,
        receivedAt: null,
      }),
    ).toBe(false);
  });
});

describe("isStartEvent", () => {
  it("treats START bodies as opt-in and ignores STOP", () => {
    expect(
      isStartEvent({
        type: "inbound",
        from: "+61411111111",
        to: "+61400000001",
        body: "START",
        providerMessageId: "1",
        originalMessageId: null,
        originalCustomRef: null,
        receivedAt: null,
      }),
    ).toBe(true);
    expect(
      isStartEvent({
        type: "unsubscribe",
        from: "+61411111111",
        to: "+61400000001",
        providerMessageId: "1",
        receivedAt: null,
      }),
    ).toBe(false);
  });
});

describe("Mobile Message HMAC is per-secret", () => {
  it("accepts org A signature and rejects org B secret", () => {
    const rawBody = JSON.stringify({ type: "inbound", to: "61400000001" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", "secret-a")
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");
    const headers = {
      "x-mm-timestamp": timestamp,
      "x-mm-signature": signature,
    };
    const a = new MobileMessageProvider({
      username: "u",
      password: "p",
      webhookSecret: "secret-a",
    });
    const b = new MobileMessageProvider({
      username: "u",
      password: "p",
      webhookSecret: "secret-b",
    });
    expect(a.verifyWebhook(rawBody, headers)).toBe(true);
    expect(b.verifyWebhook(rawBody, headers)).toBe(false);
  });
});
