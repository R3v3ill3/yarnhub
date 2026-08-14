import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { isMockSmsProvider } from "@/lib/sms/provider";
import { SimulateReplyForm } from "../simulate-reply-form";
import { ReplyForm } from "../reply-form";
import { ContactPane } from "../contact-pane";

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, org } = await requireOrgMember();
  const { data: thread } = await supabase
    .from("sms_conversations")
    .select(
      "id, phone_e164, unread_count, contact_id, sms_numbers ( phone_e164, label ), contacts ( id, first_name, last_name, sms_opt_out, notes )",
    )
    .eq("id", id)
    .eq("organisation_id", org.id)
    .maybeSingle();

  if (!thread) notFound();

  if (thread.unread_count > 0) {
    await supabase
      .from("sms_conversations")
      .update({ unread_count: 0 })
      .eq("id", id)
      .eq("organisation_id", org.id);
  }

  const { data: messages } = await supabase
    .from("sms_messages")
    .select("id, direction, body, created_at, status")
    .eq("conversation_id", id)
    .eq("organisation_id", org.id)
    .order("created_at", { ascending: true });

  const contact = thread.contacts as
    | {
        id: string;
        first_name: string | null;
        last_name: string | null;
        sms_opt_out: boolean;
        notes: string | null;
      }
    | {
        id: string;
        first_name: string | null;
        last_name: string | null;
        sms_opt_out: boolean;
        notes: string | null;
      }[]
    | null;
  const person = Array.isArray(contact) ? contact[0] : contact;
  const name = [person?.first_name, person?.last_name].filter(Boolean).join(" ");

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <li className="md:hidden">
            <Link href="/inbox" className="text-sm text-muted-foreground hover:text-foreground">
              ← Inbox
            </Link>
          </li>
          {(messages ?? []).map((message) => (
            <li
              key={message.id}
              className={`max-w-xl rounded-xl px-4 py-3 text-sm ${
                message.direction === "outbound"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "mr-auto bg-secondary text-secondary-foreground"
              }`}
            >
              <p className="whitespace-pre-wrap">{message.body}</p>
              <p
                className={`mt-1 text-xs ${
                  message.direction === "outbound"
                    ? "text-primary-foreground/70"
                    : "text-muted-foreground"
                }`}
              >
                {message.direction} · {new Date(message.created_at).toLocaleString()}
                {message.status ? ` · ${message.status}` : ""}
              </p>
            </li>
          ))}
          {!messages?.length ? (
            <li className="text-sm text-muted-foreground">No messages yet.</li>
          ) : null}
        </ol>
        <ReplyForm conversationId={id} optedOut={Boolean(person?.sms_opt_out)} />
        {isMockSmsProvider() ? (
          <div className="px-4 pb-4">
            <SimulateReplyForm conversationId={id} />
          </div>
        ) : null}
      </div>
      <ContactPane
        conversationId={id}
        contactId={person?.id ?? thread.contact_id}
        name={name}
        phone={thread.phone_e164}
        optedOut={Boolean(person?.sms_opt_out)}
        notes={person?.notes ?? ""}
      />
    </div>
  );
}
