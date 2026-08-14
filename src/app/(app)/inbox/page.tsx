import Link from "next/link";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { Badge } from "@/components/ui/alert";
import { toDisplay } from "@/lib/phone/normalise-phone";

export default async function InboxPage() {
  const { supabase, org } = await requireOrgMember();
  const { data: threads } = await supabase
    .from("sms_conversations")
    .select(
      "id, phone_e164, last_message_at, unread_count, state, sms_numbers ( phone_e164, label ), contacts ( first_name, last_name )",
    )
    .eq("organisation_id", org.id)
    .order("last_message_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <p className="text-muted-foreground">
          One thread per dedicated number and member phone.
        </p>
      </div>
      {!threads?.length ? (
        <p className="text-sm text-muted-foreground">
          No threads yet. Send a test SMS from{" "}
          <Link href="/settings" className="underline underline-offset-4">
            Settings
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {threads.map((thread) => {
            const contact = thread.contacts as
              | { first_name: string | null; last_name: string | null }
              | { first_name: string | null; last_name: string | null }[]
              | null;
            const person = Array.isArray(contact) ? contact[0] : contact;
            const name = [person?.first_name, person?.last_name]
              .filter(Boolean)
              .join(" ");
            const our = thread.sms_numbers as
              | { phone_e164: string; label: string | null }
              | { phone_e164: string; label: string | null }[]
              | null;
            const ourNumber = Array.isArray(our) ? our[0] : our;
            return (
              <li key={thread.id}>
                <Link
                  href={`/inbox/${thread.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent/40"
                >
                  <div>
                    <p className="font-medium">
                      {name || toDisplay(thread.phone_e164)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {toDisplay(thread.phone_e164)} · via{" "}
                      {ourNumber?.label || ourNumber?.phone_e164}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {thread.unread_count > 0 ? (
                      <Badge>{thread.unread_count}</Badge>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {thread.last_message_at
                        ? new Date(thread.last_message_at).toLocaleString()
                        : "—"}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
