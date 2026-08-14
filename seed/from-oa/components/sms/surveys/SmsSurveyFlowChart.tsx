'use client'

/**
 * Interactive survey flow visualisation — layered DAG layout.
 * Destinations from the same question sit on one horizontal row; the
 * canvas grows with the widest row. Edges are dashed by default and
 * solid when they touch the selected question.
 */
import { useMemo } from 'react'
import { cn } from '@/lib/utils/cn'
import type { SurveyEditorQuestion } from '@/components/sms/surveys/SmsSurveyEditor'

const NODE_W = 148
const NODE_H = 56
const END_H = 40
const H_GAP = 20
const V_GAP = 48
const PAD_X = 24
const PAD_Y = 20

type NodeId = number | 'start' | 'end'

interface Edge {
  from: NodeId
  to: NodeId
  label?: string
  kind: 'default' | 'branch' | 'start'
}

interface PlacedNode {
  id: NodeId
  x: number
  y: number
  w: number
  h: number
  cx: number
  cy: number
}

interface SmsSurveyFlowChartProps {
  questions: SurveyEditorQuestion[]
  selectedIndex: number | null
  onSelectQuestion: (index: number) => void
  className?: string
}

function branchableValues(q: SurveyEditorQuestion): string[] {
  if (q.qtype === 'yes_no') return ['yes', 'no']
  if (q.qtype === 'choice') {
    return q.choiceOptions.map((o) => o.value.trim()).filter(Boolean)
  }
  return []
}

function buildEdges(questions: SurveyEditorQuestion[]): Edge[] {
  const edges: Edge[] = []
  if (questions.length === 0) {
    edges.push({ from: 'start', to: 'end', kind: 'start' })
    return edges
  }
  edges.push({ from: 'start', to: 0, kind: 'start' })

  questions.forEach((q, i) => {
    const values = branchableValues(q)
    const destinations = new Map<string, NodeId>() // key = label|default → target

    for (const v of values) {
      const target = q.branching[v]
      if (target === undefined) continue
      destinations.set(v, target === 'end' ? 'end' : target)
    }

    const hasDefaultPath =
      values.length === 0 || values.some((v) => q.branching[v] === undefined)
    if (hasDefaultPath) {
      const next: NodeId = i + 1 < questions.length ? i + 1 : 'end'
      // Only add a default edge if that target isn't already covered by a
      // labelled branch (avoids duplicate parallel edges).
      const already = [...destinations.values()].includes(next)
      if (!already) {
        edges.push({ from: i, to: next, kind: 'default' })
      }
    }

    for (const [label, to] of destinations) {
      edges.push({ from: i, to, label, kind: 'branch' })
    }
  })
  return edges
}

/**
 * Longest-path layering from start so every parent sits above its
 * children; siblings that share a parent land on the same row when
 * their longest-path depths match (typical for multi-way branches).
 */
function assignLevels(edges: Edge[], questionCount: number): Map<NodeId, number> {
  const preds = new Map<NodeId, NodeId[]>()
  const succs = new Map<NodeId, NodeId[]>()
  const ensure = (id: NodeId) => {
    if (!preds.has(id)) preds.set(id, [])
    if (!succs.has(id)) succs.set(id, [])
  }
  ensure('start')
  ensure('end')
  for (let i = 0; i < questionCount; i++) ensure(i)

  for (const e of edges) {
    ensure(e.from)
    ensure(e.to)
    preds.get(e.to)!.push(e.from)
    succs.get(e.from)!.push(e.to)
  }

  const level = new Map<NodeId, number>()
  level.set('start', 0)

  // Kahn-style pass over a soft topo; re-walk until levels stabilize
  // (survey graphs are small and cycle-validated at save time).
  const nodes = [...preds.keys()]
  for (let pass = 0; pass < nodes.length + 2; pass++) {
    let changed = false
    for (const id of nodes) {
      if (id === 'start') continue
      const parents = preds.get(id) ?? []
      if (parents.length === 0) continue
      const next =
        Math.max(
          ...parents.map((p) => (level.has(p) ? level.get(p)! : -1)),
        ) + 1
      if (next < 1) continue
      if (!level.has(id) || level.get(id)! < next) {
        level.set(id, next)
        changed = true
      }
    }
    if (!changed) break
  }

  // Orphans (unreachable) keep sort order under start+1.
  for (let i = 0; i < questionCount; i++) {
    if (!level.has(i)) level.set(i, i + 1)
  }
  if (!level.has('end')) {
    const maxQ = questionCount
      ? Math.max(...Array.from({ length: questionCount }, (_, i) => level.get(i) ?? 0))
      : 0
    level.set('end', maxQ + 1)
  }

  return level
}

