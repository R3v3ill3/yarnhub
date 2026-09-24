import { toE164 } from "@/lib/phone/normalise-phone";

export const CONSENT_BASES = ["manual", "import"] as const;
export type ConsentBasis = (typeof CONSENT_BASES)[number];

export interface AudienceRow {
  first_name: string;
  last_name: string;
  phone: string;
  phone_e164: string;
  line: number;
}

export interface AudienceReject {
  line: number;
  reason: string;
  raw: string;
}

export interface AudienceParseResult {
  rows: AudienceRow[];
  rejects: AudienceReject[];
}

const HEADER_SYNONYMS: Record<"first_name" | "last_name" | "phone", string[]> = {
  first_name: ["first_name", "first name", "firstname", "given name", "given_name", "first"],
  last_name: ["last_name", "last name", "lastname", "surname", "family name", "family_name", "last"],
  phone: ["phone", "mobile", "phone_e164", "mobile_number", "cell"],
};

function splitCells(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function headerIndex(header: string[], field: keyof typeof HEADER_SYNONYMS): number {
  const synonyms = HEADER_SYNONYMS[field];
  return header.findIndex((cell) => synonyms.includes(cell.toLowerCase()));
}

/**
 * Parse a CSV (or a sheet already flattened to CSV) into audience rows.
 * A bare number with no first and last name is rejected. Invalid mobiles
 * are rejected with a reason instead of being skipped silently.
 */
export function parseAudienceCsv(text: string): AudienceParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows: AudienceRow[] = [];
  const rejects: AudienceReject[] = [];
  if (lines.length === 0) return { rows, rejects };

  const first = splitCells(lines[0]).map((cell) => cell.toLowerCase());
  const phoneIdx = headerIndex(first, "phone");
  const hasHeader = phoneIdx >= 0 && first.length > 1;
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const resolvedPhoneIdx = hasHeader ? phoneIdx : 0;
  const firstIdx = hasHeader ? headerIndex(first, "first_name") : -1;
  const lastIdx = hasHeader ? headerIndex(first, "last_name") : -1;
  const nameIdx = hasHeader ? first.findIndex((cell) => cell === "name") : -1;
  const lineOffset = hasHeader ? 2 : 1;

  dataLines.forEach((line, index) => {
    const lineNo = index + lineOffset;
    const cells = splitCells(line);
    const phoneRaw = cells[resolvedPhoneIdx] ?? "";
    let firstName = firstIdx >= 0 ? cells[firstIdx] ?? "" : "";
    let lastName = lastIdx >= 0 ? cells[lastIdx] ?? "" : "";
    if (!firstName && nameIdx >= 0) {
      const parts = (cells[nameIdx] ?? "").split(/\s+/).filter(Boolean);
      firstName = parts[0] ?? "";
      lastName = parts.slice(1).join(" ");
    }
    if (!firstName.trim() || !lastName.trim()) {
      rejects.push({
        line: lineNo,
        reason: "First and last name are both required",
        raw: line,
      });
      return;
    }
    const phone = toE164(phoneRaw);
    if (!phone) {
      rejects.push({
        line: lineNo,
        reason: "Not a valid Australian mobile",
        raw: line,
      });
      return;
    }
    rows.push({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone: phoneRaw,
      phone_e164: phone,
      line: lineNo,
    });
  });

  return { rows, rejects };
}
