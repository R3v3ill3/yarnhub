"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { blackoutOverrideError } from "@/lib/sms/blast-body";
import { computeSendBefore } from "@/lib/sms/blackout";
import { validateSmsBody } from "@/lib/sms/compliance";
import { dispatchDueP2pSends } from "@/lib/sms/dispatch-p2p";
import { P2P_SEND_CAP, renderP2pBody } from "@/lib/sms/p2p";
import { inboxUnsafePurposeError } from "@/lib/sms/sender-purpose";

export async function queueP2pSend(
  formData: FormData,
): Promise<{ error?: string; warning?: string; sendId?: string; sent?: number }> {
  const { org, user, supabase } = await requireOrgMember();
  const body = String(formData.get("body") ?? "").trim();
  const numberId = String(formData.get("numberId") ?? "");
  const confirmWarning = String(formData.get("confirmWarning") ?? "") === "1";
  const blackoutOverride = String(formData.get("blackout_override") ?? "") === "on";
  const blackoutReason = String(formData.get("blackout_override_reason") ?? "");
  const contactIds = formData
    .getAll("contactId")
    .map((v) => String(v))
    .filter(Boolean);

  if (!body) return { error: "Message body is required" };
  if (!numberId) return { error: "Pick an inbox number to send from" };
  if (contactIds.length === 0) return { error: "Select at least one contact" };
  if (contactIds.length > P2P_SEND_CAP) {
    return { error: `P2P sends are capped at ${P2P_SEND_CAP} contacts per send` };
  }

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

  const { data: contacts, error: contactError } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, phone_e164, sms_opt_out")
    .eq("organisation_id", org.id)
    .in("id", contactIds);
  if (contactError) return { error: contactError.message };

  const eligible = (contacts ?? []).filter((c) => !c.sms_opt_out && c.phone_e164);
  if (eligible.length === 0) {
    return { error: "Selected contacts are opted out or missing a phone" };
  }

  const now = new Date();
  const sendBefore = computeSendBefore(now, org.timezone, blackoutOverride);

  const { data: send, error: sendError } = await supabase
    .from("sms_p2p_sends")
    .insert({
      organisation_id: org.id,
      sender_number_id: numberId,
      body_template: body,
      timezone: org.timezone,
      blackout_override: blackoutOverride,
      blackout_override_reason: blackoutOverride ? blackoutReason.trim() : null,
      status: "queued",
      created_by: user.id,
      queued_at: now.toISOString(),
    })
    .select("id")
    .single();
  if (sendError) return { error: sendError.message };

  const { error: itemError } = await supabase.from("sms_p2p_send_items").insert(
    eligible.map((c, index) => ({
      organisation_id: org.id,
      send_id: send.id,
      contact_id: c.id,
      phone_e164: c.phone_e164,
      body: renderP2pBody(body, {
        first_name: c.first_name ?? undefined,
        last_name: c.last_name ?? undefined,
        org_name: org.name,
      }),
      sort_order: index,
      status: "queued",
      send_before: sendBefore.toISOString(),
    })),
  );
  if (itemError) {
    await supabase.from("sms_p2p_sends").delete().eq("id", send.id);
    return { error: itemError.message };
  }

  const summary = await dispatchDueP2pSends(createAdminClient());
  const thisSend = summary.sends_completed.includes(send.id);

  revalidatePath("/p2p");
  revalidatePath("/inbox");
  return {
    sendId: send.id,
    sent: thisSend ? summary.sent : 0,
  };
}
