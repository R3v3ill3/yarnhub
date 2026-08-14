/**
 * SMS audience import — parse spreadsheet rows into validated audience
 * entries with AU-mobile E.164 normalisation and per-row reject reasons.
 *
 * Used by the AudiencePicker import sub-wizard (Phase 9, brief §C).
 */

import { toE164 } from "@/lib/phone/normalise-phone";

// ─── Header synonyms ────────────────────────────────────────────────

const HEADER_SYNONYMS: Record<string, string[]> = {
  first_name: [
    "first_name",
    "first name",
    "firstname",
    "given name",
    "given_name",
    "first",
  ],
  last_name: [
    "last_name",
    "last name",
    "lastname",
    "surname",
    "family name",
    "family_name",
    "last",
  ],
  phone: [
    "phone",
    "phone_number",
    "phone number",
    "mobile",
    "mobile_number",
    "mobile number",
    "cell",
    "cell_phone",
    "contact number",
    "tel",
    "telephone",
  ],
  email: ["email", "email_address", "email address", "e-mail"],
};

function normaliseHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[_\s]+/g, " ");
}

/** Map raw headers to canonical field names. */
export function mapHeaders(
  headers: string[]
): { mapped: Record<string, number>; missing: string[] } {
  const mapped: Record<string, number> = {};
  const normalised = headers.map(normaliseHeader);

  for (const [canonical, synonyms] of Object.entries(HEADER_SYNONYMS)) {
    const idx = normalised.findIndex((h) =>
      synonyms.some((s) => normaliseHeader(s) === h)
    );
    if (idx >= 0) mapped[canonical] = idx;
  }

  const missing: string[] = [];
  for (const required of ["first_name", "last_name", "phone"]) {
    if (!(required in mapped)) missing.push(required);
  }
  return { mapped, missing };
}

// ─── Row types ───────────────────────────────────────────────────────

export interface AudienceRow {
  key: string;
  first_name: string;
  last_name: string;
  phone: string;
  phone_e164: string;
  email: string | null;
}

export interface AudienceReject {
  key: string;
  row: Record<string, string>;
  reasons: string[];
}

export interface ParseResult {
  rows: AudienceRow[];
  rejected: AudienceReject[];
}

// ─── Consent basis ───────────────────────────────────────────────────

export const CONSENT_BASES = [
  "membership_form",
  "workplace_signup",
  "direct_request",
  "other",
] as const;

export type ConsentBasis = (typeof CONSENT_BASES)[number];

export function isConsentBasis(v: unknown): v is ConsentBasis {
  return typeof v === "string" && (CONSENT_BASES as readonly string[]).includes(v);
}

// ─── Parse ───────────────────────────────────────────────────────────

/**
 * Parse header-keyed row objects into validated audience rows.
 *
 * Each row object uses the raw spreadsheet header as keys (e.g.
 * `{ "First Name": "Amy", "Surname": "Lee", "Mobile": "0400100014" }`).
 * The `headers` array must correspond to the keys present in the rows.
 */
export function parseAudienceRows(
  rows: Record<string, string>[],
  headers: string[]
): ParseResult {
  const { mapped, missing } = mapHeaders(headers);
  if (missing.length > 0) {
    return {
      rows: [],
      rejected: rows.map((row, i) => ({
        key: String(i),
        row,
        reasons: [`Missing required columns: ${missing.join(", ")}`],
      })),
    };
  }

  const headerKeys = headers;
  const accepted: AudienceRow[] = [];
  const rejected: AudienceReject[] = [];

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const reasons: string[] = [];

    const firstName = (raw[headerKeys[mapped.first_name]] ?? "").trim();
    const lastName = (raw[headerKeys[mapped.last_name]] ?? "").trim();
    const phone = (raw[headerKeys[mapped.phone]] ?? "").trim();
    const email =
      mapped.email != null
        ? (raw[headerKeys[mapped.email]] ?? "").trim() || null
        : null;

    if (!firstName) reasons.push("Missing first name");
    if (!lastName) reasons.push("Missing last name");
    if (!phone) {
      reasons.push("Missing phone number");
    } else {
      const e164 = toE164(phone);
      if (!e164) reasons.push("Not a valid AU mobile number");
    }

    if (reasons.length > 0) {
      rejected.push({ key: String(i), row: raw, reasons });
    } else {
      accepted.push({
        key: String(i),
        first_name: firstName,
        last_name: lastName,
        phone,
        phone_e164: toE164(phone)!,
        email,
      });
    }
  }

  return { rows: accepted, rejected };
}

// ─── Staging readiness ───────────────────────────────────────────────

export interface StagingCounts {
  sendable: number;
  opted_out: number;
  no_mobile: number;
}

export function computeStagingCounts(
  workers: Array<{
    phone_e164: string | null;
    sms_opt_out?: boolean | null;
  }>
): StagingCounts {
  let sendable = 0;
  let opted_out = 0;
  let no_mobile = 0;

  for (const w of workers) {
    if (!w.phone_e164) {
      no_mobile++;
    } else if (w.sms_opt_out) {
      opted_out++;
    } else {
      sendable++;
    }
  }

  return { sendable, opted_out, no_mobile };
}
