import { describe, expect, it } from "vitest";
import {
  MobileMessageProvider,
  syntheticInboundMessageId,
} from "../mobile-message-provider";

const provider = new MobileMessageProvider({
  username: "test",
  password: "test",
});

describe("MobileMessageProvider.parseWebhook", () => {
  it("maps inbound sender → from and synthesises a stable message id", () => {
    const payload = {
      to: "61485900133",
      message: "5",
      sender: "61428436924",
      received_at: "2026-08-12 00:24:27",
      type: "inbound",
      original_message_id: "3ca7ebc7-adc8-4d39-a05c-b718fa15b012",
      original_custom_ref: "survey-19",
    };
    const event = provider.parseWebhook(JSON.stringify(payload));
    const expectedId = syntheticInboundMessageId({
      to: payload.to,
      from: payload.sender,
      body: payload.message,
      receivedAt: payload.received_at,
      originalMessageId: payload.original_message_id,
    });
    expect(event).toMatchObject({
      type: "inbound",
      from: "61428436924",
      to: "61485900133",
      body: "5",
      providerMessageId: expectedId,
      originalMessageId: "3ca7ebc7-adc8-4d39-a05c-b718fa15b012",
      originalCustomRef: "survey-19",
    });
    // Retries with the same payload must collapse to the same id.
    expect(provider.parseWebhook(JSON.stringify(payload))).toMatchObject({
      providerMessageId: expectedId,
    });
  });

  it("prefers from when both from and sender are present", () => {
    const event = provider.parseWebhook(
      JSON.stringify({
        type: "inbound",
        from: "61411111111",
        sender: "61422222222",
        to: "61485900133",
        message: "yes",
      }),
    );
    expect(event).toMatchObject({ type: "inbound", from: "61411111111" });
  });

  it("maps unsubscribe sender → from", () => {
    const event = provider.parseWebhook(
      JSON.stringify({
        type: "unsubscribe",
        sender: "61428436924",
        to: "61485900133",
      }),
    );
    expect(event).toMatchObject({
      type: "unsubscribe",
      from: "61428436924",
      to: "61485900133",
    });
  });
});
