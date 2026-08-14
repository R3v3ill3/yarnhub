/**
 * Survey definition payload validation (brief §4.1 authoring model) —
 * pure, shared by the create/update routes. The builder UI references
 * branch targets by QUESTION INDEX (positions are stable while
 * authoring); the routes rewrite indexes to real question_ids after
 * insert.
 */
import type {
  SmsSurveyChoiceOption,
  SmsSurveyQuestionType,
  SmsSurveyScaleRange,
} from "@/types/sms";

export interface SurveyQuestionInput {
  prompt?: string;
  qtype?: SmsSurveyQuestionType;
  options?: SmsSurveyChoiceOption[] | SmsSurveyScaleRange | null;
  /** Branch targets by question INDEX (0-based) or 'end'. */
  branching?: Record<string, number | "end"> | null;
  write_rating?: boolean;
  /** Phase 8: per-question override of the survey's ratings target. */
  activity_id?: number | null;
  invalid_prompt?: string | null;
  nudge_text?: string | null;
}

/**
 * Phase 5 (brief §4.2/§8.1) — the fixed indicative-only compliance
 * banner. Client-safe: the editor renders it verbatim (non-editable)
 * and the routes cite it when rejecting a non-indicative ballot open.
 */
export const BALLOT_COMPLIANCE_BANNER =
  "Indicative poll only — formal protected action ballots must be conducted by the AEC or an FWC-approved ballot agent.";

/** Auto-appended to a ballot invitation that lacks the required word. */
export const BALLOT_INDICATIVE_SENTENCE =
  "This is an indicative poll only — it does not replace a formal AEC ballot.";

/**
 * Stored framing requirement (§8.1): a ballot invitation must
 * describe the poll as "indicative". Validated at open (route) and
 * re-checked at dispatch (cron).
 */
export function invitationMentionsIndicative(
  invitationBody: string | null | undefined,
): boolean {
  return /\bindicative\b/i.test(invitationBody ?? "");
}

export interface SurveySettingsInput {
  title?: string;
  purpose?: string;
  revote_policy?: string;
  results_restricted?: boolean;
  activity_id?: number | null;
  /** Phase 8: the worker list this survey was fired from (Build List -> SMS -> Survey). */
  source_worker_list_id?: number | null;
  sender_number_id?: number | null;
  timezone?: string;
  blackout_override?: boolean;
  blackout_override_reason?: string | null;
  retry_limit?: number;
  question_timeout_minutes?: number;
  session_ttl_hours?: number;
  reminder_offsets?: number[];
  handoff_escalate_to?: string | null;
  invitation_body?: string | null;
  completion_body?: string | null;
  /** Default true for new surveys — trusted-group test mode. */
  is_test?: boolean;
  /**
   * Required when a paused edit includes high-risk integrity findings
   * (must equal "EDIT").
   */
  acknowledge_high_risk?: string | null;
}

const QTYPES: SmsSurveyQuestionType[] = ["choice", "yes_no", "scale", "open_text"];

export function validateSurveySettings(input: SurveySettingsInput): string[] {
  const errors: string[] = [];
  if (input.title !== undefined && !input.title.trim()) {
    errors.push("Title is required.");
  }
  if (
    input.purpose !== undefined &&
    !["survey", "indicative_ballot"].includes(input.purpose)
  ) {
    errors.push("Invalid purpose.");
  }
  if (
    input.revote_policy !== undefined &&
    !["locked", "revote_until_close"].includes(input.revote_policy)
  ) {
    errors.push("Invalid revote policy.");
  }
  if (
    input.retry_limit !== undefined &&
    (!Number.isInteger(input.retry_limit) ||
      input.retry_limit < 0 ||
      input.retry_limit > 5)
  ) {
    errors.push("Retry limit must be 0-5.");
  }
  if (
    input.question_timeout_minutes !== undefined &&
    (!Number.isInteger(input.question_timeout_minutes) ||
      input.question_timeout_minutes < 10 ||
      input.question_timeout_minutes > 10080)
  ) {
    errors.push("Question timeout must be 10 minutes to 7 days.");
  }
  if (
    input.session_ttl_hours !== undefined &&
    (!Number.isInteger(input.session_ttl_hours) ||
      input.session_ttl_hours < 1 ||
      input.session_ttl_hours > 720)
  ) {
    errors.push("Session TTL must be 1-720 hours.");
  }
  if (input.reminder_offsets !== undefined) {
    const r = input.reminder_offsets;
    if (
      !Array.isArray(r) ||
      r.length > 2 ||
      r.some((n) => !Number.isInteger(n) || n <= 0 || n > 20160)
    ) {
      errors.push(
        "Reminder offsets must be at most 2 positive minute values (§4.1: max 2 reminders).",
      );
    }
  }
  if (input.blackout_override && !input.blackout_override_reason?.trim()) {
    errors.push("Blackout override requires a reason.");
  }
  return errors;
}

