/**
 * Pure SMS survey engine (brief §4.1) — parsing, branching, retry
 * ladder and rendering. No I/O: the webhook and timers cron gather
 * rows and apply the returned decisions, and the builder UI reuses
 * the renderers for its live phone preview.
 *
 * Parse order for choice questions (§4.1): value → label → synonyms
 * → numeric menu position. yes_no carries built-in synonym sets.
 * Long free-text on a non-open question is captured verbatim and
 * surfaced to a human WITHOUT burning a retry (freetext_on_choice).
 *
 * Unit tested in __tests__/survey-engine.test.ts — this module is
 * the heart of Phase 4.
 */

import { normaliseOptionMaps } from "@/lib/sms/assessment-mapping";
import type {
  SmsSurveyQuestionRow,
  SmsSurveyChoiceOption,
  SmsSurveyScaleRange,
} from "@/types/sms";

/** §4.1: completion cliffs after ~5 questions — builder warning cap. */
export const SURVEY_QUESTION_SOFT_CAP = 5;

/** campaign_activity_ratings.binary_value / sms_interactions.maps_to_binary are VARCHAR(30). */
const BINARY_VALUE_MAX = 30;
/** sms_survey_answers.parsed_value is VARCHAR(50). */
export const PARSED_VALUE_MAX = 50;

const YES_SYNONYMS = new Set([
  "yes", "y", "yeah", "yeh", "yep", "yea", "ya", "yas", "ok", "okay",
  "sure", "si", "aye", "definitely", "absolutely", "true", "1",
]);
const NO_SYNONYMS = new Set([
  "no", "n", "nope", "nah", "na", "never", "negative", "false", "2",
]);

/**
 * Inline STOP guard (belt — Mobile Message intercepts STOP platform-
 * side per brief §2.3 constraint 3, so this rarely fires; when it
 * does, the reply is an opt-out, never a survey answer).
 */
const STOP_RE = /^\s*(stop|unsubscribe|opt\s*out|optout)\s*[.!]*\s*$/i;

export function isStopKeyword(body: string | null | undefined): boolean {
  return !!body && STOP_RE.test(body);
}

/**
 * Lowercase, strip punctuation, collapse whitespace. Apostrophes are
 * removed (not space-replaced) so "I'll"/"can't" match the synonym
 * forms "ill"/"cant".
 */
export function normaliseAnswer(raw: string): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Options JSONB → sanitised option list. Hardened against malformed
 * authoring (staff can write arbitrary JSONB via PostgREST, bypassing
 * route validation): non-string labels fall back to the value, and
 * synonyms are filtered to strings — a poison option must never make
 * the parser throw (a webhook 500 would wedge the session until TTL).
 */
export function choiceOptions(
  question: Pick<SmsSurveyQuestionRow, "qtype" | "options">,
): SmsSurveyChoiceOption[] {
  if (question.qtype !== "choice" || !Array.isArray(question.options)) return [];
  return (question.options as unknown[])
    .filter(
      (o): o is Record<string, unknown> =>
        !!o && typeof o === "object" && typeof (o as { value?: unknown }).value === "string",
    )
    .map((o) => {
      const maps = normaliseOptionMaps({
        maps_to_rating:
          typeof o.maps_to_rating === "number" ? o.maps_to_rating : null,
        maps_to_binary:
          typeof o.maps_to_binary === "string" ? o.maps_to_binary : null,
      });
      return {
        value: o.value as string,
        label: typeof o.label === "string" ? o.label : (o.value as string),
        synonyms: Array.isArray(o.synonyms)
          ? (o.synonyms as unknown[]).filter((s): s is string => typeof s === "string")
          : [],
        maps_to_rating: maps.maps_to_rating,
        maps_to_binary: maps.maps_to_binary,
      };
    });
}

export function scaleRange(
  question: Pick<SmsSurveyQuestionRow, "qtype" | "options">,
): SmsSurveyScaleRange {
  const fallback: SmsSurveyScaleRange = { min: 1, max: 5 };
  if (question.qtype !== "scale") return fallback;
  const o = question.options as Partial<SmsSurveyScaleRange> | null;
  const min = typeof o?.min === "number" && Number.isFinite(o.min) ? o.min : fallback.min;
  const max = typeof o?.max === "number" && Number.isFinite(o.max) ? o.max : fallback.max;
  return max > min ? { min, max } : fallback;
}

export type ParseResult =
  | { kind: "parsed"; value: string }
  | { kind: "invalid" }
  /** Long free-text on a non-open question: capture verbatim, surface to a human, no retry burnt (runtime still sends a re-prompt so the member is not left hanging). */
  | { kind: "freetext_on_choice" };

/** ≥3 words or >60 chars of unmatched text reads as a real message, not a failed menu pick. */
function looksLikeFreeText(normalised: string, raw: string): boolean {
  if (!normalised) return false;
  return normalised.split(" ").length >= 3 || raw.trim().length > 60;
}

/** Bare integer extraction ("3", " 3.", "3!!"): null when anything else rides along. */
function bareInteger(normalised: string): number | null {
  if (!/^\d+$/.test(normalised)) return null;
  const n = Number(normalised);
  return Number.isSafeInteger(n) ? n : null;
}

