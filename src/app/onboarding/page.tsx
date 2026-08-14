import { redirect } from "next/navigation";
import { getOrgMembership } from "@/lib/auth/require-org-member";
import { OnboardingForm } from "./onboarding-form";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const membership = await getOrgMembership();
  if (!membership?.user) redirect("/login");
  if (membership.org) redirect("/inbox");

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <OnboardingForm />
    </div>
  );
}
