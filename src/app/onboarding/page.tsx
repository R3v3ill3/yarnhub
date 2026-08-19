import { redirect } from "next/navigation";
import { getOrgMembership } from "@/lib/auth/require-org-member";
import { AuthShell } from "@/components/marketing-shell";
import { OnboardingForm } from "./onboarding-form";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const membership = await getOrgMembership();
  if (!membership?.user) redirect("/login");
  if (membership.org) redirect("/inbox");

  return (
    <AuthShell
      title="Name your organisation"
      description="This name is the legal sender identity on SMS — not the Yarnhub brand."
    >
      <OnboardingForm />
    </AuthShell>
  );
}
