"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { smsWebhookUrl } from "@/lib/app-url";
import {
  encryptMobileMessageCredentials,
  encryptSecret,
} from "@/lib/sms/credentials";
import {
  getSmsProviderForOrg,
  isMockSmsProvider,
  MobileMessageProvider,
} from "@/lib/sms/provider";
import { toE164 } from "@/lib/phone/normalise-phone";
import { inboxUnsafePurposeError } from "@/lib/sms/sender-purpose";
import { providerAccountLookup } from "@/lib/sms/provider-lookup";
import type { SenderId } from "@/lib/sms/provider/types";

export async function saveProviderCredentials(formData: FormData): Promise<{
  error?: string;
  balance?: number;
  senders?: SenderId[];
}> {
  const { org } = await requireOrgMember();
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const webhookSecret = String(formData.get("webhookSecret") ?? "").trim();

  if (!username || !password) {
    return { error: "API username and password are required" };
  }

  let senders: SenderId[] = [];
  let balance = 0;

  if (isMockSmsProvider()) {
    const mock = await getSmsProviderForOrg(org.id);
    senders = await mock.listSenders();
    balance = await mock.getCreditBalance();
  } else {
    const provider = new MobileMessageProvider({
      username,
      password,
      webhookSecret: webhookSecret || undefined,
    });
    try {
      [senders, balance] = await Promise.all([
        provider.listSenders(),
        provider.getCreditBalance(),
      ]);
    } catch (err) {
      return {
        error:
          err instanceof Error
            ? `Could not verify Mobile Message credentials: ${err.message}`
            : "Could not verify Mobile Message credentials",
      };
    }
  }

  const admin = createAdminClient();
  const credentialsCiphertext = encryptMobileMessageCredentials({
    username,
    password,
  });

  const { data: existing } = await admin
    .from("provider_accounts")
    .select("id, webhook_secret_ciphertext")
    .eq("organisation_id", org.id)
    .maybeSingle();

  const webhookCiphertext = webhookSecret
    ? encryptSecret(webhookSecret)
    : existing?.webhook_secret_ciphertext ?? null;

  const row = {
    organisation_id: org.id,
    provider: "mobile_message",
    mode: "byo",
    credentials_ciphertext: credentialsCiphertext,
    webhook_secret_ciphertext: webhookCiphertext,
    last_verified_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { error } = await admin
      .from("provider_accounts")
      .update(row)
      .eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await admin.from("provider_accounts").insert(row);
    if (error) return { error: error.message };
  }

  revalidatePath("/settings");
  return { senders, balance };
}

export async function attachNumber(formData: FormData): Promise<{ error?: string }> {
  const { org, supabase } = await requireOrgMember();
  const raw = String(formData.get("phone") ?? "");
  const label = String(formData.get("label") ?? "").trim() || null;
  const purpose = String(formData.get("purpose") ?? "inbox");
  const phone = toE164(raw);
  if (!phone) {
    return { error: "Enter an Australian mobile in local or E.164 form" };
  }
  if (!["inbox", "survey", "relay", "spare"].includes(purpose)) {
    return { error: "Invalid number purpose" };
  }

  const admin = createAdminClient();
  const { data: account } = await admin
    .from("provider_accounts")
    .select("id")
    .eq("organisation_id", org.id)
    .maybeSingle();
  if (!account) {
    return { error: "Save Mobile Message credentials first" };
  }

  const { error } = await supabase.from("sms_numbers").insert({
    organisation_id: org.id,
    provider_account_id: account.id,
    phone_e164: phone,
    purpose,
    status: "active",
    label,
  });
  if (error) {
    if (error.code === "23505") {
      return { error: "That number is already registered" };
    }
    return { error: error.message };
  }
  revalidatePath("/settings");
  revalidatePath("/inbox");
  return {};
}

export async function updateNumberPurpose(formData: FormData): Promise<{ error?: string }> {
  const { org, supabase } = await requireOrgMember();
  const numberId = String(formData.get("numberId") ?? "");
  const purpose = String(formData.get("purpose") ?? "");
  if (!numberId) return { error: "Missing number" };
  if (!["inbox", "survey", "relay", "spare"].includes(purpose)) {
    return { error: "Invalid number purpose" };
  }

  const { data: current } = await supabase
    .from("sms_numbers")
    .select("id, purpose")
    .eq("id", numberId)
    .eq("organisation_id", org.id)
    .maybeSingle();
  if (!current) return { error: "Unknown number" };

  if (current.purpose === "relay" && purpose !== "relay") {
    await supabase
      .from("sms_relays")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("number_id", numberId)
      .eq("organisation_id", org.id)
      .in("status", ["active", "paused"]);
  }

  const { error } = await supabase
    .from("sms_numbers")
    .update({ purpose })
    .eq("id", numberId)
    .eq("organisation_id", org.id);
  if (error) return { error: error.message };
  revalidatePath("/settings");
  revalidatePath("/p2p");
  revalidatePath("/surveys");
  revalidatePath("/relays");
  revalidatePath("/blasts");
  return {};
}

