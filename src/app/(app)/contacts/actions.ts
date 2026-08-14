"use server";

import { revalidatePath } from "next/cache";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { toE164 } from "@/lib/phone/normalise-phone";

function parseCsv(text: string): Array<{
  first_name: string | null;
  last_name: string | null;
  phone: string;
}> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const split = (line: string) =>
    line.split(",").map((cell) => cell.trim().replace(/^["']|["']$/g, ""));

  const header = split(lines[0]).map((h) => h.toLowerCase());
  const hasHeader =
    header.some((h) => h.includes("phone") || h.includes("mobile")) &&
    header.length > 1;
  const rows = hasHeader ? lines.slice(1) : lines;
  const phoneIdx = hasHeader
    ? header.findIndex((h) => h.includes("phone") || h.includes("mobile"))
    : 0;
  const firstIdx = hasHeader ? header.findIndex((h) => h.includes("first")) : -1;
  const lastIdx = hasHeader ? header.findIndex((h) => h.includes("last")) : -1;
  const nameIdx = hasHeader ? header.findIndex((h) => h === "name") : -1;

  return rows.map((line) => {
    const cells = split(line);
    const phone = cells[Math.max(phoneIdx, 0)] ?? "";
    let first_name: string | null = firstIdx >= 0 ? cells[firstIdx] || null : null;
    let last_name: string | null = lastIdx >= 0 ? cells[lastIdx] || null : null;
    if (!first_name && nameIdx >= 0) {
      const parts = (cells[nameIdx] ?? "").split(/\s+/);
      first_name = parts[0] || null;
      last_name = parts.slice(1).join(" ") || null;
    }
    return { first_name, last_name, phone };
  });
}

export async function addContact(formData: FormData): Promise<{ error?: string }> {
  const { org, supabase } = await requireOrgMember();
  const phone = toE164(String(formData.get("phone") ?? ""));
  if (!phone) return { error: "Enter a valid Australian mobile" };
  const first_name = String(formData.get("first_name") ?? "").trim() || null;
  const last_name = String(formData.get("last_name") ?? "").trim() || null;

  const { error } = await supabase.from("contacts").upsert(
    {
      organisation_id: org.id,
      phone_e164: phone,
      first_name,
      last_name,
    },
    { onConflict: "organisation_id,phone_e164" },
  );
  if (error) return { error: error.message };
  revalidatePath("/contacts");
  return {};
}

export async function importContactsCsv(formData: FormData): Promise<{
  error?: string;
  imported?: number;
  skipped?: number;
}> {
  const { org, supabase } = await requireOrgMember();
  const text = String(formData.get("csv") ?? "");
  const rows = parseCsv(text);
  if (rows.length === 0) return { error: "No rows to import" };

  let imported = 0;
  let skipped = 0;
  for (const row of rows) {
    const phone = toE164(row.phone);
    if (!phone) {
      skipped += 1;
      continue;
    }
    const { error } = await supabase.from("contacts").upsert(
      {
        organisation_id: org.id,
        phone_e164: phone,
        first_name: row.first_name,
        last_name: row.last_name,
      },
      { onConflict: "organisation_id,phone_e164" },
    );
    if (error) skipped += 1;
    else imported += 1;
  }
  revalidatePath("/contacts");
  return { imported, skipped };
}