/**
 * Within each level, order nodes so children of the same parent stay
 * adjacent (left-to-right following the parent's outgoing edge order).
 */
function orderLevels(
  levels: Map<NodeId, number>,
  edges: Edge[],
  questionCount: number,
): NodeId[][] {
  const maxLevel = Math.max(0, ...levels.values())
  const rows: NodeId[][] = Array.from({ length: maxLevel + 1 }, () => [])

  const outgoing = new Map<NodeId, NodeId[]>()
  for (const e of edges) {
    const list = outgoing.get(e.from) ?? []
    if (!list.includes(e.to)) list.push(e.to)
    outgoing.set(e.from, list)
  }

  rows[0] = ['start']
  const placed = new Set<NodeId>(['start'])

  for (let L = 0; L < maxLevel; L++) {
    const next: NodeId[] = []
    for (const parent of rows[L]) {
      for (const child of outgoing.get(parent) ?? []) {
        if (levels.get(child) !== L + 1) continue
        if (placed.has(child)) continue
        next.push(child)
        placed.add(child)
      }
    }
    // Any remaining nodes assigned to L+1 (e.g. unreachable) in index order.
    for (let i = 0; i < questionCount; i++) {
      if (levels.get(i) === L + 1 && !placed.has(i)) {
        next.push(i)
        placed.add(i)
      }
    }
    if (levels.get('end') === L + 1 && !placed.has('end')) {
      next.push('end')
      placed.add('end')
    }
    rows[L + 1] = next
  }

  return rows
}

function layout(
  questions: SurveyEditorQuestion[],
  edges: Edge[],
): { nodes: Map<NodeId, PlacedNode>; width: number; height: number; rows: NodeId[][] } {
  const levels = assignLevels(edges, questions.length)
  const rows = orderLevels(levels, edges, questions.length)
  const maxCols = Math.max(1, ...rows.map((r) => r.length))
  const width = PAD_X * 2 + maxCols * NODE_W + (maxCols - 1) * H_GAP
  const height =
    PAD_Y * 2 +
    rows.length * NODE_H +
    Math.max(0, rows.length - 1) * V_GAP

  const nodes = new Map<NodeId, PlacedNode>()
  rows.forEach((row, rowIndex) => {
    const rowWidth = row.length * NODE_W + Math.max(0, row.length - 1) * H_GAP
    const startX = (width - rowWidth) / 2
    const y = PAD_Y + rowIndex * (NODE_H + V_GAP)
    row.forEach((id, col) => {
      const h = id === 'end' || id === 'start' ? END_H : NODE_H
      const yOff = id === 'end' || id === 'start' ? (NODE_H - END_H) / 2 : 0
      const x = startX + col * (NODE_W + H_GAP)
      const cy = y + yOff + h / 2
      nodes.set(id, {
        id,
        x,
        y: y + yOff,
        w: NODE_W,
        h,
        cx: x + NODE_W / 2,
        cy,
      })
    })
  })

  return { nodes, width, height, rows }
}

function edgePath(from: PlacedNode, to: PlacedNode): string {
  const x1 = from.cx
  const y1 = from.y + from.h
  const x2 = to.cx
  const y2 = to.y
  if (Math.abs(x1 - x2) < 1) {
    return `M ${x1} ${y1} L ${x2} ${y2}`
  }
  const midY = (y1 + y2) / 2
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
}

function touchesSelected(edge: Edge, selectedIndex: number | null): boolean {
  if (selectedIndex == null) return false
  return edge.from === selectedIndex || edge.to === selectedIndex
}

