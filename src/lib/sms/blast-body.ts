import { resolveScriptVariables, TEMPLATE_TOKEN_RE } from "@/lib/comms/template-variables";

export function resolveBlastBody(
  template: string,
  context: Record<string, string | undefined>,
): string {
  return resolveScriptVariables(template, context)
    .replace(TEMPLATE_TOKEN_RE, "")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();
}

export type ScreenedRecipient =
  | { ok: true; to: string }
  | { ok: false; status: "opted_out" | "skipped"; reason: string };

export function screenBlastRecipient(contact: {
  sms_opt_out: boolean;
  phone_e164: string | null | undefined;
}): ScreenedRecipient {
  const to = contact.phone_e164?.trim() || null;
  if (contact.sms_opt_out) {
    return { ok: false, status: "opted_out", reason: "Contact has opted out of SMS" };
  }
  if (!to) {
    return { ok: false, status: "skipped", reason: "No mobile number on file" };
  }
  return { ok: true, to };
}

export function blackoutOverrideError(
  override: boolean,
  reason: string | null | undefined,
): string | null {
  if (!override) return null;
  if (!reason || reason.trim().length < 8) {
    return "Blackout override needs a reason of at least 8 characters";
  }
  return null;
}
