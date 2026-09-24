import type { ReactNode } from "react";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { filterInboxSafeSenders } from "@/lib/sms/sender-purpose";
import { toDisplay } from "@/lib/phone/normalise-phone";
import { ThreadList, type InboxThread } from "./thread-list";

function contactName(
  contacts:
    | { first_name: string | null; last_name: string | null }
    | { first_name: string | null; last_name: string | null }[]
    | null,
): string {
  const person = Array.isArray(contacts) ? contacts[0] : contacts;
  return [person?.first_name, person?.last_name].filter(Boolean).join(" ");
}

export default async function InboxLayout({ children }: { children: ReactNode }) {
  const { supabase, org, user } = await requireOrgMember();
  const [{ data: rows }, { data: numbers }, { data: contacts }] = await Promise.all([
    supabase
      .from("sms_conversations")
      .select(
        "id, phone_e164, last_message_at, unread_count, state, claimed_by, sms_numbers ( phone_e164, label ), contacts ( first_name, last_name )",
      )
      .eq("organisation_id", org.id)
      .order("last_message_at", { ascending: false }),
    supabase
      .from("sms_numbers")
      .select("id, phone_e164, purpose, status, label")
      .eq("organisation_id", org.id)
      .eq("status", "active"),
    supabase
      .from("contacts")
      .select("id, first_name, last_name, phone_e164, sms_opt_out")
      .eq("organisation_id", org.id)
      .eq("sms_opt_out", false)
      .order("last_name", { ascending: true }),
  ]);

  const threads: InboxThread[] = (rows ?? []).map((row) => {
    const our = row.sms_numbers as
      | { phone_e164: string; label: string | null }
      | { phone_e164: string; label: string | null }[]
      | null;
    const ourNumber = Array.isArray(our) ? our[0] : our;
    return {
      id: row.id,
      phone_e164: row.phone_e164,
      last_message_at: row.last_message_at,
      unread_count: row.unread_count,
      name: contactName(row.contacts),
      ourLabel: ourNumber?.label || ourNumber?.phone_e164 || "unknown",
      state: (row.state as InboxThread["state"]) || "open",
      claimed_by: (row.claimed_by as string | null) ?? null,
    };
  });
  const senders = filterInboxSafeSenders(numbers ?? []).map((number) => ({
    id: number.id,
    label: number.label || toDisplay(number.phone_e164),
  }));

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-1 flex-col md:flex-row lg:h-dvh">
      <ThreadList
        threads={threads}
        currentUserId={user.id}
        numbers={senders}
        contacts={(contacts ?? []).map((contact) => ({
          id: contact.id,
          name: [contact.first_name, contact.last_name].filter(Boolean).join(" "),
          phone: toDisplay(contact.phone_e164),
        }))}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
