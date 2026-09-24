import { choiceOptions, scaleRange } from "@/lib/sms/survey-engine";
import type { SmsSurveyQuestionType } from "@/types/sms";

export type SurveyReportLabelMode = "count" | "percent";

export interface ReportSlice {
  key: string;
  name: string;
  value: number;
  color: string;
}

export interface SurveyFunnel {
  ever_invited_count: number;
  started_count: number;
  completed_count: number;
}

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

const SCALE_RAMP = ["#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e"];
const SEMANTIC_COLORS: Record<string, string> = {
  yes: "#22c55e",
  no: "#ef4444",
  maybe: "#f59e0b",
  unsure: "#f59e0b",
  abstain: "#94a3b8",
};

const INVITED = new Set(["invited", "active", "completed", "expired", "opted_out", "handed_off"]);

export function funnelFromSessions(
  sessions: Array<{ state: string; first_answer_at: string | null }>,
): SurveyFunnel {
  let invited = 0;
  let started = 0;
  let completed = 0;
  for (const session of sessions) {
    if (!INVITED.has(session.state)) continue;
    invited += 1;
    if (session.first_answer_at != null || session.state === "active" || session.state === "completed" || session.state === "handed_off") {
      started += 1;
    }
    if (session.state === "completed") completed += 1;
  }
  return {
    ever_invited_count: invited,
    started_count: Math.min(started, invited),
    completed_count: completed,
  };
}

export function participationSlices(funnel: SurveyFunnel | null | undefined): ReportSlice[] {
  const invited = funnel?.ever_invited_count ?? 0;
  const started = funnel?.started_count ?? 0;
  const completed = funnel?.completed_count ?? 0;
  return [
    { key: "completed", name: "Completed", value: completed, color: "#22c55e" },
    { key: "in_progress", name: "Started, not finished", value: Math.max(0, started - completed), color: "#f59e0b" },
    { key: "no_response", name: "No response", value: Math.max(0, invited - started), color: "#cbd5e1" },
  ].filter((slice) => slice.value > 0);
}

function semanticColor(value: string): string | null {
  return SEMANTIC_COLORS[value.trim().toLowerCase()] ?? null;
}

function scaleColor(value: string, min: number, max: number): string {
  const n = Number(value);
  if (!Number.isFinite(n) || max <= min) return REPORT_PALETTE[0];
  const ratio = (n - min) / (max - min);
  const idx = Math.min(SCALE_RAMP.length - 1, Math.max(0, Math.round(ratio * (SCALE_RAMP.length - 1))));
  return SCALE_RAMP[idx];
}

export function questionSlices(
  question: { question_id: string; qtype: SmsSurveyQuestionType; options: unknown },
  answers: Array<{ question_id: string; parsed_value: string | null }>,
): ReportSlice[] {
  const counts = new Map<string, number>();
  for (const answer of answers) {
    if (answer.question_id !== question.question_id || answer.parsed_value == null) continue;
    counts.set(answer.parsed_value, (counts.get(answer.parsed_value) ?? 0) + 1);
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
    const { min, max } = scaleRange({ qtype: "scale", options: question.options as { min: number; max: number } | null });
    for (let n = min; n <= max; n += 1) take(String(n), String(n), scaleColor(String(n), min, max));
  } else if (question.qtype === "choice") {
    choiceOptions({ qtype: "choice", options: question.options as never }).forEach((option, index) => {
      take(option.value, option.label || option.value, semanticColor(option.value) ?? REPORT_PALETTE[index % REPORT_PALETTE.length]);
    });
  }
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
  return slices.reduce((sum, slice) => sum + slice.value, 0);
}

export function formatPercent(value: number, total: number): string {
  if (total <= 0) return "0%";
  const pct = (value / total) * 100;
  const rounded = pct >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  return `${rounded}%`;
}

export function formatSliceValue(value: number, total: number, mode: SurveyReportLabelMode): string {
  return mode === "percent" ? formatPercent(value, total) : value.toLocaleString();
}
