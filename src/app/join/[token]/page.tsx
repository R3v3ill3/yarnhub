import { redirect } from "next/navigation";
import { getOrgMembership, getSessionUser } from "@/lib/auth/require-org-member";
import { JoinForm } from "../join-form";

export const dynamic = "force-dynamic";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = await getSessionUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/join/${token}`)}`);
  }

  const membership = await getOrgMembership();
  if (membership?.org) {
    redirect("/inbox");
  }

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <JoinForm token={token} />
    </div>
  );
}
