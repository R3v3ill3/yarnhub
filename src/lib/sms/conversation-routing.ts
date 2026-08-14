/**
 * Pure inbound-conversation routing for Yarnhub.
 *
 * Thread uniqueness is `(organisation_id, our_number_id, phone_e164)`.
 * The webhook gathers candidate rows and applies the returned decision.
 *
 * Kept pure (no I/O) so the precedence is unit-testable.
 */

/**
 * Significant AU mobile digits (last 9, after stripping 0/61 prefixes).
 */
function significantDigits(raw: string): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  let rest = digits;
  if (rest.startsWith("61")) rest = rest.slice(2);
  if (rest.startsWith("0")) rest = rest.slice(1);
  return rest.length === 9 ? rest : null;
}

/**
 * Tolerant match of a webhook `to` value against the number registry
 * (providers variously send `+614…`, `614…` or `04…`).
 */
export function findNumberForInbound<T extends { phone_e164: string }>(
  numbers: T[],
  to: string | null | undefined,
): T | null {
  if (!to) return null;
  const target = significantDigits(to);
  if (!target) {
    // Non-AU-mobile shapes (e.g. shared shortcodes): exact digit match only.
    const rawDigits = to.replace(/\D/g, "");
    if (!rawDigits) return null;
    return (
      numbers.find((n) => n.phone_e164.replace(/\D/g, "") === rawDigits) ?? null
    );
  }
  return (
    numbers.find((n) => significantDigits(n.phone_e164) === target) ?? null
  );
}

export interface RoutingNumber {
  id: string;
  organisation_id: string;
  phone_e164: string;
}

export interface RoutingInput {
  /** Normalised member phone (E.164) — null when unparseable. */
  phoneE164: string | null;
  /** Our number the message arrived on — null when no registry match. */
  number: RoutingNumber | null;
  /** Existing thread on the (org, number, phone) unique key. */
  existingConversationId: string | null;
}

export type RoutingDecision =
  | { action: "none"; reason: "no_number" | "no_phone" }
  | { action: "attach"; conversationId: string }
  | {
      action: "create";
      conversation: {
        our_number_id: string;
        phone_e164: string;
      };
    };

export function resolveInboundConversation(
  input: RoutingInput,
): RoutingDecision {
  const { phoneE164, number, existingConversationId } = input;

  if (!number) return { action: "none", reason: "no_number" };
  if (!phoneE164) return { action: "none", reason: "no_phone" };

  if (existingConversationId) {
    return { action: "attach", conversationId: existingConversationId };
  }

  return {
    action: "create",
    conversation: {
      our_number_id: number.id,
      phone_e164: phoneE164,
    },
  };
}
