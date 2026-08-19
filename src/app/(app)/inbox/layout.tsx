import type { ReactNode } from "react";
import { requireOrgMember } from "@/lib/auth/require-org-member";
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
  const { supabase, org } = await requireOrgMember();
  const { data: rows } = await supabase
    .from("sms_conversations")
    .select(
      "id, phone_e164, last_message_at, unread_count, sms_numbers ( phone_e164, label ), contacts ( first_name, last_name )",
    )
    .eq("organisation_id", org.id)
    .order("last_message_at", { ascending: false });

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
    };
  });

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-1 flex-col md:flex-row lg:h-dvh">
      <ThreadList threads={threads} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
