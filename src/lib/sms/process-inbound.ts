import type { SupabaseClient } from "@supabase/supabase-js";
import { toE164 } from "@/lib/phone/normalise-phone";
import {
  inboundPhoneAndTo,
  isStopEvent,
  routeInboundThread,
} from "@/lib/sms/inbound";
import type { SmsWebhookEvent } from "@/lib/sms/provider/types";
import type { RoutingNumber } from "@/lib/sms/conversation-routing";

const UNIQUE_VIOLATION = "23505";

export async function processInboundWebhook(args: {
  admin: SupabaseClient;
  orgId: string;
  event: SmsWebhookEvent;
}): Promise<{
  ok: boolean;
  status: number;
  error?: string;
  conversationId?: string;
  optedOut?: boolean;
}> {
  const { admin, orgId, event } = args;

  if (event.type === "status") {
    if (event.providerMessageId) {
      await admin
        .from("sms_messages")
        .update({ status: event.status })
        .eq("organisation_id", orgId)
        .eq("provider_message_id", event.providerMessageId);
    }
    return { ok: true, status: 200 };
  }

  if (event.type === "unknown") {
    return { ok: true, status: 200 };
  }

  const inbound = inboundPhoneAndTo(event);
  if (!inbound) return { ok: true, status: 200 };

  const { data: numberRows, error: numberError } = await admin
    .from("sms_numbers")
    .select("id, organisation_id, phone_e164")
    .eq("organisation_id", orgId)
    .eq("status", "active");
  if (numberError) throw numberError;

  const numbers = (numberRows ?? []) as RoutingNumber[];
  const phoneE164 = toE164(inbound.from);
  const routed = routeInboundThread({
    orgId,
    numbers,
    to: inbound.to,
    phoneE164,
    existingConversationId: null,
  });

  if (routed.decision.action === "none") {
    return {
      ok: false,
      status: 400,
      error:
        routed.decision.reason === "no_number"
          ? "Inbound to-number is not registered to this organisation"
          : "Could not normalise sender phone",
    };
  }

  const ourNumberId =
    routed.decision.action === "create"
      ? routed.decision.conversation.our_number_id
      : routed.number!.id;
  const memberPhone =
    routed.decision.action === "create"
      ? routed.decision.conversation.phone_e164
      : phoneE164!;

  const stop = isStopEvent(event);
  if (stop) {
    await admin
      .from("contacts")
      .update({
        sms_opt_out: true,
        sms_opt_out_at: new Date().toISOString(),
        sms_opt_out_source:
          event.type === "unsubscribe" ? "provider_unsubscribe" : "stop_keyword",
      })
      .eq("organisation_id", orgId)
      .eq("phone_e164", memberPhone);
  }

  const contactId = await ensureContact(admin, orgId, memberPhone, stop);

  const conversationId = await upsertConversation(admin, {
    orgId,
    ourNumberId,
    phoneE164: memberPhone,
    contactId,
  });

  if (inbound.providerMessageId) {
    const { data: existing } = await admin
      .from("sms_messages")
      .select("id")
      .eq("organisation_id", orgId)
      .eq("provider_message_id", inbound.providerMessageId)
      .maybeSingle();
    if (existing) {
      return { ok: true, status: 200, conversationId, optedOut: stop };
    }
  }

  const { error: insertError } = await admin.from("sms_messages").insert({
    organisation_id: orgId,
    conversation_id: conversationId,
    direction: "inbound",
    body: inbound.body || (stop ? "STOP" : ""),
    phone_e164: memberPhone,
    provider_message_id: inbound.providerMessageId,
    status: "received",
  });
  if (insertError && insertError.code !== UNIQUE_VIOLATION) throw insertError;
  if (insertError?.code === UNIQUE_VIOLATION) {
    return { ok: true, status: 200, conversationId, optedOut: stop };
  }

  const { data: conv } = await admin
    .from("sms_conversations")
    .select("unread_count")
    .eq("id", conversationId)
    .single();

  const now = new Date().toISOString();
  await admin
    .from("sms_conversations")
    .update({
      last_message_at: now,
      last_inbound_at: now,
      unread_count: (conv?.unread_count ?? 0) + 1,
      state: "open",
      contact_id: contactId,
    })
    .eq("id", conversationId);

  return { ok: true, status: 200, conversationId, optedOut: stop };
}

async function ensureContact(
  admin: SupabaseClient,
  orgId: string,
  phoneE164: string,
  optedOut: boolean,
): Promise<string | null> {
  const { data: existing } = await admin
    .from("contacts")
    .select("id")
    .eq("organisation_id", orgId)
    .eq("phone_e164", phoneE164)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: created, error } = await admin
    .from("contacts")
    .insert({
      organisation_id: orgId,
      phone_e164: phoneE164,
      ...(optedOut
        ? {
            sms_opt_out: true,
            sms_opt_out_at: new Date().toISOString(),
            sms_opt_out_source: "stop_keyword",
          }
        : {}),
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const { data: raced } = await admin
        .from("contacts")
        .select("id")
        .eq("organisation_id", orgId)
        .eq("phone_e164", phoneE164)
        .maybeSingle();
      return (raced?.id as string) ?? null;
    }
    throw error;
  }
  return (created?.id as string) ?? null;
}

async function upsertConversation(
  admin: SupabaseClient,
  args: {
    orgId: string;
    ourNumberId: string;
    phoneE164: string;
    contactId: string | null;
  },
): Promise<string> {
  const { data: existing } = await admin
    .from("sms_conversations")
    .select("id")
    .eq("organisation_id", args.orgId)
    .eq("our_number_id", args.ourNumberId)
    .eq("phone_e164", args.phoneE164)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: created, error } = await admin
    .from("sms_conversations")
    .insert({
      organisation_id: args.orgId,
      our_number_id: args.ourNumberId,
      phone_e164: args.phoneE164,
      contact_id: args.contactId,
      state: "open",
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
