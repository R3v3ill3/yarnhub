import { describe, expect, it } from "vitest";
import {
  blackoutOverrideError,
  resolveBlastBody,
  screenBlastRecipient,
} from "../blast-body";

describe("resolveBlastBody", () => {
  it("fills contact and org merge fields and strips leftovers", () => {
    expect(
      resolveBlastBody("Hi {{first_name}} from {{org_name}} {{unknown}}", {
        first_name: "Alex",
        org_name: "Northside",
      }),
    ).toBe("Hi Alex from Northside");
  });
});

describe("screenBlastRecipient", () => {
  it("blocks opted-out contacts at send time", () => {
    expect(
      screenBlastRecipient({ sms_opt_out: true, phone_e164: "+61411111111" }),
    ).toEqual({
      ok: false,
      status: "opted_out",
      reason: "Contact has opted out of SMS",
    });
  });

  it("skips missing phones", () => {
    expect(screenBlastRecipient({ sms_opt_out: false, phone_e164: null })).toMatchObject({
      ok: false,
      status: "skipped",
    });
  });

  it("allows an eligible contact", () => {
    expect(
      screenBlastRecipient({ sms_opt_out: false, phone_e164: "+61411111111" }),
    ).toEqual({ ok: true, to: "+61411111111" });
  });
});

describe("blackoutOverrideError", () => {
  it("requires a recorded reason", () => {
    expect(blackoutOverrideError(false, "")).toBeNull();
    expect(blackoutOverrideError(true, "short")).toBeTruthy();
    expect(blackoutOverrideError(true, "Urgent safety notice")).toBeNull();
  });
});
