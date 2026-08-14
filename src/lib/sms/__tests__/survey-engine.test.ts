import { describe, expect, it } from "vitest";
import {
  isStopKeyword,
  nextStep,
  normaliseAnswer,
  outcomeMapping,
  parseAnswer,
  renderInvitation,
  renderNudge,
  renderQuestion,
  retryLadder,
} from "../survey-engine";
import type { SmsSurveyQuestionRow } from "@/types/sms";

function q(overrides: Partial<SmsSurveyQuestionRow>): SmsSurveyQuestionRow {
  return {
    question_id: 1,
    survey_id: 1,
    sort_order: 0,
    prompt: "Question?",
    qtype: "open_text",
    options: null,
    branching: null,
    write_rating: false,
    activity_id: null,
    invalid_prompt: null,
    nudge_text: null,
    retired_at: null,
    created_at: "2026-08-11T00:00:00Z",
    updated_at: "2026-08-11T00:00:00Z",
    ...overrides,
  };
}

const CHOICE = q({
  question_id: 10,
  qtype: "choice",
  prompt: "Will you attend the stop-work meeting?",
  options: [
    { value: "attending", label: "Attending", synonyms: ["ill be there", "coming"] },
    { value: "maybe", label: "Not sure yet", synonyms: ["perhaps"] },
    { value: "no", label: "Can't make it", synonyms: ["cant"] },
  ],
});

const YES_NO = q({ question_id: 11, qtype: "yes_no", prompt: "Are you in?" });

const SCALE = q({
  question_id: 12,
  qtype: "scale",
  prompt: "Support 1-5?",
  options: { min: 1, max: 5 },
});

const OPEN = q({ question_id: 13, qtype: "open_text", prompt: "Anything else?" });

describe("normaliseAnswer", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    expect(normaliseAnswer("  YES!!  please. ")).toBe("yes please");
    expect(normaliseAnswer("Y-E-S")).toBe("y e s");
    expect(normaliseAnswer("café ☕")).toBe("café");
  });
});

describe("isStopKeyword", () => {
  it("matches STOP shapes", () => {
    expect(isStopKeyword("STOP")).toBe(true);
    expect(isStopKeyword("  stop.  ")).toBe(true);
    expect(isStopKeyword("Stop!")).toBe(true);
    expect(isStopKeyword("unsubscribe")).toBe(true);
    expect(isStopKeyword("opt out")).toBe(true);
  });
  it("does not swallow answers containing 'stop'", () => {
    expect(isStopKeyword("stop work meeting yes")).toBe(false);
    expect(isStopKeyword("please dont stop")).toBe(false);
    expect(isStopKeyword("")).toBe(false);
    expect(isStopKeyword(null)).toBe(false);
  });
});

describe("parseAnswer — choice", () => {
  it("matches option value (case/punctuation tolerant)", () => {
    expect(parseAnswer(CHOICE, "Attending")).toEqual({ kind: "parsed", value: "attending" });
    expect(parseAnswer(CHOICE, "  ATTENDING!! ")).toEqual({ kind: "parsed", value: "attending" });
  });

  it("matches label", () => {
    expect(parseAnswer(CHOICE, "not sure yet")).toEqual({ kind: "parsed", value: "maybe" });
    expect(parseAnswer(CHOICE, "Can't make it")).toEqual({ kind: "parsed", value: "no" });
  });

  it("matches synonyms (punctuation-tolerant)", () => {
    expect(parseAnswer(CHOICE, "I'll be there")).toEqual({ kind: "parsed", value: "attending" });
    expect(parseAnswer(CHOICE, "can't")).toEqual({ kind: "parsed", value: "no" });
    expect(parseAnswer(CHOICE, "Perhaps")).toEqual({ kind: "parsed", value: "maybe" });
  });

  it("matches label/value via first token (Yes please → Yes)", () => {
    expect(parseAnswer(CHOICE, "Attending please")).toEqual({
      kind: "parsed",
      value: "attending",
    });
    const ballot = q({
      qtype: "choice",
      options: [
        { value: "yes", label: "Yes", synonyms: ["yep"] },
        { value: "no", label: "No", synonyms: [] },
        { value: "undecided", label: "Undecided", synonyms: [] },
      ],
    });
    expect(parseAnswer(ballot, "Yes")).toEqual({ kind: "parsed", value: "yes" });
    expect(parseAnswer(ballot, "YES")).toEqual({ kind: "parsed", value: "yes" });
    expect(parseAnswer(ballot, "yes please")).toEqual({ kind: "parsed", value: "yes" });
  });

  it("matches numeric menu position (1-based)", () => {
    expect(parseAnswer(CHOICE, "1")).toEqual({ kind: "parsed", value: "attending" });
    expect(parseAnswer(CHOICE, " 3. ")).toEqual({ kind: "parsed", value: "no" });
    expect(parseAnswer(CHOICE, "4")).toEqual({ kind: "invalid" });
    expect(parseAnswer(CHOICE, "0")).toEqual({ kind: "invalid" });
  });

  it("prefers a digit option VALUE over menu position", () => {
    const digitChoice = q({
      qtype: "choice",
      options: [
        { value: "2", label: "Two units" },
        { value: "1", label: "One unit" },
      ],
    });
    // "2" matches the value "2" (first option) before position 2.
    expect(parseAnswer(digitChoice, "2")).toEqual({ kind: "parsed", value: "2" });
  });

  it("short garbage is invalid; long free-text is freetext_on_choice", () => {
    expect(parseAnswer(CHOICE, "xyz")).toEqual({ kind: "invalid" });
    expect(parseAnswer(CHOICE, "ok mate")).toEqual({ kind: "invalid" });
    expect(
      parseAnswer(CHOICE, "depends on my swing, I'm offshore until the 20th"),
    ).toEqual({ kind: "freetext_on_choice" });
  });

  it("long text that still matches an option parses (no false freetext)", () => {
    // 3+ words but an exact synonym match.
    expect(parseAnswer(CHOICE, "i'll be there")).toEqual({
      kind: "parsed",
      value: "attending",
    });
  });
});

