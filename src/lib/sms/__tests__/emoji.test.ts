import { describe, expect, it } from "vitest";
import { SMS_EMOJI_ALL, SMS_EMOJI_GROUPS, hasEmoji } from "../emoji";
import { countSegments } from "../segments";

describe("SMS emoji palette", () => {
  it("has no duplicates across groups", () => {
    expect(new Set(SMS_EMOJI_ALL).size).toBe(SMS_EMOJI_ALL.length);
  });

  it("labels every group", () => {
    for (const group of SMS_EMOJI_GROUPS) {
      expect(group.label.trim()).not.toBe("");
      expect(group.emoji.length).toBeGreaterThan(0);
    }
  });

  it("offers only characters the counter treats as non-GSM", () => {
    for (const emoji of SMS_EMOJI_ALL) {
      expect(countSegments(emoji).encoding).toBe("UCS-2");
    }
  });

  it("avoids skin-tone modifiers and ZWJ sequences", () => {
    for (const emoji of SMS_EMOJI_ALL) {
      expect(emoji).not.toMatch(/[\u{1F3FB}-\u{1F3FF}]/u);
      expect(emoji).not.toContain("‍");
    }
  });
});

describe("hasEmoji", () => {
  it("detects pictographs and ignores plain GSM text", () => {
    expect(hasEmoji("Meeting Tuesday 5pm")).toBe(false);
    expect(hasEmoji("See you 👍")).toBe(true);
  });
});
