import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { isMockSmsProvider } from "@/lib/sms/provider";
import { toDisplay } from "@/lib/phone/normalise-phone";
import { Badge } from "@/components/ui/alert";
import { SimulateReplyForm } from "../simulate-reply-form";

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
      "id, phone_e164, unread_count, state, sms_numbers ( phone_e164, label ), contacts ( first_name, last_name, sms_opt_out )",
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
    | { first_name: string | null; last_name: string | null; sms_opt_out: boolean }
    | { first_name: string | null; last_name: string | null; sms_opt_out: boolean }[]
    | null;
  const person = Array.isArray(contact) ? contact[0] : contact;
  const name = [person?.first_name, person?.last_name].filter(Boolean).join(" ");
  const our = thread.sms_numbers as
    | { phone_e164: string; label: string | null }
    | { phone_e164: string; label: string | null }[]
    | null;
  const ourNumber = Array.isArray(our) ? our[0] : our;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/inbox" className="text-sm text-muted-foreground hover:text-foreground">
          ← Inbox
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {name || toDisplay(thread.phone_e164)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {toDisplay(thread.phone_e164)} · via {ourNumber?.label || ourNumber?.phone_e164}
        </p>
        {person?.sms_opt_out ? (
          <div className="mt-2">
            <Badge variant="destructive">Opted out</Badge>
          </div>
        ) : null}
      </div>

      <ol className="space-y-3">
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
      </ol>

      {isMockSmsProvider() ? <SimulateReplyForm conversationId={id} /> : null}
    </div>
  );
}
