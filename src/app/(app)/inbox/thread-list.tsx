"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Alert, Badge } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toDisplay } from "@/lib/phone/normalise-phone";
import { cn } from "@/lib/utils";
import { startConversation } from "./actions";

export type InboxThread = {
  id: string;
  phone_e164: string;
  last_message_at: string | null;
  unread_count: number;
  name: string;
  ourLabel: string;
  state: "open" | "needs_reply" | "closed";
  claimed_by: string | null;
};

type Queue = "needs_reply" | "mine" | "unclaimed" | "all";

export function ThreadList({
  threads,
  currentUserId,
  numbers,
  contacts,
}: {
  threads: InboxThread[];
  currentUserId: string;
  numbers: Array<{ id: string; label: string }>;
  contacts: Array<{ id: string; name: string; phone: string }>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const inThread = /^\/inbox\/[^/]+$/.test(pathname);
  const [queue, setQueue] = useState<Queue>("needs_reply");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const visible = useMemo(() => {
    return threads.filter((thread) => {
      if (queue === "all") return true;
      if (thread.state === "closed") return false;
      if (queue === "needs_reply") return thread.state === "needs_reply" || thread.unread_count > 0;
      if (queue === "mine") return thread.claimed_by === currentUserId;
      return !thread.claimed_by;
    });
  }, [threads, queue, currentUserId]);

  async function onStart(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await startConversation(formData);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.conversationId) router.push(`/inbox/${result.conversationId}`);
  }

  return (
    <aside
      className={cn(
        "flex w-full shrink-0 flex-col border-b border-border md:w-80 md:border-b-0 md:border-r",
        inThread && "hidden md:flex",
      )}
    >
      <div className="border-b border-border bg-sidebar px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
          Yarnhub
        </p>
        <h1 className="font-display text-lg font-bold">Inbox</h1>
        <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Queues">
          {(
            [
              ["needs_reply", "Needs reply"],
              ["mine", "Mine"],
              ["unclaimed", "Unclaimed"],
              ["all", "All"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={queue === value}
              className={cn(
                "rounded-full px-2 py-0.5 text-xs",
                queue === value ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
              )}
              onClick={() => setQueue(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <form action={onStart} className="space-y-2 border-b border-border p-3">
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <Label htmlFor="contactId">New conversation</Label>
        <select
          id="contactId"
          name="contactId"
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          defaultValue=""
        >
          <option value="" disabled>
            Contact
          </option>
          {contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name || contact.phone}
            </option>
          ))}
        </select>
        <Label htmlFor="numberId">From</Label>
        <select
          id="numberId"
          name="numberId"
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          defaultValue={numbers[0]?.id ?? ""}
        >
          {numbers.map((number) => (
            <option key={number.id} value={number.id}>
              {number.label}
            </option>
          ))}
        </select>
        <Textarea name="body" rows={2} placeholder="Optional first message" />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Starting…" : "Start"}
        </Button>
      </form>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {visible.map((thread) => {
          const href = `/inbox/${thread.id}`;
          const active = pathname === href;
          return (
            <li key={thread.id}>
              <Link
                href={href}
                className={cn(
                  "block border-l-4 px-4 py-3 hover:bg-accent",
                  active
                    ? "border-primary bg-accent"
                    : "border-transparent",
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
        {!visible.length ? (
          <li className="px-4 py-8 text-sm text-muted-foreground">
            Nothing in this queue.
          </li>
        ) : null}
      </ul>
    </aside>
  );
}
