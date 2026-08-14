"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { isMockSmsProvider } from "@/lib/sms/provider";
import { processInboundWebhook } from "@/lib/sms/process-inbound";
import { toE164 } from "@/lib/phone/normalise-phone";

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
