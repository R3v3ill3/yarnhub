"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { appUrl } from "@/lib/app-url";
import { destructiveRoleError } from "@/lib/auth/roles";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import {
  createStripeCheckoutSession,
  creditPackAmountCents,
  creditPackSize,
  stripeConfigured,
} from "@/lib/billing/stripe";
import { ORG_TIMEZONES } from "@/lib/org/timezones";
import { isValidTimeZone } from "@/lib/sms/blackout";

function revalidateTeam() {
  revalidatePath("/team");
  revalidatePath("/settings");
}

export async function inviteMember(formData: FormData): Promise<{
  error?: string;
  inviteUrl?: string;
}> {
  const { org, user, supabase, role } = await requireOrgMember();
  const blocked = destructiveRoleError(role);
  if (blocked) return { error: blocked };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const inviteRole = String(formData.get("role") ?? "member") === "admin" ? "admin" : "member";
  if (!email.includes("@")) return { error: "Enter a valid email" };

  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from("organisation_invites").insert({
    organisation_id: org.id,
    email,
    role: inviteRole,
    token,
    created_by: user.id,
    expires_at: expiresAt,
  });
  if (error) return { error: error.message };

  await writeAudit(createAdminClient(), {
    organisationId: org.id,
    actorUserId: user.id,
    action: "member_invited",
    payload: { email, role: inviteRole },
  });
  revalidateTeam();
  return { inviteUrl: `${appUrl()}/join/${token}` };
}

export async function revokeInvite(formData: FormData): Promise<{ error?: string }> {
  const { org, user, supabase, role } = await requireOrgMember();
  const blocked = destructiveRoleError(role);
  if (blocked) return { error: blocked };
  const inviteId = String(formData.get("inviteId") ?? "");
  if (!inviteId) return { error: "Missing invite" };

  const { error } = await supabase
    .from("organisation_invites")
    .delete()
    .eq("id", inviteId)
    .eq("organisation_id", org.id)
    .is("accepted_at", null);
  if (error) return { error: error.message };

  await writeAudit(createAdminClient(), {
    organisationId: org.id,
    actorUserId: user.id,
    action: "invite_revoked",
    payload: { inviteId },
  });
  revalidateTeam();
  return {};
}

export async function updateMemberRole(formData: FormData): Promise<{ error?: string }> {
  const { org, user, supabase, role } = await requireOrgMember();
  const blocked = destructiveRoleError(role);
  if (blocked) return { error: blocked };
  const memberUserId = String(formData.get("userId") ?? "");
  const nextRole = String(formData.get("role") ?? "");
  if (!memberUserId) return { error: "Missing member" };
  if (!["owner", "admin", "member"].includes(nextRole)) return { error: "Invalid role" };
  if (nextRole === "owner" && role !== "owner") {
    return { error: "Only an owner can grant owner" };
  }

  const { data: members } = await supabase
    .from("organisation_members")
    .select("user_id, role")
    .eq("organisation_id", org.id);
  const target = (members ?? []).find((m) => m.user_id === memberUserId);
  if (!target) return { error: "Member not found" };
  const owners = (members ?? []).filter((m) => m.role === "owner");
  if (target.role === "owner" && nextRole !== "owner" && owners.length < 2) {
    return { error: "Keep at least one owner" };
  }

  const { error } = await supabase
    .from("organisation_members")
    .update({ role: nextRole })
    .eq("organisation_id", org.id)
    .eq("user_id", memberUserId);
  if (error) return { error: error.message };

  await writeAudit(createAdminClient(), {
    organisationId: org.id,
    actorUserId: user.id,
    action: "member_role_updated",
    payload: { userId: memberUserId, from: target.role, to: nextRole },
  });
  revalidateTeam();
  return {};
}

export async function removeMember(formData: FormData): Promise<{ error?: string }> {
  const { org, user, supabase, role } = await requireOrgMember();
  const blocked = destructiveRoleError(role);
  if (blocked) return { error: blocked };
  const memberUserId = String(formData.get("userId") ?? "");
  if (!memberUserId) return { error: "Missing member" };
  if (memberUserId === user.id) return { error: "You cannot remove yourself" };

  const { data: target } = await supabase
    .from("organisation_members")
    .select("user_id, role")
    .eq("organisation_id", org.id)
    .eq("user_id", memberUserId)
    .maybeSingle();
  if (!target) return { error: "Member not found" };
  if (target.role === "owner" && role !== "owner") {
    return { error: "Only an owner can remove an owner" };
  }

  const { count } = await supabase
    .from("organisation_members")
    .select("user_id", { count: "exact", head: true })
    .eq("organisation_id", org.id)
    .eq("role", "owner");
  if (target.role === "owner" && (count ?? 0) < 2) {
    return { error: "Keep at least one owner" };
  }

  const { error } = await supabase
    .from("organisation_members")
    .delete()
    .eq("organisation_id", org.id)
    .eq("user_id", memberUserId);
  if (error) return { error: error.message };

  await writeAudit(createAdminClient(), {
    organisationId: org.id,
    actorUserId: user.id,
    action: "member_removed",
    payload: { userId: memberUserId },
  });
  revalidateTeam();
  return {};
}