describe("parseAnswer — malformed options never throw", () => {
  // Staff can author arbitrary JSONB via PostgREST, bypassing route
  // validation — a poison option must never 500 the webhook.
  const malformed = q({
    qtype: "choice",
    options: [
      { value: "a", label: 123 },
      { value: "b", synonyms: [1, null, "bee"] },
      null,
      { label: "no value here" },
      "garbage",
      { value: "c", label: null, synonyms: "not-an-array" },
    ] as unknown as SmsSurveyQuestionRow["options"],
  });

  it("number label falls back to the value (no toLowerCase crash)", () => {
    expect(parseAnswer(malformed, "a")).toEqual({ kind: "parsed", value: "a" });
    expect(parseAnswer(malformed, "123")).toEqual({ kind: "invalid" });
  });

  it("non-string synonyms are filtered; string ones still match", () => {
    expect(parseAnswer(malformed, "bee")).toEqual({ kind: "parsed", value: "b" });
  });

  it("entries without a string value are dropped; menu positions follow", () => {
    // Surviving options: a, b, c → position 3 = c.
    expect(parseAnswer(malformed, "3")).toEqual({ kind: "parsed", value: "c" });
    expect(parseAnswer(malformed, "4")).toEqual({ kind: "invalid" });
  });

  it("rendering and the retry ladder never throw on malformed options", () => {
    expect(() => renderQuestion(malformed)).not.toThrow();
    expect(renderQuestion(malformed)).toContain("1. a");
    expect(() => retryLadder(malformed, 0, 2)).not.toThrow();
    expect(() => retryLadder(malformed, 1, 2)).not.toThrow();
  });

  it("wholly garbage options degrade to invalid, not a crash", () => {
    const junk = q({
      qtype: "choice",
      options: [null, 42, "x"] as unknown as SmsSurveyQuestionRow["options"],
    });
    expect(parseAnswer(junk, "anything")).toEqual({ kind: "invalid" });
    expect(() => renderQuestion(junk)).not.toThrow();
  });
});

describe("parseAnswer — yes_no", () => {
  it("built-in yes synonyms", () => {
    for (const body of ["yes", "Y", "yeah", "YEP", "ok", "Okay", "sure", "si", "aye"]) {
      expect(parseAnswer(YES_NO, body)).toEqual({ kind: "parsed", value: "yes" });
    }
  });
  it("built-in no synonyms", () => {
    for (const body of ["no", "N", "nope", "NAH", "na", "never"]) {
      expect(parseAnswer(YES_NO, body)).toEqual({ kind: "parsed", value: "no" });
    }
  });
  it("first-token tolerance", () => {
    expect(parseAnswer(YES_NO, "yes please")).toEqual({ kind: "parsed", value: "yes" });
    expect(parseAnswer(YES_NO, "Nah sorry")).toEqual({ kind: "parsed", value: "no" });
  });
  it("is case-insensitive (yes / YES / Yes)", () => {
    expect(parseAnswer(YES_NO, "yes")).toEqual({ kind: "parsed", value: "yes" });
    expect(parseAnswer(YES_NO, "YES")).toEqual({ kind: "parsed", value: "yes" });
    expect(parseAnswer(YES_NO, "Yes")).toEqual({ kind: "parsed", value: "yes" });
    expect(parseAnswer(YES_NO, "No")).toEqual({ kind: "parsed", value: "no" });
    expect(parseAnswer(YES_NO, "NO")).toEqual({ kind: "parsed", value: "no" });
  });
  it("numeric menu fallbacks 1/2", () => {
    expect(parseAnswer(YES_NO, "1")).toEqual({ kind: "parsed", value: "yes" });
    expect(parseAnswer(YES_NO, "2")).toEqual({ kind: "parsed", value: "no" });
  });
  it("invalid vs freetext", () => {
    expect(parseAnswer(YES_NO, "dunno")).toEqual({ kind: "invalid" });
    expect(parseAnswer(YES_NO, "I need to talk to my partner about this first")).toEqual({
      kind: "freetext_on_choice",
    });
  });
});

