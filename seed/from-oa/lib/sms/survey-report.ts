/**
 * Pure shaping for the visual survey report (pie slices + labels).
 *
 * Kept out of the chart component so the mapping from stored
 * parsed_value → human label → colour is unit-testable: parsed
 * values are terse ("yes", "3", an option's `value`), the pie has to
 * read like the question the member was asked.
 *
 * Unit tested in __tests__/survey-report.test.ts.
 */
import { choiceOptions, scaleRange } from "@/lib/sms/survey-engine";
import type {
  SmsSurveyQuestionRow,
  VwSmsSurveyAnswerDistributionRow,
  VwSmsSurveyFunnelRow,
} from "@/types/sms";

/** Slice labels show the raw count or the share of the pie. */
export type SurveyReportLabelMode = "count" | "percent";

export interface ReportSlice {
  /** Stable react key + the stored parsed_value for answer slices. */
  key: string;
  /** Human label — option label, Yes/No, the scale number, or a funnel stage. */
  name: string;
  value: number;
  color: string;
}

/** Fallback palette for choice options with no semantic reading. */
export const REPORT_PALETTE = [
  "#6366f1",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#0ea5e9",
  "#8b5cf6",
  "#14b8a6",
  "#ec4899",
  "#84cc16",
  "#64748b",
];

/** Low → high ramp for scale questions (1 = red, top = green). */
const SCALE_RAMP = ["#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e"];

/**
 * Values that carry a fixed reading wherever they appear — yes/no
 * questions, and choice options authored with those values.
 */
const SEMANTIC_COLORS: Record<string, string> = {
  yes: "#22c55e",
  no: "#ef4444",
  maybe: "#f59e0b",
  unsure: "#f59e0b",
  abstain: "#94a3b8",
};

const PARTICIPATION_COLORS = {
  completed: "#22c55e",
  in_progress: "#f59e0b",
  no_response: "#cbd5e1",
};

function semanticColor(value: string): string | null {
  return SEMANTIC_COLORS[value.trim().toLowerCase()] ?? null;
}

function scaleColor(value: string, min: number, max: number): string {
  const n = Number(value);
  if (!Number.isFinite(n) || max <= min) return REPORT_PALETTE[0];
  const ratio = (n - min) / (max - min);
  const idx = Math.min(
    SCALE_RAMP.length - 1,
    Math.max(0, Math.round(ratio * (SCALE_RAMP.length - 1))),
  );
  return SCALE_RAMP[idx];
}

/**
 * The three headline numbers as mutually exclusive slices of the
 * invited audience: finished, mid-survey, never replied. Sessions
 * that were never invited (still queued) are out of the pie —
 * they have not been asked anything yet.
 */
export function participationSlices(
  funnel: VwSmsSurveyFunnelRow | null | undefined,
): ReportSlice[] {
  const invited = funnel?.ever_invited_count ?? 0;
  const started = funnel?.started_count ?? 0;
  const completed = funnel?.completed_count ?? 0;
  const inProgress = Math.max(0, started - completed);
  const noResponse = Math.max(0, invited - started);
  return [
    {
      key: "completed",
      name: "Completed",
      value: completed,
      color: PARTICIPATION_COLORS.completed,
    },
    {
      key: "in_progress",
      name: "Started, not finished",
      value: inProgress,
      color: PARTICIPATION_COLORS.in_progress,
    },
    {
      key: "no_response",
      name: "No response",
      value: noResponse,
      color: PARTICIPATION_COLORS.no_response,
    },
  ].filter((s) => s.value > 0);
}

/**
 * Answer distribution for one question, in the order the member saw
 * the options (authored order for choice, Yes→No, ascending for
 * scale). Values that no longer match an authored option — an option
 * renamed after launch — keep their stored value as the label rather
 * than disappearing from the total.
 */
export function questionSlices(
  question: Pick<SmsSurveyQuestionRow, "question_id" | "qtype" | "options">,
  rows: Pick<
    VwSmsSurveyAnswerDistributionRow,
    "question_id" | "parsed_value" | "answer_count" | "completed_answer_count"
  >[],
  opts?: { completedOnly?: boolean },
): ReportSlice[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.question_id !== question.question_id) continue;
    if (row.parsed_value == null) continue;
    const count = opts?.completedOnly
      ? row.completed_answer_count
      : row.answer_count;
    if (count <= 0) continue;
    counts.set(row.parsed_value, (counts.get(row.parsed_value) ?? 0) + count);
  }
  if (counts.size === 0) return [];

  const slices: ReportSlice[] = [];
  const take = (value: string, name: string, color: string) => {
    const count = counts.get(value);
    if (count == null) return;
    counts.delete(value);
    slices.push({ key: value, name, value: count, color });
  };

  if (question.qtype === "yes_no") {
    take("yes", "Yes", SEMANTIC_COLORS.yes);
    take("no", "No", SEMANTIC_COLORS.no);
  } else if (question.qtype === "scale") {
    const { min, max } = scaleRange(question);
    for (let n = min; n <= max; n += 1) {
      take(String(n), String(n), scaleColor(String(n), min, max));
    }
  } else {
    choiceOptions(question).forEach((option, i) => {
      take(
        option.value,
        option.label || option.value,
        semanticColor(option.value) ?? REPORT_PALETTE[i % REPORT_PALETTE.length],
      );
    });
  }

  // Anything left is a stored value with no matching option today.
  let extra = slices.length;
  for (const [value, count] of counts) {
    slices.push({
      key: value,
      name: value,
      value: count,
      color: semanticColor(value) ?? REPORT_PALETTE[extra % REPORT_PALETTE.length],
    });
    extra += 1;
  }
  return slices;
}

export function sliceTotal(slices: ReportSlice[]): number {
  return slices.reduce((sum, s) => sum + s.value, 0);
}

/** Whole numbers below 10%, one decimal above — 33.3% reads better than 33%. */
export function formatPercent(value: number, total: number): string {
  if (total <= 0) return "0%";
  const pct = (value / total) * 100;
  const rounded = pct >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  return `${rounded}%`;
}

export function formatSliceValue(
  value: number,
  total: number,
  mode: SurveyReportLabelMode,
): string {
  return mode === "percent"
    ? formatPercent(value, total)
    : value.toLocaleString();
}
