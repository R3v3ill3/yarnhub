/**
 * Pure helpers for the P2P chat board (the 'chat' pathway).
 *
 * The board loads a full working list (a mode='p2p' sms_list) and the
 * organiser progressively selects individuals or subsets and fires the
 * personalised initial to just those. These helpers keep the
 * filter / selection / rendering logic testable outside React.
 *
 * Unit tested in __tests__/p2p.test.ts.
 */

import {
  resolveScriptVariables,
  TEMPLATE_TOKEN_RE,
} from "@/lib/comms/template-variables";

/** Server + board cap per send call — progressive P2P, not a blast. */
export const P2P_SEND_CAP = 50;

/**
 * Template used for one board row: a saved per-item override if the
 * organiser customised it, otherwise the board's shared draft body.
 */
export function p2pItemTemplate(
  boardTemplate: string,
  bodyOverride: string | null | undefined,
): string {
  const custom = bodyOverride?.trim();
  return custom || boardTemplate;
}

/**
 * Persist a custom opener, or NULL to fall back to the board default.
 * Identical-to-default copy is stored as NULL so later board-template
 * edits still apply.
 */
export function p2pBodyOverrideToStore(
  boardTemplate: string,
  editedBody: string,
): string | null {
  const trimmed = editedBody.trim();
  if (!trimmed) return null;
  if (trimmed === boardTemplate.trim()) return null;
  return trimmed;
}

/**
 * Render a personalised initial: resolve known tokens, strip any
 * leftovers so literal {{x}} never reaches a member's phone, collapse
 * doubled spaces (same treatment as the dispatch cron's resolveBody).
 */
export function renderP2pBody(
  template: string,
  context: Record<string, string | undefined>,
): string {
  return resolveScriptVariables(template, context)
    .replace(TEMPLATE_TOKEN_RE, "")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();
}

export interface P2pBoardItemLike {
  item_id: number | string;
  status: string;
  worker_name: string;
  employer_name: string | null;
  phone_e164: string | null;
  sms_opt_out: boolean;
}

export interface P2pBoardFilter {
  search: string;
  /** 'all' or an sms_list_items status value. */
  status: string;
}

/** Case-insensitive name/employer/phone filter + status filter. */
export function filterP2pItems<T extends P2pBoardItemLike>(
  items: T[],
  filter: P2pBoardFilter,
): T[] {
  const term = filter.search.trim().toLowerCase();
  return items.filter((item) => {
    if (filter.status !== "all" && item.status !== filter.status) return false;
    if (!term) return true;
    return (
      item.worker_name.toLowerCase().includes(term) ||
      (item.employer_name ?? "").toLowerCase().includes(term) ||
      (item.phone_e164 ?? "").includes(term)
    );
  });
}

/** Item statuses the board may (re)send: fresh rows and transient
 * provider failures (the send path re-checks opt-out/phone/claim). */
export const P2P_SENDABLE_STATUSES = ["pending", "failed"] as const;

/** True when the item can still receive an initial from the board. */
export function isP2pSendable(item: P2pBoardItemLike): boolean {
  return (
    (P2P_SENDABLE_STATUSES as readonly string[]).includes(item.status) &&
    !item.sms_opt_out &&
    !!item.phone_e164
  );
}

/**
 * "Select next N": extend the current selection with the next `n`
 * sendable, not-yet-selected items in the given (filtered) order.
 * Returns a new selection set; never exceeds the send cap.
 */
export function selectNextN<T extends P2pBoardItemLike>(
  items: T[],
  selected: ReadonlySet<T["item_id"]>,
  n: number,
): Set<T["item_id"]> {
  const next = new Set(selected);
  if (n <= 0) return next;
  for (const item of items) {
    if (next.size >= P2P_SEND_CAP) break;
    if (next.has(item.item_id)) continue;
    if (!isP2pSendable(item)) continue;
    next.add(item.item_id);
    n -= 1;
    if (n <= 0) break;
  }
  return next;
}

/**
 * Drop selection entries that are no longer sendable (sent meanwhile,
 * opted out, removed from the filtered list is fine — selection is
 * list-wide, not filter-scoped).
 */
export function pruneP2pSelection<T extends P2pBoardItemLike>(
  items: T[],
  selected: ReadonlySet<T["item_id"]>,
): Set<T["item_id"]> {
  const byId = new Map(items.map((i) => [i.item_id, i]));
  const next = new Set<T["item_id"]>();
  for (const id of selected) {
    const item = byId.get(id);
    if (item && isP2pSendable(item)) next.add(id);
  }
  return next;
}