export function parseAnswer(
  question: Pick<SmsSurveyQuestionRow, "qtype" | "options">,
  rawBody: string,
): ParseResult {
  const raw = rawBody ?? "";
  const normalised = normaliseAnswer(raw);

  if (question.qtype === "open_text") {
    return raw.trim()
      ? { kind: "parsed", value: raw.trim() }
      : { kind: "invalid" };
  }

  if (!normalised) return { kind: "invalid" };

  if (question.qtype === "yes_no") {
    // Whole-reply first, then the first token ("yes please").
    const first = normalised.split(" ")[0];
    if (YES_SYNONYMS.has(normalised) || YES_SYNONYMS.has(first)) {
      return { kind: "parsed", value: "yes" };
    }
    if (NO_SYNONYMS.has(normalised) || NO_SYNONYMS.has(first)) {
      return { kind: "parsed", value: "no" };
    }
    return looksLikeFreeText(normalised, raw)
      ? { kind: "freetext_on_choice" }
      : { kind: "invalid" };
  }

  if (question.qtype === "scale") {
    const { min, max } = scaleRange(question);
    const n = bareInteger(normalised);
    if (n != null && n >= min && n <= max) {
      return { kind: "parsed", value: String(n) };
    }
    return looksLikeFreeText(normalised, raw)
      ? { kind: "freetext_on_choice" }
      : { kind: "invalid" };
  }

  // choice — value → label → synonyms → first-token of those →
  // numeric menu position. First-token keeps "Yes please" / "No thanks"
  // working the same way yes_no does (case-insensitive via normalise).
  const opts = choiceOptions(question);
  const first = normalised.split(" ")[0] ?? "";
  const matchesOption = (candidate: string, o: SmsSurveyChoiceOption) => {
    const n = normaliseAnswer(candidate);
    if (!n) return false;
    if (normaliseAnswer(o.value) === n) return true;
    if (o.label && normaliseAnswer(o.label) === n) return true;
    return (o.synonyms ?? []).some((syn) => normaliseAnswer(syn) === n);
  };
  for (const o of opts) {
    if (matchesOption(normalised, o) || matchesOption(first, o)) {
      return { kind: "parsed", value: o.value };
    }
  }
  const pos = bareInteger(normalised);
  if (pos != null && pos >= 1 && pos <= opts.length) {
    return { kind: "parsed", value: opts[pos - 1].value };
  }
  return looksLikeFreeText(normalised, raw)
    ? { kind: "freetext_on_choice" }
    : { kind: "invalid" };
}

// ─── Branching ──────────────────────────────────────────────────────

export type NextStep =
  | { kind: "question"; question: SmsSurveyQuestionRow }
  | { kind: "complete" };

/**
 * Branching override for the parsed value, else the next question by
 * sort_order, else complete. Unknown branch targets fall through to
 * sort order (belt against stale authoring).
 */
export function nextStep(
  questions: SmsSurveyQuestionRow[],
  current: SmsSurveyQuestionRow,
  parsedValue: string,
): NextStep {
  const ordered = [...questions].sort(
    (a, b) => a.sort_order - b.sort_order || a.question_id - b.question_id,
  );

  const branching = current.branching;
  if (branching && typeof branching === "object") {
    const target =
      branching[parsedValue] ??
      // Tolerate normalised-key authoring ("Yes" vs "yes").
      branching[normaliseAnswer(parsedValue)];
    if (target === "end") return { kind: "complete" };
    if (typeof target === "number") {
      const q = ordered.find((x) => x.question_id === target);
      if (q) return { kind: "question", question: q };
    }
  }

  const idx = ordered.findIndex((q) => q.question_id === current.question_id);
  const next = idx >= 0 ? ordered[idx + 1] : undefined;
  return next ? { kind: "question", question: next } : { kind: "complete" };
}

// ─── Rendering ──────────────────────────────────────────────────────

function numberedMenu(opts: SmsSurveyChoiceOption[]): string {
  return opts.map((o, i) => `${i + 1}. ${o.label || o.value}`).join("\n");
}

export function renderQuestion(question: SmsSurveyQuestionRow): string {
  const prompt = question.prompt.trim();
  switch (question.qtype) {
    case "choice": {
      const opts = choiceOptions(question);
      return opts.length > 0 ? `${prompt}\n${numberedMenu(opts)}` : prompt;
    }
    case "yes_no":
      return `${prompt}\nReply YES or NO`;
    case "scale": {
      const { min, max } = scaleRange(question);
      return `${prompt}\nReply with a number from ${min} to ${max}`;
    }
    default:
      return prompt;
  }
}

/**
 * Invitation + first question in ONE send (decided in-phase: a
 * second message would double invitation cost, and "invited" then
 * cleanly means "has the first question in hand").
 */
export function renderInvitation(
  invitationBody: string | null,
  firstQuestion: SmsSurveyQuestionRow,
): string {
  const intro = invitationBody?.trim();
  const q = renderQuestion(firstQuestion);
  return intro ? `${intro}\n\n${q}` : q;
}

