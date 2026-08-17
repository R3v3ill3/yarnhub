import { describe, expect, it } from "vitest";
import {
  hostedWebhookMissingOrgDecision,
  resolveOrgIdFromDeliveryLookup,
  resolveOrgIdFromToNumber,
} from "../hosted-routing";
import type { RoutingNumber } from "../conversation-routing";

const numbers: RoutingNumber[] = [
  { id: "n1", organisation_id: "org-a", phone_e164: "+61400000001" },
  { id: "n2", organisation_id: "org-b", phone_e164: "+61400000002" },
];

describe("hosted inbound dispatch on to", () => {
  it("routes a dedicated number to its organisation", () => {
    expect(resolveOrgIdFromToNumber(numbers, "0400000001")).toBe("org-a");
    expect(resolveOrgIdFromToNumber(numbers, "+61400000002")).toBe("org-b");
  });

  it("returns null for an unknown to so MM is not failed", () => {
    expect(resolveOrgIdFromToNumber(numbers, "+61499999999")).toBeNull();
  });
});

describe("hosted status dispatch without to", () => {
  it("prefers send_log org then message org", () => {
    expect(
      resolveOrgIdFromDeliveryLookup({
        providerMessageId: "mm-1",
        sendLogOrgId: "org-a",
        messageOrgId: "org-b",
      }),
    ).toBe("org-a");
    expect(
      resolveOrgIdFromDeliveryLookup({
        providerMessageId: "mm-1",
        sendLogOrgId: null,
        messageOrgId: "org-b",
      }),
    ).toBe("org-b");
    expect(
      resolveOrgIdFromDeliveryLookup({
        providerMessageId: null,
        sendLogOrgId: "org-a",
        messageOrgId: "org-b",
      }),
    ).toBeNull();
  });
});

describe("hosted webhook auth", () => {
  it("requires a platform secret and HMAC", () => {
    expect(
      hostedWebhookMissingOrgDecision({ hasPlatformSecret: false, hmacOk: false }),
    ).toBe("unconfigured");
    expect(
      hostedWebhookMissingOrgDecision({ hasPlatformSecret: true, hmacOk: false }),
    ).toBe("unauthorized");
    expect(
      hostedWebhookMissingOrgDecision({ hasPlatformSecret: true, hmacOk: true }),
    ).toBe("ok");
  });
});
