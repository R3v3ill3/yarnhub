import type { SupabaseClient } from "@supabase/supabase-js";
import { toE164 } from "@/lib/phone/normalise-phone";
import {
  decideInboundLeg,
  inboundPhoneAndTo,
  isStopEvent,
  routeInboundThread,
} from "@/lib/sms/inbound";
import type {
  MessageDeliveryStatus,
  SmsWebhookEvent,
} from "@/lib/sms/provider/types";
import type { RoutingNumber } from "@/lib/sms/conversation-routing";
import {
  getSmsProviderForOrg,
  type SmsProvider,
} from "@/lib/sms/provider";
import { providerAccountLookup } from "@/lib/sms/provider-lookup";
import {
  findLiveSessionByPhone,
  loadOrgName,
  processSurveyInbound,
  terminateSessionsForPhone,
} from "@/lib/sms/survey-runtime";
import {
  findLiveRelayByNumberId,
  processRelayInbound,
} from "@/lib/sms/relay-runtime";
import {
  appendInboundMessage,
  bumpConversationUnread,
} from "@/lib/sms/thread-write";

const UNIQUE_VIOLATION = "23505";

/** Terminal MM statuses that may promote a row still in `sent`. */
export function terminalDeliveryStatus(
  status: MessageDeliveryStatus,
): "delivered" | "failed" | null {
  if (status === "delivered") return "delivered";
  if (status === "failed" || status === "cancelled") return "failed";
  return null;
}

