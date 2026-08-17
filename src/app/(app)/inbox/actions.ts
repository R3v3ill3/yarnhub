"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { isMockSmsProvider, getSmsProviderForOrg } from "@/lib/sms/provider";
import { processInboundWebhook } from "@/lib/sms/process-inbound";
import { toE164 } from "@/lib/phone/normalise-phone";
import { providerAccountLookup } from "@/lib/sms/provider-lookup";
import { wrapSmsProviderForOrg } from "@/lib/sms/send-guard";
import { appendOutboundMessage, upsertOutboundThread } from "@/lib/sms/thread-write";

export async function simulateInboundReply(formData: FormData): Promise<{
  error?: string;
}> {
  if (!isMockSmsProvider()) {
    return { error: "Simulate reply is only available when SMS_PROVIDER=mock" };
  }
  const { org, supabase } = await requireOrgMember();
  const conversationId = String(formData.get("conversationId") ?? "");
  const body = String(formData.get("body") ?? "").trim() || "Hello from mock inbound";

  const { data: conv, error } = await supabase
    .from("sms_conversations")
    .select("id, phone_e164, our_number_id, sms_numbers ( phone_e164 )")
    .eq("id", conversationId)
    .eq("organisation_id", org.id)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!conv) return { error: "Thread not found" };

  const number = conv.sms_numbers as { phone_e164: string } | { phone_e164: string }[] | null;
  const ourPhone = Array.isArray(number) ? number[0]?.phone_e164 : number?.phone_e164;
  if (!ourPhone) return { error: "Thread number is missing" };

  const from = toE164(conv.phone_e164);
  if (!from) return { error: "Member phone is invalid" };

  const admin = createAdminClient();
  await processInboundWebhook({
    admin,
    orgId: org.id,
    event: {
      type: "inbound",
      from,
      to: ourPhone,
      body,
      providerMessageId: `mock-in-${crypto.randomUUID()}`,
      originalMessageId: null,
      originalCustomRef: null,
      receivedAt: new Date().toISOString(),
    },
  });

  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
  return {};
}

export async function sendInboxReply(formData: FormData): Promise<{ error?: string }> {
  const { org, user, supabase } = await requireOrgMember();
  const conversationId = String(formData.get("conversationId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Message body is required" };

  const { data: conv, error } = await supabase
    .from("sms_conversations")
    .select(
      "id, phone_e164, contact_id, our_number_id, sms_numbers ( id, phone_e164, status ), contacts ( sms_opt_out )",
    )
    .eq("id", conversationId)
    .eq("organisation_id", org.id)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!conv) return { error: "Thread not found" };

  const contact = conv.contacts as { sms_opt_out: boolean } | { sms_opt_out: boolean }[] | null;
  const person = Array.isArray(contact) ? contact[0] : contact;
  if (person?.sms_opt_out) {
    return { error: "This contact has opted out of SMS" };
  }

  const number = conv.sms_numbers as
    | { id: string; phone_e164: string; status: string }
    | { id: string; phone_e164: string; status: string }[]
    | null;
  const our = Array.isArray(number) ? number[0] : number;
  if (!our || our.status !== "active") return { error: "Thread number is missing or retired" };

  const to = toE164(conv.phone_e164);
  if (!to) return { error: "Member phone is invalid" };

  const admin = createAdminClient();
  let provider;
  try {
    provider = wrapSmsProviderForOrg(
      admin,
      org.id,
      await getSmsProviderForOrg(org.id, providerAccountLookup(admin)),
    );
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "SMS provider is not configured",
    };
  }

  const results = await provider.sendBatch(
    [{ to, body, sender: our.phone_e164, customRef: `inbox-${conversationId}` }],
    { idempotencyKey: `inbox:${conversationId}:${Date.now()}` },
  );
  const result = results[0];
  if (!result || result.status !== "success") {
    return { error: result?.error || "Send failed" };
  }

  const sentAt = new Date().toISOString();
  const threadId = await upsertOutboundThread(admin, {
    orgId: org.id,
    ourNumberId: conv.our_number_id,
    phoneE164: to,
    contactId: conv.contact_id,
    sentAt,
  });
  await appendOutboundMessage(admin, {
    orgId: org.id,
    conversationId: threadId,
    body,
    phoneE164: to,
    senderUserId: user.id,
    providerMessageId: result.providerMessageId,
    status: result.status,
  });

  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
  return {};
}

export async function updateContactNotes(formData: FormData): Promise<{ error?: string }> {
  const { org, supabase } = await requireOrgMember();
  const contactId = String(formData.get("contactId") ?? "");
  const conversationId = String(formData.get("conversationId") ?? "");
  const notes = String(formData.get("notes") ?? "");
  if (!contactId) return { error: "Contact is missing" };

  const { error } = await supabase
    .from("contacts")
    .update({ notes })
    .eq("id", contactId)
    .eq("organisation_id", org.id);
  if (error) return { error: error.message };

  revalidatePath(`/inbox/${conversationId}`);
  return {};
}

export async function claimConversation(formData: FormData): Promise<{ error?: string }> {
  const { org, user, supabase } = await requireOrgMember();
  const conversationId = String(formData.get("conversationId") ?? "");
  const action = String(formData.get("action") ?? "claim");
  if (!conversationId) return { error: "Thread is missing" };

  const patch =
    action === "release"
      ? { claimed_by: null, claimed_at: null }
      : { claimed_by: user.id, claimed_at: new Date().toISOString() };

  const { error } = await supabase
    .from("sms_conversations")
    .update(patch)
    .eq("id", conversationId)
    .eq("organisation_id", org.id);
  if (error) return { error: error.message };

  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
  return {};
}
