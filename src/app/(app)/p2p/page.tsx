import { requireOrgMember } from "@/lib/auth/require-org-member";
import { AppPage } from "@/components/app-page";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { P2P_STEPS } from "@/lib/demo/redgum-bargaining";
import { P2pBoard } from "./p2p-board";

export default async function P2pPage() {
  const { supabase, org } = await requireOrgMember();
  const [{ data: numbers }, { data: contacts }, { data: sends }] = await Promise.all([
    supabase
      .from("sms_numbers")
      .select("id, phone_e164, purpose, status, label")
      .eq("organisation_id", org.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("contacts")
      .select("id, first_name, last_name, phone_e164, sms_opt_out")
      .eq("organisation_id", org.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("sms_p2p_sends")
      .select("id, status, created_at, body_template")
      .eq("organisation_id", org.id)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  return (
    <AppPage>
      <div className="space-y-6">
        <PageHeader
          title="P2P chat"
          description="Pick people, send a personalised opener, then work the replies in the chat workspace. The same threads stay in Inbox."
          actions={
            <Button asChild>
              <Link href="/sms/new?kind=chat">New chat</Link>
            </Button>
          }
        />
        {sends?.length ? (
          <ul className="flex flex-wrap gap-2 text-sm">
            {sends.map((send) => {
              const step = P2P_STEPS.find((item) => item.template === send.body_template);
              return (
                <li key={send.id}>
                  <Link href={`/p2p/${send.id}`} className="rounded-full border border-border px-3 py-1 hover:bg-accent">
                    {step?.title ?? new Date(send.created_at).toLocaleString()} · {send.status}
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
        <P2pBoard orgName={org.name} numbers={numbers ?? []} contacts={contacts ?? []} />
      </div>
    </AppPage>
  );
}
