import type { ReactNode } from "react";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { isPlatformAdminEmail } from "@/lib/auth/roles";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { org, user } = await requireOrgMember();

  return (
    <AppShell
      orgName={org.name}
      email={user.email ?? ""}
      platform={isPlatformAdminEmail(user.email)}
    >
      {children}
    </AppShell>
  );
}
