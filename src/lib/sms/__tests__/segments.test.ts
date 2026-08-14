import { describe, expect, it } from "vitest";
import {
  countSegments,
  countSegmentsWorstCase,
  expandMergeFieldsWorstCase,
  isGsm7,
  MERGE_FIELD_WORST_CASE,
} from "../segments";

describe("isGsm7", () => {
  it("accepts plain ASCII and GSM symbols", () => {
    expect(isGsm7("Hello, OA members! Meeting @ 5pm — no wait")).toBe(false); // em dash is not GSM
    expect(isGsm7("Hello, OA members! Meeting @ 5pm - $10 & 50%")).toBe(true);
    expect(isGsm7("café £5 Ø ñ ü à")).toBe(true);
  });

  it("accepts extended-set characters", () => {
    expect(isGsm7("100% [confirmed] {ok} ~yes~ €5 | a\\b ^up")).toBe(true);
  });

  it("rejects emoji and smart punctuation", () => {
    expect(isGsm7("On strike 💪")).toBe(false);
    expect(isGsm7("It’s on")).toBe(false); // curly apostrophe
    expect(isGsm7("“quoted”")).toBe(false); // curly quotes
  });
});

describe("countSegments — GSM-7", () => {
  it("empty body is zero segments", () => {
    const c = countSegments("");
    expect(c.segments).toBe(0);
    expect(c.encoding).toBe("GSM-7");
  });

  it("160 chars is one part; 161 is two", () => {
    expect(countSegments("a".repeat(160)).segments).toBe(1);
    expect(countSegments("a".repeat(160)).perSegment).toBe(160);
    const two = countSegments("a".repeat(161));
    expect(two.segments).toBe(2);
    expect(two.perSegment).toBe(153);
  });

  it("306 chars is two parts; 307 is three", () => {
    expect(countSegments("a".repeat(306)).segments).toBe(2);
    expect(countSegments("a".repeat(307)).segments).toBe(3);
  });

  it("extended chars cost two septets", () => {
    // 79 'a' + '€' (2 septets) = 81 septets — still one part.
    expect(countSegments("a".repeat(79) + "€").length).toBe(81);
    // 159 'a' + '[' = 161 septets → two parts.
    expect(countSegments("a".repeat(159) + "[").segments).toBe(2);
    // 158 'a' + '[' = 160 septets → one part.
    expect(countSegments("a".repeat(158) + "[").segments).toBe(1);
  });

  it("reports remaining capacity", () => {
    const c = countSegments("a".repeat(150));
    expect(c.remaining).toBe(10);
  });
});

describe("countSegments — UCS-2", () => {
  it("a single emoji flips encoding", () => {
    const c = countSegments("Meeting at 5 💪");
    expect(c.encoding).toBe("UCS-2");
    expect(c.nonGsmChars).toContain("💪");
  });

  it("70 code units is one part; 71 is two", () => {
    const base = "’" + "a".repeat(69); // 70 units
    expect(countSegments(base).segments).toBe(1);
    expect(countSegments(base + "a").segments).toBe(2);
    expect(countSegments(base + "a").perSegment).toBe(67);
  });

  it("134 units is two parts; 135 is three", () => {
    const smart = "’";
    expect(countSegments(smart + "a".repeat(133)).segments).toBe(2);
    expect(countSegments(smart + "a".repeat(134)).segments).toBe(3);
  });

  it("astral emoji count as two code units", () => {
    // 34 emoji (68 units) + smart quote + 'a' = 70 units → 1 part.
    const body = "💪".repeat(34) + "’a";
    expect(countSegments(body).length).toBe(70);
    expect(countSegments(body).segments).toBe(1);
  });
});

describe("merge-field worst-case expansion", () => {
  it("expands known tokens to their worst-case width", () => {
    const out = expandMergeFieldsWorstCase("Hi {{first_name}}");
    expect(out).toBe("Hi " + "x".repeat(MERGE_FIELD_WORST_CASE.first_name));
  });

  it("expands unknown tokens to the default width", () => {
    expect(expandMergeFieldsWorstCase("{{mystery_field}}")).toBe("x".repeat(24));
  });

  it("tolerates spaced tokens", () => {
    expect(expandMergeFieldsWorstCase("{{ date }}")).toBe(
      "x".repeat(MERGE_FIELD_WORST_CASE.date)
    );
  });

  it("worst-case count exceeds literal count for tokenised bodies", () => {
    const body = "Hi {{first_name}}, {{campaign_name}} update. - Offshore Alliance";
    expect(countSegmentsWorstCase(body).length).toBeGreaterThan(
      countSegments(body).length
    );
  });
});