/**
 * Cycle detection over the question graph (edges: default next-in-
 * order + every branch target). A backward branch always forms a
 * cycle with the default chain, so branches may effectively only
 * point forward or to End — a loop would let a member be re-asked
 * questions forever.
 */
function hasBranchCycle(questions: SurveyQuestionInput[]): boolean {
  const n = questions.length;
  const adjacency: number[][] = questions.map((q, i) => {
    const edges: number[] = [];
    if (i + 1 < n) edges.push(i + 1);
    for (const target of Object.values(q.branching ?? {})) {
      if (target !== "end" && Number.isInteger(target) && target >= 0 && target < n) {
        edges.push(target);
      }
    }
    return edges;
  });
  // 0 = unvisited, 1 = on the current DFS stack, 2 = done.
  const state = new Array<number>(n).fill(0);
  const dfs = (u: number): boolean => {
    state[u] = 1;
    for (const v of adjacency[u]) {
      if (state[v] === 1) return true;
      if (state[v] === 0 && dfs(v)) return true;
    }
    state[u] = 2;
    return false;
  };
  for (let i = 0; i < n; i++) {
    if (state[i] === 0 && dfs(i)) return true;
  }
  return false;
}

export function validateSurveyQuestions(
  questions: SurveyQuestionInput[],
  purpose?: string,
): string[] {
  const errors: string[] = [];
  if (!Array.isArray(questions) || questions.length === 0) {
    return ["At least one question is required."];
  }
  // A ballot's Q1 must be parseable as a vote — the completed-session
  // revote leg treats a parsed Q1 answer as a vote attempt, and an
  // open_text Q1 parses everything (it would swallow every
  // conversational message from completed voters).
  if (purpose === "indicative_ballot" && questions[0]?.qtype === "open_text") {
    errors.push(
      "An indicative ballot's first question must be a choice, yes/no or scale question.",
    );
  }
  questions.forEach((q, i) => {
    const label = `Question ${i + 1}`;
    if (!q.prompt?.trim()) errors.push(`${label}: prompt is required.`);
    if (!q.qtype || !QTYPES.includes(q.qtype)) {
      errors.push(`${label}: invalid question type.`);
      return;
    }
    if (q.qtype === "choice") {
      const opts = Array.isArray(q.options)
        ? (q.options as SmsSurveyChoiceOption[])
        : [];
      if (opts.length < 2) {
        errors.push(`${label}: choice questions need at least 2 options.`);
      }
      const values = opts.map((o) => o?.value?.trim()).filter(Boolean);
      if (values.length !== opts.length) {
        errors.push(`${label}: every option needs a value.`);
      }
      if (new Set(values.map((v) => v!.toLowerCase())).size !== values.length) {
        errors.push(`${label}: option values must be unique.`);
      }
    }
    if (q.qtype === "scale") {
      const o = q.options as Partial<SmsSurveyScaleRange> | null | undefined;
      if (
        !o ||
        !Number.isInteger(o.min) ||
        !Number.isInteger(o.max) ||
        (o.min as number) >= (o.max as number)
      ) {
        errors.push(`${label}: scale needs integer min < max.`);
      }
    }
    if (
      q.activity_id !== undefined &&
      q.activity_id !== null &&
      (!Number.isInteger(q.activity_id) || q.activity_id <= 0)
    ) {
      errors.push(`${label}: activity_id must be null or a positive integer.`);
    }
    if (q.activity_id != null && !q.write_rating) {
      errors.push(
        `${label}: linking an assessment requires write_rating to be on.`,
      );
    }
    if (q.write_rating && (q.activity_id == null || q.activity_id === undefined)) {
      errors.push(
        `${label}: write_rating requires a per-question assessment activity.`,
      );
    }
    if (q.qtype === "open_text" && q.activity_id != null) {
      errors.push(
        `${label}: open-text questions cannot write to an assessment.`,
      );
    }
    if (q.branching) {
      for (const [value, target] of Object.entries(q.branching)) {
        if (target === "end") continue;
        if (
          !Number.isInteger(target) ||
          (target as number) < 0 ||
          (target as number) >= questions.length
        ) {
          errors.push(
            `${label}: branch for "${value}" points at a non-existent question.`,
          );
        } else if (target === i) {
          errors.push(`${label}: a branch cannot point at itself.`);
        }
      }
    }
  });
  if (errors.length === 0 && hasBranchCycle(questions)) {
    errors.push(
      "Branching contains a loop — branches may only point forward or to End.",
    );
  }
  return errors;
}
