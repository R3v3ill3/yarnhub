/**
 * Survey structure as a small graph. A survey with no branches is still
 * a path: Start → Q1 → Q2 → End. Yes/no targets are the only branches
 * Yarnhub authors today.
 */

export type FlowTarget = number | "end";

export interface FlowQuestion {
  prompt: string;
  qtype: string;
  branches: Record<string, FlowTarget>;
}

export type FlowNodeId = number | "start" | "end";

export interface FlowEdge {
  from: FlowNodeId;
  to: FlowNodeId;
  label?: string;
  kind: "default" | "branch" | "start";
}

export interface PlacedFlowNode {
  id: FlowNodeId;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

const NODE_W = 148;
const NODE_H = 56;
const END_H = 40;
const H_GAP = 20;
const V_GAP = 48;
const PAD_X = 24;
const PAD_Y = 20;

function parseGoto(raw: string | undefined): FlowTarget | null {
  if (!raw || raw === "next") return null;
  if (raw === "end") return "end";
  const index = Number(raw);
  return Number.isInteger(index) ? index : null;
}

export function flowFromDraft(
  questions: Array<{ prompt: string; qtype: string; yesGoto?: string; noGoto?: string }>,
): FlowQuestion[] {
  return questions.map((question) => {
    const branches: Record<string, FlowTarget> = {};
    if (question.qtype === "yes_no") {
      const yes = parseGoto(question.yesGoto);
      const no = parseGoto(question.noGoto);
      if (yes != null) branches.yes = yes;
      if (no != null) branches.no = no;
    }
    return { prompt: question.prompt, qtype: question.qtype, branches };
  });
}

export function flowFromSaved(
  questions: Array<{ id: string; prompt: string; qtype: string; branching: unknown }>,
): FlowQuestion[] {
  const indexById = new Map(questions.map((question, index) => [question.id, index]));
  return questions.map((question, index) => {
    const branches: Record<string, FlowTarget> = {};
    const raw =
      question.branching && typeof question.branching === "object"
        ? (question.branching as Record<string, unknown>)
        : {};
    for (const [key, target] of Object.entries(raw)) {
      if (target === "end") branches[key] = "end";
      else if (typeof target === "string" && indexById.has(target)) {
        const next = indexById.get(target);
        if (next != null && next !== index) branches[key] = next;
      } else if (typeof target === "number" && target !== index && target >= 0 && target < questions.length) {
        branches[key] = target;
      }
    }
    return { prompt: question.prompt, qtype: question.qtype, branches };
  });
}

function branchableValues(question: FlowQuestion): string[] {
  if (question.qtype === "yes_no") return ["yes", "no"];
  return Object.keys(question.branches);
}

export function buildFlowEdges(questions: FlowQuestion[]): FlowEdge[] {
  const edges: FlowEdge[] = [];
  if (questions.length === 0) {
    edges.push({ from: "start", to: "end", kind: "start" });
    return edges;
  }
  edges.push({ from: "start", to: 0, kind: "start" });
  questions.forEach((question, index) => {
    const values = branchableValues(question);
    const destinations = new Map<string, FlowNodeId>();
    for (const value of values) {
      const target = question.branches[value];
      if (target === undefined) continue;
      if (typeof target === "number" && (target < 0 || target >= questions.length)) continue;
      destinations.set(value, target === "end" ? "end" : target);
    }
    const hasDefault =
      values.length === 0 || values.some((value) => question.branches[value] === undefined);
    if (hasDefault) {
      const next: FlowNodeId = index + 1 < questions.length ? index + 1 : "end";
      if (![...destinations.values()].includes(next)) {
        edges.push({ from: index, to: next, kind: "default" });
      }
    }
    for (const [label, to] of destinations) {
      edges.push({ from: index, to, label, kind: "branch" });
    }
  });
  return edges;
}

function assignLevels(edges: FlowEdge[], questionCount: number): Map<FlowNodeId, number> {
  const preds = new Map<FlowNodeId, FlowNodeId[]>();
  const ensure = (id: FlowNodeId) => {
    if (!preds.has(id)) preds.set(id, []);
  };
  ensure("start");
  ensure("end");
  for (let i = 0; i < questionCount; i += 1) ensure(i);
  for (const edge of edges) {
    ensure(edge.from);
    ensure(edge.to);
    preds.get(edge.to)?.push(edge.from);
  }
  const level = new Map<FlowNodeId, number>([["start", 0]]);
  const nodes = [...preds.keys()];
  for (let pass = 0; pass < nodes.length + 2; pass += 1) {
    let changed = false;
    for (const id of nodes) {
      if (id === "start") continue;
      const parents = preds.get(id) ?? [];
      if (!parents.length) continue;
      const next = Math.max(...parents.map((parent) => level.get(parent) ?? -1)) + 1;
      if (next < 1) continue;
      if (!level.has(id) || (level.get(id) ?? 0) < next) {
        level.set(id, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (let i = 0; i < questionCount; i += 1) {
    if (!level.has(i)) level.set(i, i + 1);
  }
  if (!level.has("end")) {
    const maxQuestion = questionCount
      ? Math.max(...Array.from({ length: questionCount }, (_, i) => level.get(i) ?? 0))
      : 0;
    level.set("end", maxQuestion + 1);
  }
  return level;
}

function orderLevels(levels: Map<FlowNodeId, number>, edges: FlowEdge[], questionCount: number): FlowNodeId[][] {
  const maxLevel = Math.max(0, ...levels.values());
  const rows: FlowNodeId[][] = Array.from({ length: maxLevel + 1 }, () => []);
  const outgoing = new Map<FlowNodeId, FlowNodeId[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.from) ?? [];
    if (!list.includes(edge.to)) list.push(edge.to);
    outgoing.set(edge.from, list);
  }
  rows[0] = ["start"];
  const placed = new Set<FlowNodeId>(["start"]);
  for (let level = 0; level < maxLevel; level += 1) {
    const next: FlowNodeId[] = [];
    for (const parent of rows[level]) {
      for (const child of outgoing.get(parent) ?? []) {
        if (levels.get(child) !== level + 1 || placed.has(child)) continue;
        next.push(child);
        placed.add(child);
      }
    }
    for (let i = 0; i < questionCount; i += 1) {
      if (levels.get(i) === level + 1 && !placed.has(i)) {
        next.push(i);
        placed.add(i);
      }
    }
    if (levels.get("end") === level + 1 && !placed.has("end")) {
      next.push("end");
      placed.add("end");
    }
    rows[level + 1] = next;
  }
  return rows;
}

export function layoutSurveyFlow(questions: FlowQuestion[]): {
  edges: FlowEdge[];
  nodes: Map<FlowNodeId, PlacedFlowNode>;
  width: number;
  height: number;
} {
  const edges = buildFlowEdges(questions);
  const levels = assignLevels(edges, questions.length);
  const rows = orderLevels(levels, edges, questions.length);
  const maxCols = Math.max(1, ...rows.map((row) => row.length));
  const width = PAD_X * 2 + maxCols * NODE_W + (maxCols - 1) * H_GAP;
  const height = PAD_Y * 2 + rows.length * NODE_H + Math.max(0, rows.length - 1) * V_GAP;
  const nodes = new Map<FlowNodeId, PlacedFlowNode>();
  rows.forEach((row, rowIndex) => {
    const rowWidth = row.length * NODE_W + Math.max(0, row.length - 1) * H_GAP;
    const startX = (width - rowWidth) / 2;
    const y = PAD_Y + rowIndex * (NODE_H + V_GAP);
    row.forEach((id, col) => {
      const h = id === "end" || id === "start" ? END_H : NODE_H;
      const yOff = id === "end" || id === "start" ? (NODE_H - END_H) / 2 : 0;
      const x = startX + col * (NODE_W + H_GAP);
      nodes.set(id, { id, x, y: y + yOff, w: NODE_W, h, cx: x + NODE_W / 2, cy: y + yOff + h / 2 });
    });
  });
  return { edges, nodes, width, height };
}

export function edgePath(from: PlacedFlowNode, to: PlacedFlowNode): string {
  const x1 = from.cx;
  const y1 = from.y + from.h;
  const x2 = to.cx;
  const y2 = to.y;
  if (Math.abs(x1 - x2) < 1) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}
