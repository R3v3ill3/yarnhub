/**
 * Canonical Australian phone normalisation.
 *
 * The single source of truth for phone parsing/formatting — replaces the
 * three divergent implementations that previously lived in the worker
 * import parser, the membership import parser and the yabbr client.
 *
 * Storage convention:
 *   - `workers.phone` keeps the local display form the imports produce
 *     (e.g. "0400100014") — never rewritten by this module's consumers.
 *   - `workers.phone_e164` holds the canonical `+614xxxxxxxx` form for
 *     SMS, derived via `toE164` (mobiles only) at write time, with a DB
 *     trigger as the safety net.
 */

function cleanDigits(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  return String(raw).replace(/\D/g, "");
}

/**
 * E.164 for AU mobiles only (`+614xxxxxxxx`). Returns null for anything
 * that isn't unambiguously an AU mobile — landlines, 1300/1800 numbers,
 * short/long digit strings, garbage.
 *
 * Accepted inputs (punctuation/whitespace tolerant):
 *   04xxxxxxxx · +614xxxxxxxx · 614xxxxxxxx · 4xxxxxxxx (9-digit) ·
 *   61 04xxxxxxxx (dialled form)
 */
export function toE164(raw: string | number | null | undefined): string | null {
  const d = cleanDigits(raw);
  if (/^04\d{8}$/.test(d)) return `+61${d.slice(1)}`;
  if (/^614\d{8}$/.test(d)) return `+${d}`;
  if (/^4\d{8}$/.test(d)) return `+61${d}`;
  if (/^6104\d{8}$/.test(d)) return `+61${d.slice(3)}`;
  return null;
}

/**
 * E.164 for any AU number (mobiles, landlines, 13/1300/1800). Use for
 * general phone storage; use `toE164` when the number must be SMS-capable.
 */
export function toE164Any(raw: string | number | null | undefined): string | null {
  const mobile = toE164(raw);
  if (mobile) return mobile;
  const d = cleanDigits(raw);
  if (/^0[23478]\d{8}$/.test(d)) return `+61${d.slice(1)}`;
  if (/^61[23478]\d{8}$/.test(d)) return `+${d}`;
  if (/^[23478]\d{8}$/.test(d)) return `+61${d}`;
  if (/^610[23478]\d{8}$/.test(d)) return `+61${d.slice(3)}`;
  if (/^1[38]00\d{6}$/.test(d) || /^13\d{4}$/.test(d)) return `+61${d}`;
  return null;
}

/**
 * Local `0…` form (e.g. "0400100014") for any recognisable AU number,
 * else null. This is the form the import pipelines store in
 * `workers.phone`.
 */
export function toLocal(raw: string | number | null | undefined): string | null {
  const e164 = toE164Any(raw);
  if (!e164) return null;
  const rest = e164.slice(3); // strip +61
  if (/^1[38]/.test(rest)) return rest; // 1300/1800/13 numbers have no leading 0
  return `0${rest}`;
}

/**
 * Display form with AU spacing (e.g. "+61400100014" → "0400 100 014",
 * "0298765432" → "02 9876 5432"). Falls back to the trimmed input when
 * the number isn't recognisable.
 */
export function toDisplay(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  const digits = cleanDigits(raw);
  if (!digits) return String(raw).trim();

  let local = digits;
  if (local.startsWith("61") && local.length >= 11) {
    local = `0${local.slice(2)}`;
  } else if (local.length === 9) {
    local = `0${local}`;
  }

  if (local.startsWith("04") && local.length === 10) {
    return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  }
  if (/^0[2378]/.test(local) && local.length === 10) {
    return `${local.slice(0, 2)} ${local.slice(2, 6)} ${local.slice(6)}`;
  }
  if (/^1[38]00/.test(local) && local.length === 10) {
    return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  }
  if (local.startsWith("0") && local.length === 10) {
    return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  }
  return String(raw).trim();
}

/** True when the input is unambiguously an AU mobile. */
export function isAuMobile(raw: string | number | null | undefined): boolean {
  return toE164(raw) !== null;
}
