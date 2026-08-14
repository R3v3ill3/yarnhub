import type { SupabaseClient } from "@supabase/supabase-js";

const UNIQUE_VIOLATION = "23505";

export async function upsertOutboundThread(
  admin: SupabaseClient,
  args: {
    orgId: string;
    ourNumberId: string;
    phoneE164: string;
    contactId: string | null;
    sentAt: string;
  },
): Promise<string> {
  const { data: existing } = await admin
    .from("sms_conversations")
    .select("id")
    .eq("organisation_id", args.orgId)
    .eq("our_number_id", args.ourNumberId)
    .eq("phone_e164", args.phoneE164)
    .maybeSingle();
  if (existing?.id) {
    await admin
      .from("sms_conversations")
      .update({
        last_message_at: args.sentAt,
        last_outbound_at: args.sentAt,
        contact_id: args.contactId,
        state: "open",
      })
      .eq("id", existing.id)
      .or(`last_message_at.is.null,last_message_at.lt.${args.sentAt}`);
    return existing.id as string;
  }

  const { data: created, error } = await admin
    .from("sms_conversations")
    .insert({
      organisation_id: args.orgId,
      our_number_id: args.ourNumberId,
      phone_e164: args.phoneE164,
      contact_id: args.contactId,
      state: "open",
      last_message_at: args.sentAt,
      last_outbound_at: args.sentAt,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const { data: raced } = await admin
        .from("sms_conversations")
        .select("id")
        .eq("organisation_id", args.orgId)
        .eq("our_number_id", args.ourNumberId)
        .eq("phone_e164", args.phoneE164)
        .single();
      return raced!.id as string;
    }
    throw error;
  }
  return created!.id as string;
}

export async function appendOutboundMessage(
  admin: SupabaseClient,
  args: {
    orgId: string;
    conversationId: string;
    body: string;
    phoneE164: string;
    senderUserId: string | null;
    providerMessageId: string | null;
    status: string;
  },
): Promise<void> {
  const { error } = await admin.from("sms_messages").insert({
    organisation_id: args.orgId,
    conversation_id: args.conversationId,
    direction: "outbound",
    body: args.body,
    phone_e164: args.phoneE164,
    sender_user_id: args.senderUserId,
    provider_message_id: args.providerMessageId,
    status: args.status,
  });
  if (error && error.code !== UNIQUE_VIOLATION) throw error;
}
