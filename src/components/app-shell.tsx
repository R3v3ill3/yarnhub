"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  ClipboardList,
  Contact,
  Inbox,
  Menu,
  Megaphone,
  MessagesSquare,
  Radio,
  Settings,
  Shield,
  Users,
  X,
} from "lucide-react";
import { BrandLockup, BrandMark } from "@/components/brand";
import { SignOutButton } from "@/app/(app)/sign-out-button";
import { APP_NAV } from "@/lib/app-nav";
import { cn } from "@/lib/utils";

const ICONS: Record<string, typeof Inbox> = {
  "/inbox": Inbox,
  "/blasts": Megaphone,
  "/p2p": MessagesSquare,
  "/surveys": ClipboardList,
  "/relays": Radio,
  "/contacts": Contact,
  "/reports": BarChart3,
  "/team": Users,
  "/settings": Settings,
};

export function AppShell({
  orgName,
  email,
  platform,
  children,
}: {
  orgName: string;
  email: string;
  platform: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-full bg-background">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
        <SidebarBody
          pathname={pathname}
          orgName={orgName}
          email={email}
          platform={platform}
        />
      </aside>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-foreground/40"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          />
          <aside className="relative flex h-full w-72 max-w-[85vw] flex-col bg-sidebar shadow-xl">
            <SidebarBody
              pathname={pathname}
              orgName={orgName}
              email={email}
              platform={platform}
              onNavigate={() => setOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 bg-primary px-4 text-white lg:hidden">
          <BrandLockup href="/inbox" inverted subtitle={orgName} />
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/15"
            aria-expanded={open}
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </header>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}

function SidebarBody({
  pathname,
  orgName,
  email,
  platform,
  onNavigate,
}: {
  pathname: string;
  orgName: string;
  email: string;
  platform: boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="bg-primary px-4 py-5 text-white">
        <BrandLockup href="/inbox" inverted subtitle={orgName} />
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {APP_NAV.map((item) => {
          const Icon = ICONS[item.href] ?? Inbox;
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-white shadow-sm"
                  : "text-sidebar-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
        {platform ? (
          <Link
            href="/platform"
            onClick={onNavigate}
            className={cn(
              "mt-2 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname.startsWith("/platform")
                ? "bg-primary text-white shadow-sm"
                : "text-sidebar-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Shield className="h-4 w-4 shrink-0" />
            Platform
          </Link>
        ) : null}
      </nav>
      <div className="space-y-3 border-t border-border p-4">
        <div className="flex items-center gap-2">
          <BrandMark className="h-8 w-8" />
          <p className="truncate text-xs text-muted-foreground" title={email}>
            {email}
          </p>
        </div>
        <div className="[&_button]:w-full">
          <SignOutButton />
        </div>
      </div>
    </>
  );
}
