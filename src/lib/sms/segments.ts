/**
 * SMS segment counting — GSM-7 vs UCS-2 detection and part math.
 *
 * One credit = one part. GSM-7: 160 chars single-part, 153 per part
 * multi-part (7-byte UDH). UCS-2 (any non-GSM char, e.g. emoji or
 * smart quotes): 70 single-part, 67 per part. Characters in the GSM
 * extended set (€ ^ { } \ [ ] ~ |) cost two septets each.
 *
 * Pure module — unit tested in __tests__/segments.test.ts.
 */

// GSM 03.38 basic character set (incl. Greek uppercase + common symbols).
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

// GSM 03.38 extension table — each costs 2 septets (escape + char).
const GSM7_EXTENDED = "€^{}\\[]~|";

const GSM7_SET = new Set([...GSM7_BASIC]);
const GSM7_EXT_SET = new Set([...GSM7_EXTENDED]);

export type SmsEncoding = "GSM-7" | "UCS-2";

export interface SegmentCount {
  encoding: SmsEncoding;
  /** Character count in the encoding's units (septets for GSM-7, UTF-16 code units for UCS-2). */
  length: number;
  /** Number of message parts (credits). */
  segments: number;
  /** Capacity of a message with this part count. */
  perSegment: number;
  /** Characters remaining before the next part is added. */
  remaining: number;
  /** Characters that forced UCS-2 (for composer warnings). Empty for GSM-7. */
  nonGsmChars: string[];
}

/** True when every character fits the GSM-7 basic or extended set. */
export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM7_SET.has(ch) && !GSM7_EXT_SET.has(ch)) return false;
  }
  return true;
}

/**
 * Count segments for a message body.
 *
 * GSM-7 length is counted in septets (extended chars = 2). UCS-2 length
 * is counted in UTF-16 code units (astral emoji = 2), matching how
 * carriers bill.
 */
export function countSegments(text: string): SegmentCount {
  if (text.length === 0) {
    return {
      encoding: "GSM-7",
      length: 0,
      segments: 0,
      perSegment: 160,
      remaining: 160,
      nonGsmChars: [],
    };
  }

  if (isGsm7(text)) {
    let septets = 0;
    for (const ch of text) {
      septets += GSM7_EXT_SET.has(ch) ? 2 : 1;
    }
    const segments = septets <= 160 ? 1 : Math.ceil(septets / 153);
    const perSegment = segments === 1 ? 160 : 153;
    return {
      encoding: "GSM-7",
      length: septets,
      segments,
      perSegment,
      remaining: segments * perSegment - septets,
      nonGsmChars: [],
    };
  }

  // UCS-2: length in UTF-16 code units.
  const units = text.length;
  const segments = units <= 70 ? 1 : Math.ceil(units / 67);
  const perSegment = segments === 1 ? 70 : 67;
  const nonGsm = new Set<string>();
  for (const ch of text) {
    if (!GSM7_SET.has(ch) && !GSM7_EXT_SET.has(ch)) nonGsm.add(ch);
  }
  return {
    encoding: "UCS-2",
    length: units,
    segments,
    perSegment,
    remaining: segments * perSegment - units,
    nonGsmChars: [...nonGsm],
  };
}

/**
 * Worst-case expansion widths per merge field, informed by realistic
 * long values in this dataset (vessel-length campaign names, double-
 * barrelled surnames, etc.). Unknown fields assume 24 chars.
 */
export const MERGE_FIELD_WORST_CASE: Record<string, number> = {
  first_name: 15,
  last_name: 20,
  org_name: 40,
};

const DEFAULT_WORST_CASE = 24;

/** Matches `{{key}}` / `{{ key }}` — mirror of TEMPLATE_TOKEN_RE. */
const TOKEN_RE = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * Replace each merge-field token with a worst-case-width placeholder so
 * the composer can show a realistic upper bound for parts. Placeholder
 * text is GSM-safe, so encoding detection is driven by the literal body.
 */
export function expandMergeFieldsWorstCase(
  text: string,
  widths: Record<string, number> = MERGE_FIELD_WORST_CASE
): string {
  return text.replace(TOKEN_RE, (_m, key: string) =>
    "x".repeat(widths[key] ?? DEFAULT_WORST_CASE)
  );
}

/** Convenience: segment count for the worst-case expanded body. */
export function countSegmentsWorstCase(text: string): SegmentCount {
  return countSegments(expandMergeFieldsWorstCase(text));
}
