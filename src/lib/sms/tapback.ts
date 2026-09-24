/**
 * iOS and Android SMS reactions arrive as a new inbound that quotes
 * the original. Parse them so the inbox can show a chip on the parent
 * message instead of a fresh reply.
 */

export type SmsTapbackKind =
  | "like"
  | "love"
  | "dislike"
  | "laugh"
  | "emphasize"
  | "question"
  | "emoji";

export interface ParsedSmsTapback {
  kind: SmsTapbackKind;
  emoji: string;
  quoted: string;
}

export interface SmsMessageReaction {
  kind: SmsTapbackKind;
  emoji: string;
  at: string;
  provider_message_id: string | null;
}

export const TAPBACK_KIND_LABEL: Record<SmsTapbackKind, string> = {
  like: "Liked",
  love: "Loved",
  dislike: "Disliked",
  laugh: "Laughed",
  emphasize: "Emphasized",
  question: "Questioned",
  emoji: "Reacted",
};

const PREFIXES: Array<{ kind: SmsTapbackKind; emoji: string; prefixes: string[] }> = [
  { kind: "laugh", emoji: "😂", prefixes: ["laughed at", "laut gelacht", "se ha reído", "se ha reido"] },
  { kind: "emphasize", emoji: "‼️", prefixes: ["emphasized", "hervorgehoben", "ha enfatizado"] },
  { kind: "question", emoji: "❓", prefixes: ["questioned", "hinterfragt", "ha preguntado"] },
  {
    kind: "dislike",
    emoji: "👎",
    prefixes: ["disliked", "gefällt mir nicht", "gefällt nicht", "je n'aime pas", "je n’aime pas", "no le ha gustado"],
  },
  {
    kind: "love",
    emoji: "❤️",
    prefixes: ["loved", "geliebt", "j'adore", "j’adore", "le ha encantado", "a adoré", "a adore"],
  },
  {
    kind: "like",
    emoji: "👍",
    prefixes: ["liked", "gefällt mir", "gefällt", "j'aime", "j’aime", "le ha gustado", "a aimé", "a aime"],
  },
];

const OPEN_QUOTE = /[„“"«‹「『‚]/;
const QUOTE_PAIRS: Array<[string, string[]]> = [
  ["„", ["“", "”"]],
  ["“", ["”"]],
  ['"', ['"']],
  ["«", ["»"]],
  ["‹", ["›"]],
  ["「", ["」"]],
  ["『", ["』"]],
  ["‚", ["‘"]],
];

function collapseWs(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractQuoted(rest: string): string {
  const trimmed = rest.trim();
  if (!trimmed) return "";
  if (/^an?\s+(image|photo|movie|video|attachment)\.?$/iu.test(trimmed)) return "";
  const closers = QUOTE_PAIRS.find(([open]) => open === trimmed[0])?.[1];
  if (!closers) return collapseWs(trimmed);
  let end = -1;
  for (let i = trimmed.length - 1; i > 0; i -= 1) {
    if (closers.includes(trimmed[i] ?? "")) {
      end = i;
      break;
    }
  }
  const inner = end > 0 ? trimmed.slice(1, end) : trimmed.slice(1);
  return collapseWs(inner);
}

const REACTED_RE = /^reacted\s+(\p{Extended_Pictographic}|[^\s]+)\s+to\s+/iu;

export function parseSmsTapback(body: string | null | undefined): ParsedSmsTapback | null {
  if (!body) return null;
  const text = body.replace(/^\uFEFF/, "").trim();
  if (!text) return null;
  if (/^removed\s+(a\s+)?(like|love|dislike|laugh|emphasis|question)\b/iu.test(text)) {
    return null;
  }

  const reacted = text.match(REACTED_RE);
  if (reacted) {
    return {
      kind: "emoji",
      emoji: reacted[1],
      quoted: extractQuoted(text.slice(reacted[0].length)),
    };
  }

  const lower = text.toLowerCase();
  for (const row of PREFIXES) {
    for (const prefix of row.prefixes) {
      if (!lower.startsWith(prefix)) continue;
      const after = text.slice(prefix.length);
      if (after.length > 0 && !/^[\s:：]/.test(after)) continue;
      const rest = after.replace(/^[\s:：]+/, "");
      if (
        rest.length > 0 &&
        !OPEN_QUOTE.test(rest[0] ?? "") &&
        !/^an?\s+(image|photo|movie|video|attachment)\.?$/iu.test(rest)
      ) {
        continue;
      }
      return { kind: row.kind, emoji: row.emoji, quoted: extractQuoted(rest) };
    }
  }
  return null;
}

export function quotedMatchesBody(body: string | null | undefined, quoted: string): boolean {
  if (!body || !quoted) return false;
  const hay = collapseWs(body);
  const needle = collapseWs(quoted.replace(/[.…]+$/u, ""));
  if (!needle) return false;
  return hay === collapseWs(quoted) || hay.startsWith(needle);
}

type FoldableMessage = {
  id: string;
  direction: string;
  body: string | null;
  created_at: string;
  provider_message_id?: string | null;
  reactions?: SmsMessageReaction[];
};

function findParent<T extends FoldableMessage>(
  messages: T[],
  tapback: ParsedSmsTapback,
  childId: string,
): T | null {
  const earlier = messages.filter((message) => message.id !== childId);
  if (tapback.quoted) {
    const hit = [...earlier]
      .reverse()
      .find(
        (message) =>
          message.direction === "outbound" && quotedMatchesBody(message.body, tapback.quoted),
      );
    if (hit) return hit;
  }
  return [...earlier].reverse().find((message) => message.direction === "outbound") ?? null;
}

/** Hide inbound tapback bubbles and attach them to the quoted outbound. */
export function foldTapbackMessages<T extends FoldableMessage>(
  messages: T[],
): Array<T & { reactions: SmsMessageReaction[] }> {
  const copies = new Map<string, T & { reactions: SmsMessageReaction[] }>(
    messages.map((message) => [
      message.id,
      { ...message, reactions: [...(message.reactions ?? [])] },
    ]),
  );
  const hide = new Set<string>();

  for (const message of messages) {
    if (message.direction !== "inbound" || !message.body) continue;
    const parsed = parseSmsTapback(message.body);
    if (!parsed) continue;
    const parent = findParent(messages, parsed, message.id);
    if (!parent) continue;
    const target = copies.get(parent.id);
    if (!target) continue;
    hide.add(message.id);
    const reactions = target.reactions ?? [];
    const duplicate = reactions.some(
      (reaction) =>
        reaction.provider_message_id != null &&
        reaction.provider_message_id === message.provider_message_id,
    );
    if (!duplicate) {
      reactions.push({
        kind: parsed.kind,
        emoji: parsed.emoji,
        at: message.created_at,
        provider_message_id: message.provider_message_id ?? null,
      });
      copies.set(parent.id, { ...target, reactions });
    }
  }

  return messages
    .filter((message) => !hide.has(message.id))
    .map((message) => copies.get(message.id) ?? { ...message, reactions: [...(message.reactions ?? [])] });
}
