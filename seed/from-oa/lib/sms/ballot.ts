/**
 * Pure ballot logic (brief §4.2, Phase 5) — receipt hashing, the
 * completion receipt sentence and the revote decision. Server/test
 * only: imports node:crypto, so client components must never import
 * this module (UI-safe ballot constants live in survey-validation.ts).
 *
 * Receipts (§4.2): on completion the voter gets a short verification
 * code = sha256(receipt_salt | worker_id | ordered parsed answers),
 * first 10 hex chars. The audit surface lists RECOMPUTED codes only
 * (never stored, never worker-linked), so a member can be told "your
 * receipt appears in the list" without staff mapping code → member.
 */
import { createHash } from "node:crypto";
import type { ParseResult } from "@/lib/sms/survey-engine";
import type { SmsBallotRevotePolicy } from "@/types/sms";

/** One answered question in the receipt hash input. */
export interface ReceiptAnswer {
  questionId: number;
  value: string;
}

/**
 * Deterministic receipt code: sha256 over
 * salt|worker|q1:a1|q2:a2|… — each answer is bound to its question
 * id so a branch revote answering DIFFERENT questions with the same
 * values cannot collide, and '|' separators keep ["1","23"] and
 * ["12","3"] distinct. First 10 hex chars uppercased, grouped
 * XXXX-XXXX-XX for readability.
 *
 * `orderedParsedAnswers` = the session's non-NULL parsed answers in
 * question order (sort_order, question_id) — the caller owns the
 * ordering so the code is recomputable at any time.
 */
export function computeBallotReceipt(
  receiptSalt: string,
  workerId: number,
  orderedParsedAnswers: ReceiptAnswer[],
): string {
  const digest = createHash("sha256")
    .update(
      [
        receiptSalt,
        String(workerId),
        ...orderedParsedAnswers.map((a) => `${a.questionId}:${a.value}`),
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 10)
    .toUpperCase();
  return `${digest.slice(0, 4)}-${digest.slice(4, 8)}-${digest.slice(8, 10)}`;
}

/** The receipt sentence appended to (or standing in for) the completion send. */
export function receiptSentence(receipt: string): string {
  return `Your receipt: ${receipt}. Keep this to verify your vote was counted.`;
}

/**
 * Ballot completion body: authored completion + the receipt sentence.
 * Sent even when no completion body is authored — the receipt must
 * reach the voter.
 */
export function appendReceiptToCompletion(
  completionBody: string | null | undefined,
  receipt: string,
): string {
  const base = completionBody?.trim();
  const sentence = receiptSentence(receipt);
  return base ? `${base}\n\n${sentence}` : sentence;
}

/**
 * Reply for a locked-ballot revote attempt. Close info is omitted —
 * ballots close manually, there is no scheduled close time to cite.
 */
export const BALLOT_LOCKED_REPLY =
  "Your vote is already recorded and can't be changed. This ballot allows one vote per member.";

export type BallotRevoteDecision =
  | "reject_locked"
  | "supersede"
  | "not_vote_attempt";

/**
 * What to do with an inbound from a member whose ballot session is
 * already COMPLETED while the ballot is still open (§4.2):
 *
 *   - Only a PARSED answer to the ballot's first question counts as
 *     a vote attempt — invalid/freetext inbound is a normal message
 *     and falls through to the conversational inbox untouched (no
 *     robotic "vote already recorded" reply to "call me back").
 *   - 'locked' → reject (answers untouched, vote_rejected_locked
 *     logged, locked reply sent).
 *   - 'revote_until_close' → supersede (session reopened at Q1,
 *     vote_superseded logged with the prior answers, last response
 *     wins).
 */
export function decideBallotRevote(
  revotePolicy: SmsBallotRevotePolicy,
  parsed: ParseResult,
): BallotRevoteDecision {
  if (parsed.kind !== "parsed") return "not_vote_attempt";
  return revotePolicy === "revote_until_close" ? "supersede" : "reject_locked";
}
