"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareText, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatPercent,
  formatSliceValue,
  sliceTotal,
  type ReportSlice,
  type SurveyReportLabelMode,
} from "@/lib/sms/survey-report";
import { cn } from "@/lib/utils";

export function SurveyReportDashboard(props: {
  status: string;
  invited: number;
  started: number;
  completed: number;
  participation: ReportSlice[];
  questions: Array<{
    id: string;
    prompt: string;
    qtype: string;
    slices: ReportSlice[];
    answered: number;
    unparsed: number;
  }>;
}) {
  const router = useRouter();
  const [labelMode, setLabelMode] = useState<SurveyReportLabelMode>("count");
  const live = props.status === "open" || props.status === "paused";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {live ? <Badge>Live</Badge> : null}
          <span>What the group said</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border p-0.5">
            {(["count", "percent"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={labelMode === mode}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium",
                  labelMode === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
                onClick={() => setLabelMode(mode)}
              >
                {mode === "count" ? "#" : "%"}
              </button>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => router.refresh()} aria-label="Refresh results">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <div className="grid grid-cols-3 gap-3">
          <Headline label="Invited" value={props.invited} />
          <Headline label="Started" value={props.started} sub={`${formatPercent(props.started, props.invited)} of invited`} />
          <Headline label="Completed" value={props.completed} sub={`${formatPercent(props.completed, props.invited)} of invited`} accent />
        </div>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">Participation</CardTitle>
          </CardHeader>
          <CardContent>
            <SlicePie slices={props.participation} labelMode={labelMode} height={170} emptyText="Nobody has been invited yet" />
            <SliceLegend slices={props.participation} />
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {props.questions.map((question, index) => {
          const total = sliceTotal(question.slices);
          const answered = question.qtype === "open_text" ? question.answered : total;
          return (
            <Card key={question.id}>
              <CardHeader className="pb-1">
                <CardTitle className="flex items-start gap-2 text-sm font-medium">
                  <Badge>Q{index + 1}</Badge>
                  <span>{question.prompt}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {question.qtype === "open_text" ? (
                  <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground">
                    <MessageSquareText className="h-4 w-4 shrink-0" />
                    Free-text question. Export the CSV to read each reply.
                  </div>
                ) : (
                  <>
                    <SlicePie slices={question.slices} labelMode={labelMode} height={200} emptyText="No answers yet" />
                    <SliceLegend slices={question.slices} />
                  </>
                )}
                <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                  {answered.toLocaleString()} answered
                  {props.invited > 0 ? ` · ${formatPercent(answered, props.invited)} of invited` : ""}
                  {question.qtype !== "open_text" && question.unparsed > 0
                    ? ` · ${question.unparsed} free-text ${question.unparsed === 1 ? "reply" : "replies"}`
                    : ""}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Headline({ label, value, sub, accent }: { label: string; value: number; sub?: string; accent?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn("text-3xl font-semibold tabular-nums", accent && "text-emerald-600")}>{value.toLocaleString()}</p>
        {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

function SlicePie({
  slices,
  labelMode,
  height,
  emptyText,
}: {
  slices: ReportSlice[];
  labelMode: SurveyReportLabelMode;
  height: number;
  emptyText: string;
}) {
  const total = sliceTotal(slices);
  if (!slices.length || total === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        {emptyText}
      </div>
    );
  }
  const radius = height * 0.34;
  const cx = 120;
  const cy = height / 2;
  const arcs = slices.reduce<Array<{ slice: ReportSlice; start: number; end: number }>>((list, slice) => {
    const start = list.at(-1)?.end ?? 0;
    const sweep = (slice.value / total) * 360;
    list.push({ slice, start, end: start + sweep });
    return list;
  }, []);
  return (
    <svg width="100%" height={height} viewBox={`0 0 240 ${height}`} role="img" aria-label="Response chart">
      {arcs.length === 1 ? (
        <circle cx={cx} cy={cy} r={radius} fill={arcs[0].slice.color} />
      ) : (
        arcs.map(({ slice, start, end }) => (
          <path key={slice.key} d={wedge(cx, cy, radius, start, end)} fill={slice.color}>
            <title>{`${slice.name}: ${formatSliceValue(slice.value, total, labelMode)}`}</title>
          </path>
        ))
      )}
    </svg>
  );
}

function wedge(cx: number, cy: number, radius: number, start: number, end: number): string {
  const point = (angle: number) => {
    const radians = ((angle - 90) * Math.PI) / 180;
    return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)];
  };
  const [x1, y1] = point(start);
  const [x2, y2] = point(end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
}

function SliceLegend({ slices }: { slices: ReportSlice[] }) {
  const total = sliceTotal(slices);
  if (!slices.length || total === 0) return null;
  return (
    <ul className="mt-1 space-y-1">
      {slices.map((slice) => (
        <li key={slice.key} className="flex items-center gap-2 text-xs">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: slice.color }} />
          <span className="truncate">{slice.name}</span>
          <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
            {slice.value.toLocaleString()} · {formatPercent(slice.value, total)}
          </span>
        </li>
      ))}
    </ul>
  );
}
