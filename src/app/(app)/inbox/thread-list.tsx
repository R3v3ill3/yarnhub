"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/alert";
import { toDisplay } from "@/lib/phone/normalise-phone";
import { cn } from "@/lib/utils";

export type InboxThread = {
  id: string;
  phone_e164: string;
  last_message_at: string | null;
  unread_count: number;
  name: string;
  ourLabel: string;
};

export function ThreadList({ threads }: { threads: InboxThread[] }) {
  const pathname = usePathname();
  const inThread = /^\/inbox\/[^/]+$/.test(pathname);

  return (
    <aside
      className={cn(
        "flex w-full shrink-0 flex-col border-b border-border md:w-80 md:border-b-0 md:border-r",
        inThread && "hidden md:flex",
      )}
    >
      <div className="border-b border-border px-4 py-3">
        <h1 className="text-sm font-semibold">Inbox</h1>
        <p className="text-xs text-muted-foreground">One thread per number and phone</p>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {threads.map((thread) => {
          const href = `/inbox/${thread.id}`;
          const active = pathname === href;
          return (
            <li key={thread.id}>
              <Link
                href={href}
                className={cn(
                  "block px-4 py-3 hover:bg-accent/40",
                  active && "bg-accent/50",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate font-medium">
                    {thread.name || toDisplay(thread.phone_e164)}
                  </p>
                  {thread.unread_count > 0 ? <Badge>{thread.unread_count}</Badge> : null}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {toDisplay(thread.phone_e164)} · {thread.ourLabel}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {thread.last_message_at
                    ? new Date(thread.last_message_at).toLocaleString()
                    : "—"}
                </p>
              </Link>
            </li>
          );
        })}
        {!threads.length ? (
          <li className="px-4 py-8 text-sm text-muted-foreground">
            No threads yet. Send a test SMS from Settings or queue a blast.
          </li>
        ) : null}
      </ul>
    </aside>
  );
}
