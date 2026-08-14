/**
 * Broadcast compliance validation (brief §3.1 item 9 / §2.1).
 *
 * Mobile Message does NOT auto-append opt-out text. Naming the
 * organisation ("Offshore Alliance") is recommended for first-contact
 * / cold outreach, but optional — many sends are between organisers
 * and members who already know each other. An opt-out instruction
 * (e.g. "Reply STOP to opt out") is likewise recommended and still
 * detected for the composer checklist, but optional — existing
 * members already have a functional STOP path via the provider and
 * inbound webhook. The composer shows a warning and confirms before
 * queueing when the org name is missing; the server only hard-fails
 * on empty bodies and other true blockers.
 *
 * Pure module — unit tested in __tests__/compliance.test.ts.
 */

export interface SmsComplianceResult {
  ok: boolean;
  hasOrgName: boolean;
  hasOptOut: boolean;
  errors: string[];
  warnings: string[];
}

const ORG_NAME_RE = /offshore\s+alliance/i;

// "reply STOP" / "txt STOP" / "text STOP to opt out" / bare "STOP" /
// "opt out" | "opt-out" phrasing.
const OPT_OUT_RE = /(?:\b(?:reply|txt|text)\b[^.\n]{0,20}\bstop\b)|(?:\bstop\b\s*(?:to|2)\s*(?:opt|end|unsub))|\bopt[\s-]?out\b/i;

export const SMS_ORG_NAME_WARNING =
  'This message does not identify "Offshore Alliance". Fine for people who already know you; include it for first-contact or cold outreach.';

export function validateSmsBody(body: string): SmsComplianceResult {
  const hasOrgName = ORG_NAME_RE.test(body);
  const hasOptOut = OPT_OUT_RE.test(body);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!hasOrgName) {
    warnings.push(SMS_ORG_NAME_WARNING);
  }
  return { ok: errors.length === 0, hasOrgName, hasOptOut, errors, warnings };
}
