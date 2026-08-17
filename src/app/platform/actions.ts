"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/require-org-member";
import { isPlatformAdminEmail } from "@/lib/auth/roles";
import { toE164 } from "@/lib/phone/normalise-phone";
import {
  encryptMobileMessageCredentials,
  encryptSecret,
} from "@/lib/sms/credentials";
import { creditLedgerInsert } from "@/lib/sms/credits";
import { isMockSmsProvider, MobileMessageProvider } from "@/lib/sms/provider";

async function requirePlatform() {
  const { user } = await requireUser();
  if (!isPlatformAdminEmail(user.email)) notFound();
  return { user, admin: createAdminClient() };
}

export async function savePlatformCredentials(formData: FormData): Promise<{
  error?: string;
  balance?: number;
}> {
  const { admin } = await requirePlatform();
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const webhookSecret = String(formData.get("webhookSecret") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || "hosted";
  if (!username || !password) return { error: "API username and password are required" };

  let balance = 0;
  if (!isMockSmsProvider()) {
    const provider = new MobileMessageProvider({
      username,
      password,
      webhookSecret: webhookSecret || undefined,
    });
    try {
      balance = await provider.getCreditBalance();
    } catch (err) {
      return {
        error:
          err instanceof Error
            ? `Could not verify Mobile Message credentials: ${err.message}`
            : "Could not verify Mobile Message credentials",
      };
    }
  }

  const credentialsCiphertext = encryptMobileMessageCredentials({ username, password });
  const { data: existing } = await admin
    .from("platform_sms_accounts")
    .select("id, webhook_secret_ciphertext")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const webhookCiphertext = webhookSecret
    ? encryptSecret(webhookSecret)
    : existing?.webhook_secret_ciphertext ?? null;

  const row = {
    label,
    credentials_ciphertext: credentialsCiphertext,
    webhook_secret_ciphertext: webhookCiphertext,
  };
  if (existing?.id) {
    const { error } = await admin.from("platform_sms_accounts").update(row).eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await admin.from("platform_sms_accounts").insert(row);
    if (error) return { error: error.message };
  }

  revalidatePath("/platform");
  return { balance };
}

export async function addPoolNumber(formData: FormData): Promise<{ error?: string }> {
  const { admin } = await requirePlatform();
  const phone = toE164(String(formData.get("phone") ?? ""));
  const label = String(formData.get("label") ?? "").trim() || null;
  if (!phone) return { error: "Enter a valid Australian mobile" };

  const { data: platform } = await admin
    .from("platform_sms_accounts")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!platform) return { error: "Save platform Mobile Message credentials first" };

  const { error } = await admin.from("hosted_number_pool").insert({
    platform_account_id: platform.id,
    phone_e164: phone,
    label,
    status: "available",
  });
  if (error) {
    if (error.code === "23505") return { error: "That number is already in the pool" };
    return { error: error.message };
  }
  revalidatePath("/platform");
  return {};
}