describe("parseAnswer — scale", () => {
  it("accepts integers within bounds", () => {
    expect(parseAnswer(SCALE, "1")).toEqual({ kind: "parsed", value: "1" });
    expect(parseAnswer(SCALE, " 5. ")).toEqual({ kind: "parsed", value: "5" });
  });
  it("rejects out-of-range and non-bare numbers", () => {
    expect(parseAnswer(SCALE, "0")).toEqual({ kind: "invalid" });
    expect(parseAnswer(SCALE, "6")).toEqual({ kind: "invalid" });
    expect(parseAnswer(SCALE, "4/5")).toEqual({ kind: "invalid" });
    expect(parseAnswer(SCALE, "3ish")).toEqual({ kind: "invalid" });
  });
  it("uses the configured range", () => {
    const zeroTen = q({ qtype: "scale", options: { min: 0, max: 10 } });
    expect(parseAnswer(zeroTen, "0")).toEqual({ kind: "parsed", value: "0" });
    expect(parseAnswer(zeroTen, "10")).toEqual({ kind: "parsed", value: "10" });
    expect(parseAnswer(zeroTen, "11")).toEqual({ kind: "invalid" });
  });
  it("falls back to 1-5 on malformed options", () => {
    const broken = q({ qtype: "scale", options: null });
    expect(parseAnswer(broken, "5")).toEqual({ kind: "parsed", value: "5" });
    expect(parseAnswer(broken, "6")).toEqual({ kind: "invalid" });
  });
});

describe("parseAnswer — open_text", () => {
  it("always parses non-empty text verbatim (trimmed)", () => {
    expect(parseAnswer(OPEN, "  Whatever I like, punctuation & all!  ")).toEqual({
      kind: "parsed",
      value: "Whatever I like, punctuation & all!",
    });
  });
  it("empty is invalid", () => {
    expect(parseAnswer(OPEN, "   ")).toEqual({ kind: "invalid" });
  });
});

describe("nextStep — branching", () => {
  const q1 = q({ question_id: 1, sort_order: 0, qtype: "yes_no", branching: { no: "end" } });
  const q2 = q({ question_id: 2, sort_order: 1 });
  const q3 = q({ question_id: 3, sort_order: 2 });
  const all = [q3, q1, q2]; // deliberately unsorted

  it("falls through to sort order without a branch", () => {
    expect(nextStep(all, q1, "yes")).toEqual({ kind: "question", question: q2 });
    expect(nextStep(all, q2, "anything")).toEqual({ kind: "question", question: q3 });
  });

  it("completes after the last question", () => {
    expect(nextStep(all, q3, "x")).toEqual({ kind: "complete" });
  });

  it("honours 'end' branch overrides", () => {
    expect(nextStep(all, q1, "no")).toEqual({ kind: "complete" });
  });

  it("honours question-id branch overrides (skipping ahead)", () => {
    const branched = q({ question_id: 1, sort_order: 0, branching: { skip: 3 } });
    expect(nextStep([branched, q2, q3], branched, "skip")).toEqual({
      kind: "question",
      question: q3,
    });
  });

  it("unknown branch target falls back to sort order", () => {
    const branched = q({ question_id: 1, sort_order: 0, branching: { yes: 999 } });
    expect(nextStep([branched, q2, q3], branched, "yes")).toEqual({
      kind: "question",
      question: q2,
    });
  });
});

