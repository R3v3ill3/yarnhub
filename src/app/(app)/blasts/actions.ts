"use server";

import { revalidatePath } from "next/cache";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { destructiveRoleError } from "@/lib/auth/roles";
import { blackoutOverrideError } from "@/lib/sms/blast-body";
import { computeSendBefore } from "@/lib/sms/blackout";
import { validateSmsBody } from "@/lib/sms/compliance";
import { inboxUnsafePurposeError } from "@/lib/sms/sender-purpose";

export async function queueBlast(
  formData: FormData,
): Promise<{ error?: string; warning?: string; blastId?: string }> {
  const { org, user, supabase, role } = await requireOrgMember();
  const blocked = destructiveRoleError(role);
  if (blocked) return { error: blocked };
  const name = String(formData.get("name") ?? "").trim() || null;
  const body = String(formData.get("body") ?? "").trim();
  const numberId = String(formData.get("numberId") ?? "");
  const audience = String(formData.get("audience") ?? "all");
  const listId = String(formData.get("listId") ?? "");
  const confirmWarning = String(formData.get("confirmWarning") ?? "") === "1";
  const blackoutOverride = String(formData.get("blackout_override") ?? "") === "on";
  const blackoutReason = String(formData.get("blackout_override_reason") ?? "");

  if (!body) return { error: "Message body is required" };
  if (!numberId) return { error: "Pick an inbox number to send from" };

  const overrideErr = blackoutOverrideError(blackoutOverride, blackoutReason);
  if (overrideErr) return { error: overrideErr };

  const { data: number, error: numberError } = await supabase
    .from("sms_numbers")
    .select("id, purpose, status")
    .eq("id", numberId)
    .eq("organisation_id", org.id)
    .maybeSingle();
  if (numberError) return { error: numberError.message };
  if (!number || number.status !== "active") {
    return { error: "Unknown or retired number" };
  }
  const purposeBlock = inboxUnsafePurposeError(number.purpose);
  if (purposeBlock) return { error: purposeBlock };

  const compliance = validateSmsBody(body, org.name);
  if (!compliance.ok) {
    return { error: compliance.errors.join(" ") || "Message failed compliance" };
  }
  if (compliance.warnings.length > 0 && !confirmWarning) {
    return { warning: compliance.warnings[0] };
  }

  let contacts: Array<{ id: string; phone_e164: string; sms_opt_out: boolean }> = [];
  if (audience === "list") {
    if (!listId) return { error: "Pick a saved list" };
    const { data: members, error: memberError } = await supabase
      .from("contact_list_members")
      .select("contact_id, contacts ( id, phone_e164, sms_opt_out )")
      .eq("list_id", listId)
      .eq("organisation_id", org.id);
    if (memberError) return { error: memberError.message };
    contacts = (members ?? [])
      .map((row) => {
        const c = row.contacts as
          | { id: string; phone_e164: string; sms_opt_out: boolean }
          | { id: string; phone_e164: string; sms_opt_out: boolean }[]
          | null;
        return Array.isArray(c) ? c[0] : c;
      })
      .filter((c): c is { id: string; phone_e164: string; sms_opt_out: boolean } => Boolean(c));
  } else {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, phone_e164, sms_opt_out")
      .eq("organisation_id", org.id);
    if (error) return { error: error.message };
    contacts = data ?? [];
  }

  const seen = new Set<string>();
  const eligible = contacts.filter((c) => {
    if (c.sms_opt_out || !c.phone_e164 || seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
  if (eligible.length === 0) {
    return { error: "No eligible contacts (everyone is opted out or missing a phone)" };
  }

  const now = new Date();
  const sendBefore = computeSendBefore(now, org.timezone, blackoutOverride);

  const { data: blast, error: blastError } = await supabase
    .from("sms_blasts")
    .insert({
      organisation_id: org.id,
      name,
      body,
      sender_number_id: numberId,
      timezone: org.timezone,
      blackout_override: blackoutOverride,
      blackout_override_reason: blackoutOverride ? blackoutReason.trim() : null,
      status: "queued",
      created_by: user.id,
      queued_at: now.toISOString(),
    })
    .select("id")
    .single();
  if (blastError) return { error: blastError.message };

  const { error: itemError } = await supabase.from("sms_blast_items").insert(
    eligible.map((c, index) => ({
      organisation_id: org.id,
      blast_id: blast.id,
      contact_id: c.id,
      phone_e164: c.phone_e164,
      sort_order: index,
      status: "queued",
      send_before: sendBefore.toISOString(),
    })),
  );
  if (itemError) {
    await supabase.from("sms_blasts").delete().eq("id", blast.id);
    return { error: itemError.message };
  }

  revalidatePath("/blasts");
  revalidatePath(`/blasts/${blast.id}`);
  return { blastId: blast.id };
}
