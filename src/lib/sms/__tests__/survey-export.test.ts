import { describe, expect, it } from "vitest";
import { surveyAnswersToWideCsv } from "../survey-export";
import { resolveTestAudienceContactIds, TEST_AUDIENCE_CAP } from "../survey-test-audience";

describe("surveyAnswersToWideCsv", () => {
  it("emits parsed and verbatim columns", () => {
    const csv = surveyAnswersToWideCsv({
      questions: [{ id: "q1", prompt: "Pay rise?", sort_order: 0 }],
      respondents: [
        {
          name: "Alex Mitchell",
          phone: "+61400000000",
          state: "completed",
          answers: { q1: { parsed_value: "yes", raw_body: "Yes, about 20%" } },
        },
      ],
    });
    expect(csv).toContain("Pay rise? (parsed)");
    expect(csv).toContain("Yes, about 20%");
  });
});

describe("resolveTestAudienceContactIds", () => {
  it("refuses an empty roster and a roster over the cap", () => {
    expect(resolveTestAudienceContactIds([]).error).toMatch(/No test recipients/);
    const tooMany = Array.from({ length: TEST_AUDIENCE_CAP + 1 }, (_, i) => `c${i}`);
    expect(resolveTestAudienceContactIds(tooMany).error).toMatch(/25/);
  });
});
