import { findNumberForInbound, type RoutingNumber } from "@/lib/sms/conversation-routing";

/** Hosted inbound: dispatch on payload `to`, not `?org=`. */
export function resolveOrgIdFromToNumber(
  numbers: RoutingNumber[],
  to: string | null | undefined,
): string | null {
  return findNumberForInbound(numbers, to)?.organisation_id ?? null;
}

export function hostedWebhookMissingOrgDecision(args: {
  hasPlatformSecret: boolean;
  hmacOk: boolean;
}): "ok" | "unauthorized" | "unconfigured" {
  if (!args.hasPlatformSecret) return "unconfigured";
  return args.hmacOk ? "ok" : "unauthorized";
}

/** Status callbacks often omit `to`; resolve tenant from our send records. */
export function resolveOrgIdFromDeliveryLookup(args: {
  providerMessageId: string | null | undefined;
  sendLogOrgId: string | null;
  messageOrgId: string | null;
}): string | null {
  if (!args.providerMessageId) return null;
  return args.sendLogOrgId ?? args.messageOrgId ?? null;
}
