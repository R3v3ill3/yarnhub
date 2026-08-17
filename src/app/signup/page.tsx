import { SignupForm } from "./signup-form";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <SignupForm inviteToken={invite?.trim() || null} />
    </div>
  );
}
