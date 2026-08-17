import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoutingNumber } from "@/lib/sms/conversation-routing";
import type { SmsWebhookEvent } from "@/lib/sms/provider/types";
import {
  resolveOrgIdFromDeliveryLookup,
  resolveOrgIdFromToNumber,
} from "@/lib/sms/hosted-routing";

export async function resolveHostedEventOrgId(
  admin: SupabaseClient,
  event: SmsWebhookEvent,
): Promise<string | null> {
  if (event.type === "status") {
    if (!event.providerMessageId) return null;
    const [{ data: sendLog }, { data: message }] = await Promise.all([
      admin
        .from("sms_send_log")
        .select("organisation_id")
        .eq("provider_message_id", event.providerMessageId)
        .limit(1)
        .maybeSingle(),
      admin
        .from("sms_messages")
        .select("organisation_id")
        .eq("provider_message_id", event.providerMessageId)
        .limit(1)
        .maybeSingle(),
    ]);
    return resolveOrgIdFromDeliveryLookup({
      providerMessageId: event.providerMessageId,
      sendLogOrgId: (sendLog?.organisation_id as string | undefined) ?? null,
      messageOrgId: (message?.organisation_id as string | undefined) ?? null,
    });
  }

  if (event.type === "inbound" || event.type === "unsubscribe") {
    const { data: numberRows, error } = await admin
      .from("sms_numbers")
      .select("id, organisation_id, phone_e164")
      .eq("status", "active");
    if (error) throw error;
    return resolveOrgIdFromToNumber((numberRows ?? []) as RoutingNumber[], event.to);
  }

  return null;
}
