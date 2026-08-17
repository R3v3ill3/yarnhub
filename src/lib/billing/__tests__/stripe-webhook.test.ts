import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyStripeWebhookSignature } from "../stripe-webhook";

describe("verifyStripeWebhookSignature", () => {
  const secret = "whsec_test";
  const rawBody = "{\"id\":\"evt_1\"}";
  const t = "1710000000";
  const v1 = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");

  it("accepts a valid v1 signature within the time window", () => {
    expect(
      verifyStripeWebhookSignature({
        rawBody,
        header: `t=${t},v1=${v1}`,
        secret,
        nowSeconds: Number(t),
      }),
    ).toBe(true);
  });

  it("rejects a bad signature", () => {
    expect(
      verifyStripeWebhookSignature({
        rawBody,
        header: `t=${t},v1=deadbeef`,
        secret,
        nowSeconds: Number(t),
      }),
    ).toBe(false);
  });

  it("rejects a stale timestamp", () => {
    expect(
      verifyStripeWebhookSignature({
        rawBody,
        header: `t=${t},v1=${v1}`,
        secret,
        nowSeconds: Number(t) + 10_000,
      }),
    ).toBe(false);
  });
});
