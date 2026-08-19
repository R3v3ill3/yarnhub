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

/** Returns false when a provider_message_id already exists (redelivery). */
export async function appendInboundMessage(
  admin: SupabaseClient,
  args: {
    orgId: string;
    conversationId: string;
    body: string;
    phoneE164: string;
    providerMessageId: string | null;
    createdAt?: string;
  },
): Promise<boolean> {
  if (args.providerMessageId) {
    const { data: existing } = await admin
      .from("sms_messages")
      .select("id")
      .eq("organisation_id", args.orgId)
      .eq("provider_message_id", args.providerMessageId)
      .maybeSingle();
    if (existing) return false;
  }

  const { error } = await admin.from("sms_messages").insert({
    organisation_id: args.orgId,
    conversation_id: args.conversationId,
    direction: "inbound",
    body: args.body,
    phone_e164: args.phoneE164,
    provider_message_id: args.providerMessageId,
    status: "received",
    created_at: args.createdAt,
  });
  if (error && error.code === UNIQUE_VIOLATION) return false;
  if (error) throw error;
  return true;
}

export async function touchConversationTimestamps(
  admin: SupabaseClient,
  args: {
    conversationId: string;
    occurredAt: string;
    direction: "inbound" | "outbound";
  },
): Promise<void> {
  const stamp =
    args.direction === "inbound"
      ? { last_message_at: args.occurredAt, last_inbound_at: args.occurredAt }
      : { last_message_at: args.occurredAt, last_outbound_at: args.occurredAt };
  const { error } = await admin
    .from("sms_conversations")
    .update(stamp)
    .eq("id", args.conversationId)
    .or(`last_message_at.is.null,last_message_at.lt.${args.occurredAt}`);
  if (error) console.error("touchConversationTimestamps failed:", error);
}

export async function bumpConversationUnread(
  admin: SupabaseClient,
  conversationId: string,
  occurredAt: string,
): Promise<void> {
  const { data: conv } = await admin
    .from("sms_conversations")
    .select("unread_count")
    .eq("id", conversationId)
    .single();
  await admin
    .from("sms_conversations")
    .update({
      last_message_at: occurredAt,
      last_inbound_at: occurredAt,
      unread_count: (conv?.unread_count ?? 0) + 1,
      state: "needs_reply",
    })
    .eq("id", conversationId);
}