export async function sendTestSms(formData: FormData): Promise<{
  error?: string;
  conversationId?: string;
}> {
  const { org, user, supabase } = await requireOrgMember();
  const numberId = String(formData.get("numberId") ?? "");
  const toRaw = String(formData.get("to") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const to = toE164(toRaw);
  if (!numberId) return { error: "Pick a dedicated number to send from" };
  if (!to) return { error: "Enter a valid Australian mobile to send to" };
  if (!body) return { error: "Message body is required" };

  const { data: number, error: numberError } = await supabase
    .from("sms_numbers")
    .select("id, phone_e164, purpose, status")
    .eq("id", numberId)
    .eq("organisation_id", org.id)
    .maybeSingle();
  if (numberError) return { error: numberError.message };
  if (!number || number.status !== "active") {
    return { error: "Unknown or retired number" };
  }
  const purposeBlock = inboxUnsafePurposeError(number.purpose);
  if (purposeBlock) return { error: purposeBlock };

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, sms_opt_out")
    .eq("organisation_id", org.id)
    .eq("phone_e164", to)
    .maybeSingle();
  if (contact?.sms_opt_out) {
    return { error: "This number has opted out of SMS for your organisation" };
  }

  const admin = createAdminClient();
  let provider;
  try {
    provider = await getSmsProviderForOrg(org.id, providerAccountLookup(admin));
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "SMS provider is not configured",
    };
  }

  const results = await provider.sendBatch(
    [{ to, body, sender: number.phone_e164, customRef: `test-${org.id}` }],
    { idempotencyKey: `test:${org.id}:${to}:${Date.now()}` },
  );
  const result = results[0];
  if (!result || result.status !== "success") {
    return { error: result?.error || "Send failed" };
  }

  let contactId = contact?.id as string | undefined;
  if (!contactId) {
    const { data: created, error: contactError } = await supabase
      .from("contacts")
      .insert({
        organisation_id: org.id,
        phone_e164: to,
      })
      .select("id")
      .single();
    if (contactError && contactError.code !== "23505") {
      return { error: contactError.message };
    }
    contactId = created?.id;
    if (!contactId) {
      const { data: raced } = await supabase
        .from("contacts")
        .select("id")
        .eq("organisation_id", org.id)
        .eq("phone_e164", to)
        .maybeSingle();
      contactId = raced?.id;
    }
  }

  const now = new Date().toISOString();
  const { data: existingConv } = await supabase
    .from("sms_conversations")
    .select("id")
    .eq("organisation_id", org.id)
    .eq("our_number_id", number.id)
    .eq("phone_e164", to)
    .maybeSingle();

  let conversationId = existingConv?.id as string | undefined;
  if (!conversationId) {
    const { data: created, error: convError } = await supabase
      .from("sms_conversations")
      .insert({
        organisation_id: org.id,
        our_number_id: number.id,
        contact_id: contactId ?? null,
        phone_e164: to,
        state: "open",
        last_message_at: now,
        last_outbound_at: now,
      })
      .select("id")
      .single();
    if (convError) return { error: convError.message };
    conversationId = created.id;
  } else {
    await supabase
      .from("sms_conversations")
      .update({
        last_message_at: now,
        last_outbound_at: now,
        contact_id: contactId ?? null,
      })
      .eq("id", conversationId);
  }

  const { error: msgError } = await supabase.from("sms_messages").insert({
    organisation_id: org.id,
    conversation_id: conversationId,
    direction: "outbound",
    body,
    phone_e164: to,
    sender_user_id: user.id,
    provider_message_id: result.providerMessageId,
    status: result.status,
  });
  if (msgError) return { error: msgError.message };

  revalidatePath("/inbox");
  revalidatePath(`/inbox/${conversationId}`);
  return { conversationId };
}

export async function loadSettingsPayload() {
  const { org, supabase } = await requireOrgMember();
  const admin = createAdminClient();
  const [{ data: account }, { data: numbers }] = await Promise.all([
    admin
      .from("provider_accounts")
      .select("id, last_verified_at, webhook_secret_ciphertext")
      .eq("organisation_id", org.id)
      .maybeSingle(),
    supabase
      .from("sms_numbers")
      .select("id, phone_e164, purpose, status, label, created_at")
      .eq("organisation_id", org.id)
      .order("created_at", { ascending: true }),
  ]);

  return {
    org,
    webhookUrl: smsWebhookUrl(org.public_id),
    connected: Boolean(account),
    hasWebhookSecret: Boolean(account?.webhook_secret_ciphertext),
    lastVerifiedAt: account?.last_verified_at ?? null,
    mockProvider: isMockSmsProvider(),
    numbers: numbers ?? [],
  };
}
