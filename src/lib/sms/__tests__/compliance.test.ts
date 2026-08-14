import { describe, expect, it } from "vitest";
import {
  SMS_ORG_NAME_WARNING,
  smsOrgNameWarning,
  validateSmsBody,
} from "../compliance";

const OA = "Offshore Alliance";

describe("validateSmsBody", () => {
  it("passes with org name and 'Reply STOP to opt out'", () => {
    const r = validateSmsBody(
      "Hi {{first_name}}, meeting Tuesday 5pm. - Offshore Alliance. Reply STOP to opt out",
      OA,
    );
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it("accepts phrasing variants", () => {
    const bodies = [
      "Offshore Alliance update. Text STOP to end",
      "offshore  alliance news — txt STOP anytime",
      "From the Offshore Alliance. To opt-out reply here",
      "Offshore Alliance: reply STOP",
      "Offshore Alliance — opt out at any time by replying",
    ];
    for (const b of bodies) {
      expect(validateSmsBody(b, OA).ok, b).toBe(true);
      expect(validateSmsBody(b, OA).warnings, b).toHaveLength(0);
    }
  });

  it("warns without organisation identification but still passes", () => {
    const r = validateSmsBody("Meeting Tuesday. Reply STOP to opt out", OA);
    expect(r.ok).toBe(true);
    expect(r.hasOrgName).toBe(false);
    expect(r.hasOptOut).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toEqual([smsOrgNameWarning(OA)]);
  });

  it("passes without an opt-out instruction (optional for member traffic)", () => {
    const r = validateSmsBody("Offshore Alliance meeting Tuesday 5pm.", OA);
    expect(r.ok).toBe(true);
    expect(r.hasOptOut).toBe(false);
    expect(r.hasOrgName).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it("does not treat unrelated 'stop' as an opt-out instruction", () => {
    const r = validateSmsBody("Offshore Alliance: stop work meeting Tuesday", OA);
    expect(r.ok).toBe(true);
    expect(r.hasOptOut).toBe(false);
  });

  it("warns on an empty body for the org-name check only", () => {
    const r = validateSmsBody("", OA);
    expect(r.ok).toBe(true);
    expect(r.hasOrgName).toBe(false);
    expect(r.hasOptOut).toBe(false);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toEqual([smsOrgNameWarning(OA)]);
  });

  it("uses the tenant organisation name, not a hardcoded brand", () => {
    const r = validateSmsBody("Hi from Northside Trades. Reply STOP to opt out", "Northside Trades");
    expect(r.hasOrgName).toBe(true);
    expect(r.warnings).toHaveLength(0);
    const missing = validateSmsBody("Hi from Northside Trades", "Southside Crew");
    expect(missing.hasOrgName).toBe(false);
    expect(missing.warnings[0]).toContain("Southside Crew");
    expect(missing.warnings[0]).not.toBe(SMS_ORG_NAME_WARNING);
  });
});
