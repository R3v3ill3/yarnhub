import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { AppPage } from "@/components/app-page";
import { Badge } from "@/components/ui/alert";
import { toDisplay } from "@/lib/phone/normalise-phone";
import { deriveRailState } from "@/lib/sms/chat-rail-state";

const RAIL_LABEL: Record<string, string> = {
  not_messaged: "Not sent",
  sending: "Sending",
  messaged: "Sent",
  new_reply: "New reply",
  needs_response: "Needs reply",
  in_conversation: "In conversation",
  closed: "Closed",
  opted_out: "Opted out",
  failed: "Failed",
};

export default async function P2pWorkspacePage({
  params,
}: {
  params: Promise<{ sendId: string }>;
}) {
  const { sendId } = await params;
  const { supabase, org } = await requireOrgMember();
  const { data: send } = await supabase
    .from("sms_p2p_sends")
    .select("id, body_template, status, created_at")
    .eq("id", sendId)
    .eq("organisation_id", org.id)
    .maybeSingle();
  if (!send) notFound();

  const { data: items } = await supabase
    .from("sms_p2p_send_items")
    .select(
      "id, status, phone_e164, conversation_id, contacts ( first_name, last_name, sms_opt_out ), sms_conversations ( state, unread_count )",
    )
    .eq("send_id", sendId)
    .eq("organisation_id", org.id)
    .order("sort_order", { ascending: true });

  const rows = (items ?? []).map((item) => {
    const contact = item.contacts as
      | { first_name: string | null; last_name: string | null; sms_opt_out: boolean }
      | { first_name: string | null; last_name: string | null; sms_opt_out: boolean }[]
      | null;
    const person = Array.isArray(contact) ? contact[0] : contact;
    const conversation = item.sms_conversations as
      | { state: "open" | "needs_reply" | "closed"; unread_count: number }
      | { state: "open" | "needs_reply" | "closed"; unread_count: number }[]
      | null;
    const thread = Array.isArray(conversation) ? conversation[0] : conversation;
    const rail = deriveRailState({
      status: item.status,
      sms_opt_out: Boolean(person?.sms_opt_out),
      conversation_state: thread?.state ?? null,
      unread_count: thread?.unread_count ?? 0,
    });
    return {
      id: item.id,
      name: [person?.first_name, person?.last_name].filter(Boolean).join(" "),
      phone: item.phone_e164 as string,
      conversationId: item.conversation_id as string | null,
      rail,
    };
  });
  const needsReply = rows.filter((row) => row.rail === "new_reply" || row.rail === "needs_response");

  return (
    <AppPage>
      <div className="space-y-6">
        <div>
          <Link href="/p2p" className="text-sm text-muted-foreground hover:text-foreground">
            ← P2P
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Chat workspace</h1>
          <p className="text-sm text-muted-foreground">
            {send.status} · {needsReply.length} need a reply. The same threads are in Inbox.
          </p>
        </div>
        <pre className="whitespace-pre-wrap rounded-xl border border-border bg-secondary/30 p-4 text-sm">
          {send.body_template}
        </pre>
        <ul className="divide-y divide-border overflow-hidden rounded-lg border-2 border-border">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-medium">{row.name || toDisplay(row.phone)}</p>
                <p className="font-mono text-xs text-muted-foreground">{toDisplay(row.phone)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{RAIL_LABEL[row.rail] ?? row.rail}</Badge>
                {row.conversationId ? (
                  <Link href={`/inbox/${row.conversationId}`} className="text-sm text-primary hover:underline">
                    Open thread
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">Waiting to send</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </AppPage>
  );
}
