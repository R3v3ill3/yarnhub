import Link from "next/link";
import { notFound } from "next/navigation";
import { AppPage } from "@/components/app-page";
import { requireUser } from "@/lib/auth/require-org-member";
import { isPlatformAdminEmail } from "@/lib/auth/roles";
import { creditBalance } from "@/lib/sms/credits";
import { createAdminClient } from "@/lib/supabase/admin";
import { SignOutButton } from "@/app/(app)/sign-out-button";
import { PlatformForms } from "./platform-forms";

export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  const { user } = await requireUser();
  if (!isPlatformAdminEmail(user.email)) notFound();

  const admin = createAdminClient();
  const [{ data: platform }, { data: orgs }, { data: pool }] = await Promise.all([
    admin
      .from("platform_sms_accounts")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    admin
      .from("organisations")
      .select("id, name, kyc_status, sending_suspended")
      .order("created_at", { ascending: true }),
    admin
      .from("hosted_number_pool")
      .select("id, phone_e164, label, status, assigned_organisation_id")
      .order("created_at", { ascending: true }),
  ]);

  const withCredits = await Promise.all(
    (orgs ?? []).map(async (org) => ({
      id: org.id as string,
      name: org.name as string,
      kyc_status: (org.kyc_status as string) ?? "none",
      sending_suspended: Boolean(org.sending_suspended),
      credits: await creditBalance(admin, org.id as string),
    })),
  );

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-4 text-sm">
            <Link href="/inbox" className="font-semibold tracking-tight">
              Yarnhub
            </Link>
            <span className="text-muted-foreground">Platform</span>
          </div>
          <SignOutButton />
        </div>
      </header>
      <AppPage>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Platform console</h1>
            <p className="text-muted-foreground">
              Hosted Mobile Message credentials, number pool, KYC, credits, and panic suspend.
            </p>
          </div>
          <PlatformForms
            hasPlatformAccount={Boolean(platform)}
            orgs={withCredits}
            pool={(pool ?? []) as Array<{
              id: string;
              phone_e164: string;
              label: string | null;
              status: string;
              assigned_organisation_id: string | null;
            }>}
          />
        </div>
      </AppPage>
    </div>
  );
}
