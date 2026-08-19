import { AuthShell } from "@/components/marketing-shell";
import { SignupForm } from "./signup-form";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  return (
    <AuthShell
      title="Create an account"
      description="First login creates your organisation. Connect Mobile Message next."
    >
      <SignupForm inviteToken={invite?.trim() || null} />
    </AuthShell>
  );
}
