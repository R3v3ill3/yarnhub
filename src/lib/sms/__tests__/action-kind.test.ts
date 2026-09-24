import { describe, expect, it } from "vitest";
import {
  SMS_ACTION_KIND_COPY,
  SMS_ACTION_KINDS,
  parseSmsActionKind,
} from "@/lib/sms/action-kind";

describe("parseSmsActionKind", () => {
  it("accepts the four wizard kinds", () => {
    for (const kind of SMS_ACTION_KINDS) {
      expect(parseSmsActionKind(kind)).toBe(kind);
    }
  });

  it("rejects anything else", () => {
    expect(parseSmsActionKind(null)).toBeNull();
    expect(parseSmsActionKind("")).toBeNull();
    expect(parseSmsActionKind("campaign")).toBeNull();
    expect(parseSmsActionKind("BLAST")).toBeNull();
  });
});

describe("SMS_ACTION_KIND_COPY", () => {
  it("describes each kind as an organisation action", () => {
    for (const kind of SMS_ACTION_KINDS) {
      const copy = SMS_ACTION_KIND_COPY[kind];
      const text = `${copy.label} ${copy.headline} ${copy.description}`.toLowerCase();
      expect(text).not.toMatch(/campaign|assessment|wall chart|rating/);
      expect(copy.home.startsWith("/")).toBe(true);
      expect(copy.noun.length).toBeGreaterThan(0);
    }
  });
});
