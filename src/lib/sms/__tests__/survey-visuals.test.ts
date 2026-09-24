import { describe, expect, it } from "vitest";
import { buildFlowEdges, flowFromDraft, flowFromSaved } from "@/lib/sms/survey-flow";
import {
  funnelFromSessions,
  participationSlices,
  questionSlices,
} from "@/lib/sms/survey-report";

describe("survey flow", () => {
  it("draws a straight path when nothing branches", () => {
    const edges = buildFlowEdges(
      flowFromDraft([
        { prompt: "Pay?", qtype: "yes_no", yesGoto: "next", noGoto: "next" },
        { prompt: "Why?", qtype: "open_text" },
      ]),
    );
    expect(edges.map((edge) => `${edge.from}->${edge.to}`)).toEqual(["start->0", "0->1", "1->end"]);
  });

  it("labels a yes branch that ends the survey", () => {
    const edges = buildFlowEdges(
      flowFromSaved([
        { id: "a", prompt: "Stay?", qtype: "yes_no", branching: { yes: "end", no: "b" } },
        { id: "b", prompt: "Why not?", qtype: "open_text", branching: null },
      ]),
    );
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 0, to: "end", label: "yes", kind: "branch" }),
        expect.objectContaining({ from: 0, to: 1, label: "no", kind: "branch" }),
      ]),
    );
  });
});

describe("survey report", () => {
  it("keeps queued people out of the participation pie", () => {
    const funnel = funnelFromSessions([
      { state: "queued", first_answer_at: null },
      { state: "invited", first_answer_at: null },
      { state: "active", first_answer_at: "2026-09-24T00:00:00Z" },
      { state: "completed", first_answer_at: "2026-09-24T00:00:00Z" },
    ]);
    expect(funnel).toEqual({ ever_invited_count: 3, started_count: 2, completed_count: 1 });
    expect(participationSlices(funnel).map((slice) => slice.key)).toEqual([
      "completed",
      "in_progress",
      "no_response",
    ]);
  });

  it("orders yes and no before stray values", () => {
    const slices = questionSlices(
      { question_id: "q1", qtype: "yes_no", options: null },
      [
        { question_id: "q1", parsed_value: "no" },
        { question_id: "q1", parsed_value: "yes" },
        { question_id: "q1", parsed_value: "yes" },
      ],
    );
    expect(slices.map((slice) => `${slice.name}:${slice.value}`)).toEqual(["Yes:2", "No:1"]);
  });
});
