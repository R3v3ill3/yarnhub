"use server";

import { revalidatePath } from "next/cache";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { destructiveRoleError } from "@/lib/auth/roles";
import { blackoutOverrideError } from "@/lib/sms/blast-body";
import { computeSendBefore } from "@/lib/sms/blackout";
import { validateSmsBody } from "@/lib/sms/compliance";
import { insertContactList } from "@/lib/sms/contact-lists";
import { archiveBlockReason } from "@/lib/sms/archive-policy";
import {
  BLAST_COHORT_LABELS,
  computeBlastCohortContactIds,
  type BlastCohort,
} from "@/lib/sms/reporting-cohorts";
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
  const asDraft = String(formData.get("save_as") ?? "") === "draft";

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
      status: asDraft ? "draft" : "queued",
      created_by: user.id,
      queued_at: asDraft ? null : now.toISOString(),
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

export async function setBlastLifecycle(formData: FormData): Promise<{ error?: string }> {
  const { org, supabase, role } = await requireOrgMember();
  const blocked = destructiveRoleError(role);
  if (blocked) return { error: blocked };
  const blastId = String(formData.get("blastId") ?? "");
  const action = String(formData.get("action") ?? "");
  const { data: blast } = await supabase
    .from("sms_blasts")
    .select("id, status")
    .eq("id", blastId)
    .eq("organisation_id", org.id)
    .maybeSingle();
  if (!blast) return { error: "Blast not found" };

  if (action === "pause") {
    if (blast.status !== "queued" && blast.status !== "sending") {
      return { error: "Only a queued or sending blast can be paused" };
    }
    const { error } = await supabase
      .from("sms_blasts")
      .update({ status: "paused" })
      .eq("id", blastId);
    if (error) return { error: error.message };
    const { error: releaseError } = await supabase
      .from("sms_blast_items")
      .update({ status: "queued", claimed_at: null })
      .eq("blast_id", blastId)
      .eq("organisation_id", org.id)
      .eq("status", "sending");
    if (releaseError) return { error: releaseError.message };
  } else if (action === "resume" || action === "queue") {
    if (blast.status !== "paused" && blast.status !== "draft") {
      return { error: "Only a draft or paused blast can be queued" };
    }
    const { error } = await supabase
      .from("sms_blasts")
      .update({ status: "queued", queued_at: new Date().toISOString() })
      .eq("id", blastId);
    if (error) return { error: error.message };
  } else if (action === "cancel") {
    if (blast.status === "sent" || blast.status === "cancelled") {
      return { error: "This blast is already finished" };
    }
    const { error } = await supabase
      .from("sms_blasts")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", blastId);
    if (error) return { error: error.message };
    await supabase
      .from("sms_blast_items")
      .update({ status: "skipped", failure_reason: "Blast cancelled" })
      .eq("blast_id", blastId)
      .eq("organisation_id", org.id)
      .in("status", ["queued", "sending"]);
  } else if (action === "archive" || action === "restore") {
    const reason = action === "archive" ? archiveBlockReason("blast", blast.status) : null;
    if (reason) return { error: reason };
    const { error } = await supabase
      .from("sms_blasts")
      .update({ archived_at: action === "archive" ? new Date().toISOString() : null })
      .eq("id", blastId);
    if (error) return { error: error.message };
  } else {
    return { error: "Unknown blast action" };
  }

  revalidatePath("/blasts");
  revalidatePath(`/blasts/${blastId}`);
  return {};
}

const BLAST_COHORTS: BlastCohort[] = ["replied", "delivered_not_replied", "failed"];

export async function createBlastCohortList(formData: FormData): Promise<{ error?: string }> {
  const { org, supabase, role } = await requireOrgMember();
  const blocked = destructiveRoleError(role);
  if (blocked) return { error: blocked };
  const blastId = String(formData.get("blastId") ?? "");
  const cohort = String(formData.get("cohort") ?? "") as BlastCohort;
  const name = String(formData.get("list_name") ?? "").trim();
  if (!BLAST_COHORTS.includes(cohort)) return { error: "Pick a cohort" };

  const { data: items } = await supabase
    .from("sms_blast_items")
    .select("contact_id, status, sent_at")
    .eq("blast_id", blastId)
    .eq("organisation_id", org.id);
  const { data: logs } = await supabase
    .from("sms_send_log")
    .select("contact_id, status, sent_at")
    .eq("blast_id", blastId)
    .eq("organisation_id", org.id);
  const delivery = new Map(
    (logs ?? []).map((row) => [row.contact_id as string, row.status as string]),
  );
  const contactIds = [...new Set((items ?? []).map((item) => item.contact_id as string))];
  const { data: conversations } = contactIds.length
    ? await supabase
        .from("sms_conversations")
        .select("contact_id, last_inbound_at")
        .eq("organisation_id", org.id)
        .in("contact_id", contactIds)
    : { data: [] };
  const lastInbound = new Map<string, string>();
  for (const row of conversations ?? []) {
    if (!row.contact_id || !row.last_inbound_at) continue;
    const previous = lastInbound.get(row.contact_id);
    if (!previous || Date.parse(row.last_inbound_at) > Date.parse(previous)) {
      lastInbound.set(row.contact_id, row.last_inbound_at);
    }
  }
  const ids = computeBlastCohortContactIds(
    (items ?? []).map((item) => ({
      contact_id: item.contact_id as string,
      status: delivery.get(item.contact_id as string) ?? (item.status as string),
      sent_at: (item.sent_at as string | null) ?? null,
    })),
    lastInbound,
    cohort,
  );
  const created = await insertContactList(supabase, {
    orgId: org.id,
    name: name || `${BLAST_COHORT_LABELS[cohort]} from blast`,
    contactIds: ids,
  });
  if (created.error) return { error: created.error };
  revalidatePath("/contacts");
  revalidatePath(`/blasts/${blastId}`);
  return {};
}