/** Question-timeout nudge (one per question). */
export function renderNudge(question: SmsSurveyQuestionRow): string {
  const custom = question.nudge_text?.trim();
  if (custom) return custom;
  return `Just checking in — when you have a moment:\n${renderQuestion(question)}`;
}

/** Reminder copy (varied from the nudge; max reminder_offsets.length sends). */
export function renderReminder(question: SmsSurveyQuestionRow): string {
  return `We'd still love to hear from you. ${renderQuestion(question)}`;
}

// ─── Retry ladder ───────────────────────────────────────────────────

export type RetryStep =
  | { kind: "reprompt"; body: string }
  | { kind: "handoff" };

function optionSummary(question: SmsSurveyQuestionRow): string {
  switch (question.qtype) {
    case "choice": {
      const opts = choiceOptions(question);
      return opts.map((o) => o.label || o.value).join(", ");
    }
    case "yes_no":
      return "YES or NO";
    case "scale": {
      const { min, max } = scaleRange(question);
      return `a number from ${min} to ${max}`;
    }
    default:
      return "";
  }
}

/**
 * §4.1 retry ladder. `retriesSoFar` = invalid replies already burnt
 * on this question BEFORE the current one:
 *   0 → specific re-prompt with the options (or invalid_prompt),
 *   1 → restructured numbered menu,
 *   ≥ retryLimit → hand off to a human with the transcript.
 */
export function retryLadder(
  question: SmsSurveyQuestionRow,
  retriesSoFar: number,
  retryLimit: number,
): RetryStep {
  if (retriesSoFar >= retryLimit) return { kind: "handoff" };

  if (retriesSoFar === 0) {
    const custom = question.invalid_prompt?.trim();
    if (custom) return { kind: "reprompt", body: custom };
    const summary = optionSummary(question);
    return {
      kind: "reprompt",
      body: summary
        ? `Sorry, we didn't catch that. Please reply with ${summary}.`
        : `Sorry, we didn't catch that. ${renderQuestion(question)}`,
    };
  }

  // Second (and any later pre-handoff) attempt: strip back to a
  // bare numbered menu / minimal instruction.
  switch (question.qtype) {
    case "choice": {
      const opts = choiceOptions(question);
      return {
        kind: "reprompt",
        body: `Please reply with just a number:\n${numberedMenu(opts)}`,
      };
    }
    case "yes_no":
      return {
        kind: "reprompt",
        body: "Please reply with just YES or NO.",
      };
    case "scale": {
      const { min, max } = scaleRange(question);
      return {
        kind: "reprompt",
        body: `Please reply with just a number from ${min} to ${max}.`,
      };
    }
    default:
      return {
        kind: "reprompt",
        body: `Please reply with a short answer. ${renderQuestion(question)}`,
      };
  }
}

// ─── Outcome mapping (answer → rating write) ────────────────────────

export interface OutcomeMapping {
  rating: number | null;
  binary: string | null;
}

/**
 * How a parsed answer maps onto the existing sms_interactions →
 * trg_sms_to_rating pipeline (brief §5.1), method-aware:
 *   yes_no → binary assessment only (yes|no),
 *   scale 1–5 → scale assessment only,
 *   choice → explicit per-option maps_to_rating / maps_to_binary
 *            (no digit/heuristic fallback),
 *   mismatched method or unmapped choice option → no write.
 */
export function outcomeMapping(
  question: Pick<SmsSurveyQuestionRow, "qtype" | "options">,
  parsedValue: string,
  opts?: { isBinary?: boolean | null },
): OutcomeMapping {
  const none: OutcomeMapping = { rating: null, binary: null };
  const isBinary = opts?.isBinary;

  switch (question.qtype) {
    case "open_text":
      return none;
    case "yes_no":
      if (isBinary === false) return none;
      return { rating: null, binary: parsedValue.slice(0, BINARY_VALUE_MAX) };
    case "scale": {
      if (isBinary === true) return none;
      const n = Number(parsedValue);
      return Number.isInteger(n) && n >= 1 && n <= 5
        ? { rating: n, binary: null }
        : none;
    }
    case "choice": {
      const opt = choiceOptions(question).find((o) => o.value === parsedValue);
      if (!opt) return none;
      if (isBinary === true) {
        return opt.maps_to_binary
          ? {
              rating: null,
              binary: opt.maps_to_binary.slice(0, BINARY_VALUE_MAX),
            }
          : none;
      }
      if (isBinary === false) {
        return typeof opt.maps_to_rating === "number"
          ? { rating: opt.maps_to_rating, binary: null }
          : none;
      }
      // Method unknown — honour whichever explicit map is set.
      if (typeof opt.maps_to_rating === "number") {
        return { rating: opt.maps_to_rating, binary: null };
      }
      if (opt.maps_to_binary) {
        return {
          rating: null,
          binary: opt.maps_to_binary.slice(0, BINARY_VALUE_MAX),
        };
      }
      return none;
    }
    default:
      return none;
  }
}
