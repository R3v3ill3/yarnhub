import { describe, expect, it } from "vitest";
import {
  filterInboxSafeSenders,
  filterSurveySenders,
  inboxUnsafePurposeError,
  isInboxUnsafePurpose,
  surveySenderPurposeWarning,
} from "../sender-purpose";

describe("sender-purpose belts", () => {
  it("rejects survey and relay senders for blast/chat", () => {
    expect(isInboxUnsafePurpose("survey")).toBe(true);
    expect(isInboxUnsafePurpose("relay")).toBe(true);
    expect(isInboxUnsafePurpose("inbox")).toBe(false);
    expect(inboxUnsafePurposeError("survey")).toBeTruthy();
    expect(inboxUnsafePurposeError("inbox")).toBeNull();
  });

  it("filters unsafe senders from the inbox-safe list", () => {
    const senders = [
      { purpose: "inbox" },
      { purpose: "survey" },
      { purpose: "relay" },
      { purpose: "spare" },
    ];
    expect(filterInboxSafeSenders(senders).map((s) => s.purpose)).toEqual([
      "inbox",
      "spare",
    ]);
  });

  it("keeps inbox senders for surveys but excludes relay", () => {
    expect(
      filterSurveySenders([{ purpose: "inbox" }, { purpose: "relay" }, { purpose: "survey" }]).map(
        (s) => s.purpose,
      ),
    ).toEqual(["inbox", "survey"]);
    expect(surveySenderPurposeWarning("inbox")).toMatch(/survey answers/);
  });
});
