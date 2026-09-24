import { describe, expect, it } from "vitest";
import { foldTapbackMessages, parseSmsTapback } from "../tapback";

describe("parseSmsTapback", () => {
  it("parses an English like with a quoted body", () => {
    expect(parseSmsTapback('Liked "Meet at 6"')).toEqual({
      kind: "like",
      emoji: "👍",
      quoted: "Meet at 6",
    });
  });

  it("does not treat a normal sentence as a tapback", () => {
    expect(parseSmsTapback("Liked the meeting notes")).toBeNull();
  });

  it("parses a removed reaction as not a tapback", () => {
    expect(parseSmsTapback("Removed a like")).toBeNull();
  });
});

describe("foldTapbackMessages", () => {
  it("hides the reaction bubble and chips the outbound", () => {
    const folded = foldTapbackMessages([
      {
        id: "1",
        direction: "outbound",
        body: "Meet at 6",
        created_at: "2026-09-01T00:00:00Z",
      },
      {
        id: "2",
        direction: "inbound",
        body: 'Liked "Meet at 6"',
        created_at: "2026-09-01T00:01:00Z",
        provider_message_id: "p2",
      },
    ]);
    expect(folded).toHaveLength(1);
    expect(folded[0]?.reactions?.[0]?.kind).toBe("like");
  });
});
