import { describe, expect, it } from "vitest";
import {
  filterInboxSafeSenders,
  inboxUnsafePurposeError,
  isInboxUnsafePurpose,
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
});
