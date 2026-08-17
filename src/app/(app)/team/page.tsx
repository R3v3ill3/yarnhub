import { AppPage } from "@/components/app-page";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { emailsForUserIds } from "@/lib/auth/user-emails";
import { destructiveRoleError } from "@/lib/auth/roles";
import { creditPackAmountCents, creditPackSize, stripeConfigured } from "@/lib/billing/stripe";
import { creditBalance } from "@/lib/sms/credits";
import { createAdminClient } from "@/lib/supabase/admin";
import { TeamForms } from "./team-forms";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const { org, supabase, role } = await requireOrgMember();
  const admin = createAdminClient();
  const [{ data: members }, { data: invites }, { data: canned }, { data: audit }, { data: account }] =
    await Promise.all([
      supabase
        .from("organisation_members")
        .select("user_id, role")
        .eq("organisation_id", org.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("organisation_invites")
        .select("id, email, role, expires_at, accepted_at")
        .eq("organisation_id", org.id)
        .is("accepted_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("sms_canned_replies")
        .select("id, title, body")
        .eq("organisation_id", org.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("audit_events")
        .select("id, action, actor_user_id, created_at")
        .eq("organisation_id", org.id)
        .order("created_at", { ascending: false })
        .limit(40),
      admin
        .from("provider_accounts")
        .select("mode")
        .eq("organisation_id", org.id)
        .maybeSingle(),
    ]);

  const emails = await emailsForUserIds([
    ...(members ?? []).map((m) => m.user_id as string),
    ...(audit ?? []).map((a) => a.actor_user_id as string).filter(Boolean),
  ]);
  const credits = await creditBalance(admin, org.id);

  return (
    <AppPage>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
          <p className="text-muted-foreground">
            Invites, roles, canned replies, timezone, KYC, and hosted credits for {org.name}.
          </p>
        </div>
        <TeamForms
          canAdmin={!destructiveRoleError(role)}
          timezone={org.timezone}
          members={(members ?? []).map((m) => ({
            user_id: m.user_id as string,
            role: m.role as string,
            email: emails.get(m.user_id as string) ?? m.user_id,
          }))}
          invites={(invites ?? []) as Array<{
            id: string;
            email: string;
            role: string;
            expires_at: string;
            accepted_at: string | null;
          }>}
          canned={(canned ?? []) as Array<{ id: string; title: string; body: string }>}
          audit={(audit ?? []).map((row) => ({
            id: row.id as string,
            action: row.action as string,
            created_at: row.created_at as string,
            actor: emails.get(row.actor_user_id as string) ?? "",
          }))}
          kycStatus={org.kyc_status ?? "none"}
          kycLegalName={org.kyc_legal_name ?? ""}
          kycAbn={org.kyc_abn ?? ""}
          sendingMode={(account?.mode as "byo" | "hosted" | null) ?? null}
          sendingSuspended={Boolean(org.sending_suspended)}
          creditBalance={credits}
          stripeConfigured={stripeConfigured()}
          creditPackSize={creditPackSize()}
          creditPackCents={creditPackAmountCents()}
        />
      </div>
    </AppPage>
  );
}