export function SmsSurveyFlowChart({
  questions,
  selectedIndex,
  onSelectQuestion,
  className,
}: SmsSurveyFlowChartProps) {
  const { edges, nodes, width, height } = useMemo(() => {
    const edges = buildEdges(questions)
    const laid = layout(questions, edges)
    return { edges, ...laid }
  }, [questions])

  const startNode = nodes.get('start')
  const endNode = nodes.get('end')

  return (
    <div
      className={cn(
        'flex h-full min-h-[280px] min-w-0 flex-col rounded-md border bg-muted/20',
        className,
      )}
    >
      <div className="shrink-0 border-b px-3 py-2">
        <p className="text-xs font-medium">Flow</p>
        <p className="text-[11px] text-muted-foreground">
          Branch destinations share a row. Dashed links turn solid when they
          touch the selected question.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <svg
          width={Math.max(width, 200)}
          height={Math.max(height, 160)}
          className="block"
          role="img"
          aria-label="Survey question flow chart"
        >
          <defs>
            <marker
              id="survey-flow-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground" />
            </marker>
            <marker
              id="survey-flow-arrow-active"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-indigo-600" />
            </marker>
          </defs>

          {edges.map((edge, ei) => {
            const from = nodes.get(edge.from)
            const to = nodes.get(edge.to)
            if (!from || !to) return null
            const active = touchesSelected(edge, selectedIndex)
            const d = edgePath(from, to)
            const labelX = (from.cx + to.cx) / 2
            const labelY = (from.y + from.h + to.y) / 2
            return (
              <g key={`${edge.from}-${edge.to}-${edge.label ?? ''}-${ei}`}>
                <path
                  d={d}
                  fill="none"
                  strokeWidth={active ? 2 : 1.5}
                  strokeDasharray={active ? undefined : '5 4'}
                  className={
                    active ? 'stroke-indigo-600' : 'stroke-muted-foreground/70'
                  }
                  markerEnd={
                    active
                      ? 'url(#survey-flow-arrow-active)'
                      : 'url(#survey-flow-arrow)'
                  }
                />
                {edge.label && (
                  <text
                    x={labelX}
                    y={labelY}
                    textAnchor="middle"
                    className={
                      active
                        ? 'fill-indigo-700 text-[10px] font-medium'
                        : 'fill-muted-foreground text-[10px]'
                    }
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            )
          })}

          {startNode && (
            <g>
              <circle
                cx={startNode.cx}
                cy={startNode.cy}
                r={5}
                className="fill-muted-foreground"
              />
              <text
                x={startNode.cx}
                y={startNode.y - 4}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                Start
              </text>
            </g>
          )}

          {questions.map((q, i) => {
            const placed = nodes.get(i)
            if (!placed) return null
            const selected = selectedIndex === i
            const prompt = q.prompt.trim() || 'Untitled question'
            return (
              <g
                key={i}
                className="cursor-pointer"
                onClick={() => onSelectQuestion(i)}
              >
                <rect
                  x={placed.x}
                  y={placed.y}
                  width={placed.w}
                  height={placed.h}
                  rx={8}
                  className={
                    selected
                      ? 'fill-indigo-50 stroke-indigo-600'
                      : 'fill-background stroke-border hover:stroke-indigo-400'
                  }
                  strokeWidth={selected ? 2 : 1}
                />
                <text
                  x={placed.cx}
                  y={placed.y + 18}
                  textAnchor="middle"
                  className="fill-foreground text-[11px] font-semibold"
                >
                  Q{i + 1} · {q.qtype.replace('_', ' ')}
                </text>
                <text
                  x={placed.cx}
                  y={placed.y + 36}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {prompt.length > 18 ? `${prompt.slice(0, 18)}…` : prompt}
                </text>
                <title>{`Q${i + 1}: ${prompt}`}</title>
              </g>
            )
          })}

          {endNode && (
            <g>
              <rect
                x={endNode.x}
                y={endNode.y}
                width={endNode.w}
                height={endNode.h}
                rx={8}
                className="fill-emerald-50 stroke-emerald-600"
                strokeWidth={1.5}
              />
              <text
                x={endNode.cx}
                y={endNode.y + endNode.h / 2 + 4}
                textAnchor="middle"
                className="fill-emerald-800 text-[11px] font-semibold"
              >
                End survey
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  )
}