export async function updateOrgTimezone(formData: FormData): Promise<{ error?: string }> {
  const { org, user, supabase, role } = await requireOrgMember();
  const blocked = destructiveRoleError(role);
  if (blocked) return { error: blocked };
  const timezone = String(formData.get("timezone") ?? "").trim();
  if (!ORG_TIMEZONES.includes(timezone as (typeof ORG_TIMEZONES)[number]) && !isValidTimeZone(timezone)) {
    return { error: "Pick a valid timezone" };
  }
  if (!isValidTimeZone(timezone)) return { error: "Pick a valid timezone" };

  const { error } = await supabase
    .from("organisations")
    .update({ timezone })
    .eq("id", org.id);
  if (error) return { error: error.message };

  await writeAudit(createAdminClient(), {
    organisationId: org.id,
    actorUserId: user.id,
    action: "org_timezone_updated",
    payload: { timezone },
  });
  revalidateTeam();
  return {};
}

export async function saveCannedReply(formData: FormData): Promise<{ error?: string }> {
  const { org, user, supabase } = await requireOrgMember();
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!title || !body) return { error: "Title and body are required" };

  const { error } = await supabase.from("sms_canned_replies").insert({
    organisation_id: org.id,
    title,
    body,
    created_by: user.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/team");
  revalidatePath("/inbox");
  return {};
}

export async function deleteCannedReply(formData: FormData): Promise<{ error?: string }> {
  const { org, supabase } = await requireOrgMember();
  const replyId = String(formData.get("replyId") ?? "");
  if (!replyId) return { error: "Missing reply" };
  const { error } = await supabase
    .from("sms_canned_replies")
    .delete()
    .eq("id", replyId)
    .eq("organisation_id", org.id);
  if (error) return { error: error.message };
  revalidatePath("/team");
  revalidatePath("/inbox");
  return {};
}

export async function submitKyc(formData: FormData): Promise<{ error?: string }> {
  const { org, user, supabase, role } = await requireOrgMember();
  const blocked = destructiveRoleError(role);
  if (blocked) return { error: blocked };
  const legalName = String(formData.get("kyc_legal_name") ?? "").trim();
  const abn = String(formData.get("kyc_abn") ?? "").replace(/\s/g, "");
  if (legalName.length < 2) return { error: "Legal name is required" };
  if (abn.length < 9) return { error: "Enter an ABN (or equivalent business number)" };

  const { error } = await supabase
    .from("organisations")
    .update({
      kyc_legal_name: legalName,
      kyc_abn: abn,
      kyc_status: "pending",
      kyc_submitted_at: new Date().toISOString(),
    })
    .eq("id", org.id);
  if (error) return { error: error.message };

  await writeAudit(createAdminClient(), {
    organisationId: org.id,
    actorUserId: user.id,
    action: "kyc_submitted",
    payload: { legalName },
  });
  revalidateTeam();
  return {};
}

export async function requestHostedSending(): Promise<{ error?: string }> {
  const { org, user, role } = await requireOrgMember();
  const blocked = destructiveRoleError(role);
  if (blocked) return { error: blocked };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("provider_accounts")
    .select("id, mode")
    .eq("organisation_id", org.id)
    .maybeSingle();

  if (existing?.mode === "byo") {
    return {
      error:
        "This organisation already has BYO Mobile Message credentials. Hosted sending is assigned from the platform console after KYC.",
    };
  }

  const row = {
    organisation_id: org.id,
    provider: "mobile_message",
    mode: "hosted" as const,
    credentials_ciphertext: null,
    last_verified_at: null,
  };
  if (existing?.id) {
    const { error } = await admin.from("provider_accounts").update(row).eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await admin.from("provider_accounts").insert(row);
    if (error) return { error: error.message };
  }

  await writeAudit(admin, {
    organisationId: org.id,
    actorUserId: user.id,
    action: "hosted_sending_requested",
  });
  revalidateTeam();
  return {};
}

export async function startCreditCheckout(): Promise<{ error?: string }> {
  const { org, user, supabase, role } = await requireOrgMember();
  const blocked = destructiveRoleError(role);
  if (blocked) return { error: blocked };
  if (!stripeConfigured()) {
    return {
      error:
        "Stripe is not connected yet. Install the Stripe integration on the yarnhub Vercel project, then pull env vars.",
    };
  }

  const credits = creditPackSize();
  const { data: intent, error } = await supabase
    .from("billing_checkout_intents")
    .insert({
      organisation_id: org.id,
      credits,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const checkout = await createStripeCheckoutSession({
    orgId: org.id,
    orgName: org.name,
    intentId: intent.id,
    credits,
    amountCents: creditPackAmountCents(),
  });
  if (checkout.error || !checkout.url) {
    await createAdminClient()
      .from("billing_checkout_intents")
      .update({ status: "failed" })
      .eq("id", intent.id);
    return { error: checkout.error || "Stripe checkout did not return a URL" };
  }

  await writeAudit(createAdminClient(), {
    organisationId: org.id,
    actorUserId: user.id,
    action: "credit_checkout_started",
    payload: { intentId: intent.id, credits },
  });
  redirect(checkout.url);
}
