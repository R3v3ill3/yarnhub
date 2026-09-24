"use server";

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { parseAudienceCsv } from "@/lib/sms/audience-import";
import { CONSENT_ATTESTATION } from "@/lib/sms/contact-lists";
import { toE164 } from "@/lib/phone/normalise-phone";

async function spreadsheetToCsv(formData: FormData): Promise<string> {
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".csv") || name.endsWith(".txt")) return file.text();
    const book = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer" });
    const sheet = book.Sheets[book.SheetNames[0] ?? ""];
    if (!sheet) return "";
    return XLSX.utils.sheet_to_csv(sheet);
  }
  return String(formData.get("csv") ?? "");
}

function consentError(formData: FormData): string | null {
  if (String(formData.get("consent") ?? "") !== "on") return CONSENT_ATTESTATION;
  return null;
}

export async function addContact(formData: FormData): Promise<{ error?: string }> {
  const { org, supabase } = await requireOrgMember();
  const attested = consentError(formData);
  if (attested) return { error: attested };
  const phone = toE164(String(formData.get("phone") ?? ""));
  if (!phone) return { error: "Enter a valid Australian mobile" };
  const first_name = String(formData.get("first_name") ?? "").trim();
  const last_name = String(formData.get("last_name") ?? "").trim();
  if (!first_name || !last_name) return { error: "First and last name are both required" };

  const { error } = await supabase.from("contacts").upsert(
    {
      organisation_id: org.id,
      phone_e164: phone,
      first_name,
      last_name,
      sms_consent_source: "manual",
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
  rejects?: string[];
}> {
  const { org, supabase } = await requireOrgMember();
  const attested = consentError(formData);
  if (attested) return { error: attested };
  const text = await spreadsheetToCsv(formData);
  const parsed = parseAudienceCsv(text);
  if (parsed.rows.length === 0 && parsed.rejects.length === 0) {
    return { error: "No rows to import" };
  }

  let imported = 0;
  let skipped = parsed.rejects.length;
  for (const row of parsed.rows) {
    const { error } = await supabase.from("contacts").upsert(
      {
        organisation_id: org.id,
        phone_e164: row.phone_e164,
        first_name: row.first_name,
        last_name: row.last_name,
        sms_consent_source: "import",
      },
      { onConflict: "organisation_id,phone_e164" },
    );
    if (error) skipped += 1;
    else imported += 1;
  }
  revalidatePath("/contacts");
  return {
    imported,
    skipped,
    rejects: parsed.rejects.slice(0, 8).map((row) => `Line ${row.line}: ${row.reason}`),
  };
}

export async function addListMember(formData: FormData): Promise<{ error?: string }> {
  const { org, supabase } = await requireOrgMember();
  const listId = String(formData.get("listId") ?? "");
  const contactId = String(formData.get("contactId") ?? "");
  if (!listId || !contactId) return { error: "Pick a contact" };
  const { error } = await supabase.from("contact_list_members").insert({
    list_id: listId,
    contact_id: contactId,
    organisation_id: org.id,
  });
  if (error) return { error: error.message };
  revalidatePath(`/contacts/lists/${listId}`);
  revalidatePath("/contacts");
  return {};
}

export async function removeListMember(formData: FormData): Promise<{ error?: string }> {
  const { org, supabase } = await requireOrgMember();
  const listId = String(formData.get("listId") ?? "");
  const contactId = String(formData.get("contactId") ?? "");
  const { error } = await supabase
    .from("contact_list_members")
    .delete()
    .eq("list_id", listId)
    .eq("contact_id", contactId)
    .eq("organisation_id", org.id);
  if (error) return { error: error.message };
  revalidatePath(`/contacts/lists/${listId}`);
  return {};
}

export async function snapshotContactList(formData: FormData): Promise<{
  error?: string;
}> {
  const { org, supabase } = await requireOrgMember();
  const name = String(formData.get("list_name") ?? "").trim();
  if (!name) return { error: "List name is required" };

  const { data: contacts, error: contactError } = await supabase
    .from("contacts")
    .select("id")
    .eq("organisation_id", org.id);
  if (contactError) return { error: contactError.message };
  if (!contacts?.length) return { error: "Add contacts before saving a list" };

  const { data: list, error: listError } = await supabase
    .from("contact_lists")
    .insert({ organisation_id: org.id, name })
    .select("id")
    .single();
  if (listError) return { error: listError.message };

  const { error: memberError } = await supabase.from("contact_list_members").insert(
    contacts.map((c) => ({
      list_id: list.id,
      contact_id: c.id,
      organisation_id: org.id,
    })),
  );
  if (memberError) return { error: memberError.message };
  revalidatePath("/contacts");
  revalidatePath("/blasts/new");
  revalidatePath("/sms/new");
  return {};
}
