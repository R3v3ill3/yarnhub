import type { ReactNode } from "react";
import Link from "next/link";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { SignOutButton } from "./sign-out-button";

export const dynamic = "force-dynamic";

const nav = [
  { href: "/inbox", label: "Inbox" },
  { href: "/blasts", label: "Blasts" },
  { href: "/p2p", label: "P2P" },
  { href: "/surveys", label: "Surveys" },
  { href: "/relays", label: "Relays" },
  { href: "/contacts", label: "Contacts" },
  { href: "/settings", label: "Settings" },
];

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { org, user } = await requireOrgMember();

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-6">
            <Link href="/inbox" className="text-sm font-semibold tracking-tight">
              Yarnhub
            </Link>
            <nav className="flex items-center gap-4 text-sm text-muted-foreground">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="hover:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="hidden sm:inline">{org.name}</span>
            <span className="hidden md:inline">{user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