export async function assignPoolNumber(formData: FormData): Promise<{ error?: string }> {
  const { user, admin } = await requirePlatform();
  const poolId = String(formData.get("poolId") ?? "");
  const orgId = String(formData.get("organisationId") ?? "");
  const purpose = String(formData.get("purpose") ?? "inbox");
  if (!poolId || !orgId) return { error: "Pick a number and organisation" };
  if (!["inbox", "survey", "relay", "spare"].includes(purpose)) {
    return { error: "Invalid number purpose" };
  }

  const { data: org } = await admin
    .from("organisations")
    .select("id, kyc_status, sending_suspended")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) return { error: "Unknown organisation" };
  if (org.kyc_status !== "approved") return { error: "Approve KYC before assigning a hosted number" };

  const { data: pool } = await admin
    .from("hosted_number_pool")
    .select("id, phone_e164, status, platform_account_id")
    .eq("id", poolId)
    .maybeSingle();
  if (!pool || pool.status !== "available") return { error: "Number is not available" };

  const { data: existingAccount } = await admin
    .from("provider_accounts")
    .select("id, mode")
    .eq("organisation_id", orgId)
    .maybeSingle();
  if (existingAccount?.mode === "byo") {
    return { error: "This organisation is on BYO credentials; do not mix hosted numbers onto it" };
  }

  let accountId = existingAccount?.id as string | undefined;
  if (!accountId) {
    const { data: created, error } = await admin
      .from("provider_accounts")
      .insert({
        organisation_id: orgId,
        provider: "mobile_message",
        mode: "hosted",
        credentials_ciphertext: null,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };
    accountId = created.id;
  } else if (existingAccount?.mode !== "hosted") {
    const { error } = await admin
      .from("provider_accounts")
      .update({ mode: "hosted" })
      .eq("id", accountId);
    if (error) return { error: error.message };
  }

  const { data: number, error: numberError } = await admin
    .from("sms_numbers")
    .insert({
      organisation_id: orgId,
      provider_account_id: accountId,
      phone_e164: pool.phone_e164,
      purpose,
      status: "active",
      label: "Hosted",
    })
    .select("id")
    .single();
  if (numberError) {
    if (numberError.code === "23505") return { error: "That number is already registered" };
    return { error: numberError.message };
  }

  const { error: poolError } = await admin
    .from("hosted_number_pool")
    .update({
      status: "assigned",
      assigned_organisation_id: orgId,
      assigned_sms_number_id: number.id,
      assigned_at: new Date().toISOString(),
    })
    .eq("id", poolId)
    .eq("status", "available");
  if (poolError) return { error: poolError.message };

  await writeAudit(admin, {
    organisationId: orgId,
    actorUserId: user.id,
    action: "hosted_number_assigned",
    payload: { phone: pool.phone_e164, purpose },
  });
  revalidatePath("/platform");
  return {};
}

export async function grantCredits(formData: FormData): Promise<{ error?: string }> {
  const { user, admin } = await requirePlatform();
  const orgId = String(formData.get("organisationId") ?? "");
  const delta = Number(formData.get("credits") ?? 0);
  if (!orgId) return { error: "Pick an organisation" };
  if (!Number.isFinite(delta) || delta === 0) return { error: "Enter a non-zero credit amount" };

  const result = await creditLedgerInsert(admin, {
    orgId,
    delta: Math.trunc(delta),
    reason: "platform_grant",
    createdBy: user.id,
  });
  if (result.error) return { error: result.error };

  await writeAudit(admin, {
    organisationId: orgId,
    actorUserId: user.id,
    action: "credits_granted",
    payload: { delta: Math.trunc(delta) },
  });
  revalidatePath("/platform");
  return {};
}

export async function setOrgKycStatus(formData: FormData): Promise<{ error?: string }> {
  const { user, admin } = await requirePlatform();
  const orgId = String(formData.get("organisationId") ?? "");
  const status = String(formData.get("kyc_status") ?? "");
  if (!orgId) return { error: "Missing organisation" };
  if (!["none", "pending", "approved", "rejected"].includes(status)) {
    return { error: "Invalid KYC status" };
  }
  const { error } = await admin.from("organisations").update({ kyc_status: status }).eq("id", orgId);
  if (error) return { error: error.message };
  await writeAudit(admin, {
    organisationId: orgId,
    actorUserId: user.id,
    action: "kyc_status_updated",
    payload: { status },
  });
  revalidatePath("/platform");
  return {};
}

export async function setSendingSuspended(formData: FormData): Promise<{ error?: string }> {
  const { user, admin } = await requirePlatform();
  const orgId = String(formData.get("organisationId") ?? "");
  const suspended = String(formData.get("suspended") ?? "") === "true";
  if (!orgId) return { error: "Missing organisation" };
  const { error } = await admin
    .from("organisations")
    .update({ sending_suspended: suspended })
    .eq("id", orgId);
  if (error) return { error: error.message };
  await writeAudit(admin, {
    organisationId: orgId,
    actorUserId: user.id,
    action: suspended ? "sending_suspended" : "sending_unsuspended",
  });
  revalidatePath("/platform");
  return {};
}
