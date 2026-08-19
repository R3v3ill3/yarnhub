/**
 * Whether a Mobile Message sender can receive replies into Yarnhub.
 *
 * Dedicated / shared numbers hit the inbound webhook. Own-mobile
 * ("handset") senders deliver replies to the SIM. Alphanumeric IDs
 * are one-way.
 */

import { toE164 } from "@/lib/phone/normalise-phone";
import type { SenderId } from "@/lib/sms/provider/types";

export type SenderInboundKind = "inbound" | "handset" | "one_way" | "unknown";

export const HANDSET_SENDER_MESSAGE =
  "This is a personal handset (own mobile), not a dedicated Mobile Message number. Replies go to the physical phone, not Yarnhub. Pick a dedicated number in Settings.";

export const ONE_WAY_SENDER_MESSAGE =
  "This sender cannot receive replies. Chat and surveys need a dedicated Mobile Message number.";

export const NOT_DEDICATED_SENDER_MESSAGE =
  "This number is not a dedicated Mobile Message number. Replies will go to the handset, not Yarnhub. Register a dedicated number in Settings.";

export const SENDER_TYPE_UNVERIFIED_MESSAGE =
  "Could not verify this number with Mobile Message. Chat and surveys need a dedicated MM number (not a personal handset).";

export function senderMatchKey(raw: string | null | undefined): string {
  if (raw == null) return "";
  const e164 = toE164(raw);
  if (e164) return e164.replace(/\D/g, "");
  return String(raw).replace(/\D/g, "");
}

export function classifyProviderSenderType(
  type: string | null | undefined,
  sender: string,
): SenderInboundKind {
  const t = (type ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (
    t === "own" ||
    t.startsWith("own_") ||
    t === "personal" ||
    t === "handset" ||
    t === "verified_mobile"
  ) {
    return "handset";
  }

  if (
    t === "alpha" ||
    t === "alphanumeric" ||
    t === "sender_id" ||
    t === "custom" ||
    t === "custom_sender" ||
    t.startsWith("alpha")
  ) {
    return "one_way";
  }

  if (
    t === "dedicated" ||
    t === "dedicated_number" ||
    t === "shared" ||
    t === "shared_number" ||
    t.startsWith("dedicated") ||
    t.startsWith("shared")
  ) {
    return "inbound";
  }

  const digits = senderMatchKey(sender);
  if (digits.length < 8) return "one_way";
  if (!t) return "inbound";
  return "unknown";
}

export function matchProviderSender(
  phoneE164: string,
  senders: SenderId[],
): SenderId | undefined {
  const key = senderMatchKey(phoneE164);
  if (key) {
    const byDigits = senders.find((s) => senderMatchKey(s.sender) === key);
    if (byDigits) return byDigits;
  }
  const raw = phoneE164.trim().toLowerCase();
  if (!raw) return undefined;
  return senders.find((s) => s.sender.trim().toLowerCase() === raw);
}

export function inboundCheckForPhone(
  phoneE164: string,
  senders: SenderId[],
): string | null {
  if (senders.length === 0) return SENDER_TYPE_UNVERIFIED_MESSAGE;
  const match = matchProviderSender(phoneE164, senders);
  if (!match) return NOT_DEDICATED_SENDER_MESSAGE;
  const kind = classifyProviderSenderType(match.type, match.sender);
  if (kind === "inbound") return null;
  if (kind === "handset") return HANDSET_SENDER_MESSAGE;
  if (kind === "one_way") return ONE_WAY_SENDER_MESSAGE;
  return NOT_DEDICATED_SENDER_MESSAGE;
}
