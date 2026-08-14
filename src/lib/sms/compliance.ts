/**
 * Broadcast compliance validation.
 *
 * Mobile Message does NOT auto-append opt-out text. Naming the tenant
 * organisation is recommended for first-contact / cold outreach, but
 * optional — many sends are between people who already know each other.
 * An opt-out instruction is likewise recommended and still detected for
 * the composer checklist, but optional. The composer shows a warning
 * and confirms before queueing when the org name is missing; the server
 * only hard-fails on empty bodies and other true blockers.
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

// "reply STOP" / "txt STOP" / "text STOP to opt out" / bare "STOP" /
// "opt out" | "opt-out" phrasing.
const OPT_OUT_RE =
  /(?:\b(?:reply|txt|text)\b[^.\n]{0,20}\bstop\b)|(?:\bstop\b\s*(?:to|2)\s*(?:opt|end|unsub))|\bopt[\s-]?out\b/i;

export function smsOrgNameWarning(orgName: string): string {
  return `This message does not identify "${orgName}". Fine for people who already know you; include it for first-contact or cold outreach.`;
}

/** @deprecated Use smsOrgNameWarning(orgName). Kept for existing test imports. */
export const SMS_ORG_NAME_WARNING = smsOrgNameWarning("the organisation");

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function orgNamePattern(orgName: string): RegExp {
  const trimmed = orgName.trim();
  const tokens = trimmed.split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (tokens.length === 0) {
    return /(?!)/;
  }
  return new RegExp(tokens.join("\\s+"), "i");
}

export function validateSmsBody(
  body: string,
  orgName: string,
): SmsComplianceResult {
  const hasOrgName = orgName.trim().length > 0 && orgNamePattern(orgName).test(body);
  const hasOptOut = OPT_OUT_RE.test(body);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!hasOrgName && orgName.trim().length > 0) {
    warnings.push(smsOrgNameWarning(orgName.trim()));
  }
  return { ok: errors.length === 0, hasOrgName, hasOptOut, errors, warnings };
}