export async function processInboundWebhook(args: {
  admin: SupabaseClient;
  orgId: string;
  event: SmsWebhookEvent;
  getProvider?: (orgId: string) => Promise<SmsProvider>;
}): Promise<{
  ok: boolean;
  status: number;
  error?: string;
  conversationId?: string;
  optedOut?: boolean;
  unmatched?: boolean;
  surveySessionId?: string;
  relayId?: string;
  leg?: string;
}> {
  const { admin, orgId, event } = args;
  const getProvider =
    args.getProvider ??
    ((id: string) => getSmsProviderForOrg(id, providerAccountLookup(admin)));

  if (event.type === "status") {
    if (!event.providerMessageId) return { ok: true, status: 200 };

    const { data: sendLog } = await admin
      .from("sms_send_log")
      .select("id")
      .eq("organisation_id", orgId)
      .eq("provider_message_id", event.providerMessageId)
      .maybeSingle();

    const { error: eventError } = await admin.from("sms_delivery_events").insert({
      organisation_id: orgId,
      send_log_id: sendLog?.id ?? null,
      provider_message_id: event.providerMessageId,
      status: event.status,
      occurred_at: event.occurredAt,
    });
    if (eventError) {
      console.error("sms_delivery_events insert failed", eventError);
      return { ok: false, status: 500, error: eventError.message };
    }

    const nextStatus = terminalDeliveryStatus(event.status);
    if (nextStatus) {
      const occurredAt = event.occurredAt ?? new Date().toISOString();
      const patch =
        nextStatus === "delivered"
          ? { status: "delivered" }
          : { status: "failed", failed_at: occurredAt };

      if (sendLog?.id) {
        await admin
          .from("sms_send_log")
          .update(patch)
          .eq("id", sendLog.id)
          .eq("organisation_id", orgId)
          .eq("status", "sent");
      }

      await admin
        .from("sms_messages")
        .update({ status: nextStatus })
        .eq("organisation_id", orgId)
        .eq("provider_message_id", event.providerMessageId)
        .eq("status", "sent");

      await admin
        .from("sms_relay_messages")
        .update({
          forward_status: nextStatus === "delivered" ? "delivered" : "failed",
        })
        .eq("organisation_id", orgId)
        .eq("forward_provider_message_id", event.providerMessageId)
        .eq("forward_status", "sent");
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

  const ourNumberId =
    routed.decision.action === "create"
      ? routed.decision.conversation.our_number_id
      : routed.number?.id ?? null;
  const memberPhone =
    routed.decision.action === "create"
      ? routed.decision.conversation.phone_e164
      : phoneE164;

  const stop = isStopEvent(event);
  const liveSession =
    memberPhone && !stop
      ? await findLiveSessionByPhone(admin, orgId, memberPhone)
      : null;
  const liveRelay =
    ourNumberId && !stop
      ? await findLiveRelayByNumberId(admin, orgId, ourNumberId)
      : null;

  const leg = decideInboundLeg({
    isStop: stop,
    hasLiveSurvey: Boolean(liveSession),
    hasLiveRelay: Boolean(liveRelay),
  });

  if (leg === "stop") {
    if (memberPhone) {
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
      await terminateSessionsForPhone(
        admin,
        orgId,
        memberPhone,
        event.type === "unsubscribe"
          ? (event.receivedAt ?? new Date().toISOString())
          : (inbound as { receivedAt?: string }).receivedAt ?? new Date().toISOString(),
      );
    }

    if (!ourNumberId || !memberPhone) {
      return { ok: true, status: 200, optedOut: true, unmatched: !ourNumberId, leg };
    }

    const contactId = await ensureContact(admin, orgId, memberPhone, true);
    const conversationId = await upsertConversation(admin, {
      orgId,
      ourNumberId,
      phoneE164: memberPhone,
      contactId,
    });
    const receivedAt = new Date().toISOString();
    const appended = await appendInboundMessage(admin, {
      orgId,
      conversationId,
      body: inbound.body || "STOP",
      phoneE164: memberPhone,
      providerMessageId: inbound.providerMessageId,
      createdAt: receivedAt,
    });
    if (appended) {
      await bumpConversationUnread(admin, conversationId, receivedAt);
    }
    return { ok: true, status: 200, conversationId, optedOut: true, leg };
  }

  if (leg === "survey" && liveSession && memberPhone) {
    const provider = await getProvider(orgId);
    const receivedAt =
      event.type === "inbound"
        ? (event.receivedAt ?? new Date().toISOString())
        : new Date().toISOString();
    const surveyResult = await processSurveyInbound(admin, provider, {
      session: liveSession,
      phoneE164: memberPhone,
      body: inbound.body,
      providerMessageId: inbound.providerMessageId,
      receivedAt,
    });
    if (surveyResult.handled) {
      return {
        ok: true,
        status: 200,
        surveySessionId: liveSession.id,
        conversationId: liveSession.conversation_id ?? undefined,
        leg,
      };
    }
  }

  if (liveRelay && ourNumberId) {
    const provider = await getProvider(orgId);
    const orgName = await loadOrgName(admin, orgId);
    const receivedAt =
      event.type === "inbound"
        ? (event.receivedAt ?? new Date().toISOString())
        : new Date().toISOString();
    const numberRow = routed.number!;
    await processRelayInbound(admin, provider, {
      relay: liveRelay,
      number: { id: numberRow.id, phone_e164: numberRow.phone_e164 },
      event: {
        from: inbound.from,
        body: inbound.body,
        providerMessageId: inbound.providerMessageId,
      },
      phoneE164: memberPhone,
      orgName,
      receivedAt,
    });
    return {
      ok: true,
      status: 200,
      relayId: liveRelay.id,
      leg: "relay",
    };
  }

  if (routed.decision.action === "none" || !ourNumberId || !memberPhone) {
    return {
      ok: true,
      status: 200,
      unmatched: true,
      error:
        routed.decision.action === "none" && routed.decision.reason === "no_number"
          ? "Inbound to-number is not registered to this organisation"
          : "Could not normalise sender phone",
      leg: "inbox",
    };
  }

  const contactId = await ensureContact(admin, orgId, memberPhone, false);
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
      return { ok: true, status: 200, conversationId, optedOut: false, leg: "inbox" };
    }
  }

  const receivedAt = new Date().toISOString();
  const appended = await appendInboundMessage(admin, {
    orgId,
    conversationId,
    body: inbound.body,
    phoneE164: memberPhone,
    providerMessageId: inbound.providerMessageId,
    createdAt: receivedAt,
  });
  if (appended) {
    await bumpConversationUnread(admin, conversationId, receivedAt);
  }

  return { ok: true, status: 200, conversationId, optedOut: false, leg: "inbox" };
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
