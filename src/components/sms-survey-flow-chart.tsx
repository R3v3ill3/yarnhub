"use client";

import { edgePath, layoutSurveyFlow, type FlowQuestion } from "@/lib/sms/survey-flow";
import { cn } from "@/lib/utils";

export function SmsSurveyFlowChart({
  questions,
  selectedIndex = null,
  onSelectQuestion,
  markerId = "survey-flow",
}: {
  questions: FlowQuestion[];
  selectedIndex?: number | null;
  onSelectQuestion?: (index: number) => void;
  markerId?: string;
}) {
  const { edges, nodes, width, height } = layoutSurveyFlow(questions);
  const start = nodes.get("start");
  const end = nodes.get("end");

  return (
    <div className="min-w-0 rounded-md border-2 border-border bg-muted/30">
      <div className="border-b border-border px-3 py-2">
        <p className="text-xs font-medium">Structure</p>
        <p className="text-[11px] text-muted-foreground">
          A straight line means each question follows the last. Yes and no can jump ahead or end the survey.
        </p>
      </div>
      <div className="overflow-auto p-2">
        <svg
          width={Math.max(width, 220)}
          height={Math.max(height, 180)}
          role="img"
          aria-label="Survey question flow"
          className="block"
        >
          <defs>
            <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
            </marker>
            <marker id={`${markerId}-active`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#4f46e5" />
            </marker>
          </defs>
          {edges.map((edge, index) => {
            const from = nodes.get(edge.from);
            const to = nodes.get(edge.to);
            if (!from || !to) return null;
            const active = selectedIndex != null && (edge.from === selectedIndex || edge.to === selectedIndex);
            return (
              <g key={`${edge.from}-${edge.to}-${edge.label ?? ""}-${index}`}>
                <path
                  d={edgePath(from, to)}
                  fill="none"
                  stroke={active ? "#4f46e5" : "#64748b"}
                  strokeWidth={active ? 2 : 1.5}
                  strokeDasharray={active ? undefined : "5 4"}
                  markerEnd={`url(#${active ? `${markerId}-active` : markerId})`}
                />
                {edge.label ? (
                  <text x={(from.cx + to.cx) / 2} y={(from.y + from.h + to.y) / 2} textAnchor="middle" fill={active ? "#4338ca" : "#64748b"} fontSize="10">
                    {edge.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          {start ? (
            <g>
              <circle cx={start.cx} cy={start.cy} r={5} fill="#64748b" />
              <text x={start.cx} y={start.y - 4} textAnchor="middle" fill="#64748b" fontSize="10">Start</text>
            </g>
          ) : null}
          {questions.map((question, index) => {
            const placed = nodes.get(index);
            if (!placed) return null;
            const selected = selectedIndex === index;
            const prompt = question.prompt.trim() || "Untitled question";
            return (
              <g
                key={index}
                className={onSelectQuestion ? "cursor-pointer" : undefined}
                role={onSelectQuestion ? "button" : undefined}
                tabIndex={onSelectQuestion ? 0 : undefined}
                onClick={() => onSelectQuestion?.(index)}
                onKeyDown={(event) => {
                  if (!onSelectQuestion) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectQuestion(index);
                  }
                }}
              >
                <rect
                  x={placed.x}
                  y={placed.y}
                  width={placed.w}
                  height={placed.h}
                  rx={8}
                  fill={selected ? "#eef2ff" : "#ffffff"}
                  stroke={selected ? "#4f46e5" : "#e2e8f0"}
                  strokeWidth={selected ? 2 : 1}
                />
                <text x={placed.cx} y={placed.y + 18} textAnchor="middle" fill="#0f172a" fontSize="11" fontWeight="600">
                  Q{index + 1} · {question.qtype.replace("_", " ")}
                </text>
                <text x={placed.cx} y={placed.y + 36} textAnchor="middle" fill="#64748b" fontSize="10">
                  {prompt.length > 18 ? `${prompt.slice(0, 18)}…` : prompt}
                </text>
                <title>{`Q${index + 1}: ${prompt}`}</title>
              </g>
            );
          })}
          {end ? (
            <g>
              <rect x={end.x} y={end.y} width={end.w} height={end.h} rx={8} fill="#ecfdf5" stroke="#059669" />
              <text x={end.cx} y={end.y + end.h / 2 + 4} textAnchor="middle" fill="#065f46" fontSize="11" fontWeight="600">
                End survey
              </text>
            </g>
          ) : null}
        </svg>
      </div>
    </div>
  );
}

export function questionCardClass(selected: boolean): string {
  return cn("space-y-2 rounded-md border p-3", selected ? "border-primary" : "border-border");
}