describe("retryLadder", () => {
  it("attempt 1: specific re-prompt with options", () => {
    const step = retryLadder(CHOICE, 0, 2);
    expect(step.kind).toBe("reprompt");
    if (step.kind === "reprompt") {
      expect(step.body).toContain("Attending");
      expect(step.body).toContain("didn't catch");
    }
  });

  it("attempt 1 uses the question's invalid_prompt override", () => {
    const custom = q({ ...CHOICE, invalid_prompt: "Try again — reply 1, 2 or 3." });
    expect(retryLadder(custom, 0, 2)).toEqual({
      kind: "reprompt",
      body: "Try again — reply 1, 2 or 3.",
    });
  });

  it("attempt 2: restructured numbered menu", () => {
    const step = retryLadder(CHOICE, 1, 2);
    expect(step.kind).toBe("reprompt");
    if (step.kind === "reprompt") {
      expect(step.body).toContain("just a number");
      expect(step.body).toContain("1. Attending");
      expect(step.body).toContain("3. Can't make it");
    }
  });

  it("attempt 3 (limit 2): handoff", () => {
    expect(retryLadder(CHOICE, 2, 2)).toEqual({ kind: "handoff" });
    expect(retryLadder(CHOICE, 5, 2)).toEqual({ kind: "handoff" });
  });

  it("retry limit 0 hands off immediately", () => {
    expect(retryLadder(CHOICE, 0, 0)).toEqual({ kind: "handoff" });
  });

  it("yes_no and scale menus", () => {
    const yn = retryLadder(YES_NO, 1, 2);
    if (yn.kind === "reprompt") expect(yn.body).toContain("YES or NO");
    const sc = retryLadder(SCALE, 1, 2);
    if (sc.kind === "reprompt") expect(sc.body).toContain("1 to 5");
  });
});

describe("rendering", () => {
  it("choice renders a numbered menu", () => {
    expect(renderQuestion(CHOICE)).toBe(
      "Will you attend the stop-work meeting?\n1. Attending\n2. Not sure yet\n3. Can't make it",
    );
  });
  it("yes_no / scale / open_text instructions", () => {
    expect(renderQuestion(YES_NO)).toContain("Reply YES or NO");
    expect(renderQuestion(SCALE)).toContain("from 1 to 5");
    expect(renderQuestion(OPEN)).toBe("Anything else?");
  });
  it("invitation combines body + first question in one send", () => {
    expect(renderInvitation("Offshore Alliance survey. Reply STOP to opt out.", YES_NO)).toBe(
      "Offshore Alliance survey. Reply STOP to opt out.\n\nAre you in?\nReply YES or NO",
    );
    expect(renderInvitation(null, YES_NO)).toBe("Are you in?\nReply YES or NO");
  });
  it("nudge prefers the question override", () => {
    expect(renderNudge(q({ ...YES_NO, nudge_text: "Still there?" }))).toBe("Still there?");
    expect(renderNudge(YES_NO)).toContain("Are you in?");
  });
});

describe("outcomeMapping", () => {
  it("scale 1-5 maps to a rating on scale assessments", () => {
    expect(outcomeMapping(SCALE, "3", { isBinary: false })).toEqual({
      rating: 3,
      binary: null,
    });
  });
  it("scale outside 1-5 maps to nothing (no bogus rating)", () => {
    const zeroTen = q({ qtype: "scale", options: { min: 0, max: 10 } });
    expect(outcomeMapping(zeroTen, "8", { isBinary: false })).toEqual({
      rating: null,
      binary: null,
    });
    expect(outcomeMapping(zeroTen, "0", { isBinary: false })).toEqual({
      rating: null,
      binary: null,
    });
    expect(outcomeMapping(zeroTen, "4", { isBinary: false })).toEqual({
      rating: 4,
      binary: null,
    });
  });
  it("yes_no maps to binary only on binary assessments", () => {
    expect(outcomeMapping(YES_NO, "yes", { isBinary: true })).toEqual({
      rating: null,
      binary: "yes",
    });
    expect(outcomeMapping(YES_NO, "no", { isBinary: true })).toEqual({
      rating: null,
      binary: "no",
    });
    expect(outcomeMapping(YES_NO, "yes", { isBinary: false })).toEqual({
      rating: null,
      binary: null,
    });
  });
  it("choice uses explicit option maps only (no digit heuristic)", () => {
    const mapped = q({
      qtype: "choice",
      options: [
        { value: "attending", label: "Attending", maps_to_rating: 5 },
        { value: "maybe", label: "Maybe", maps_to_binary: "unsure" },
        { value: "no", label: "No", maps_to_rating: null, maps_to_binary: null },
      ],
    });
    expect(outcomeMapping(mapped, "attending", { isBinary: false })).toEqual({
      rating: 5,
      binary: null,
    });
    expect(outcomeMapping(mapped, "maybe", { isBinary: true })).toEqual({
      rating: null,
      binary: "unsure",
    });
    expect(outcomeMapping(mapped, "no", { isBinary: true })).toEqual({
      rating: null,
      binary: null,
    });
    // Unmapped digit value — no longer treated as a rating.
    expect(outcomeMapping(CHOICE, "2", { isBinary: false })).toEqual({
      rating: null,
      binary: null,
    });
  });
  it("mismatched method writes nothing", () => {
    expect(outcomeMapping(SCALE, "3", { isBinary: true })).toEqual({
      rating: null,
      binary: null,
    });
  });
  it("open_text never maps", () => {
    expect(outcomeMapping(OPEN, "anything at all")).toEqual({
      rating: null,
      binary: null,
    });
  });
});
