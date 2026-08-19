import { requireOrgMember } from "@/lib/auth/require-org-member";
import { AppPage } from "@/components/app-page";
import { PageHeader } from "@/components/page-header";
import { P2pBoard } from "./p2p-board";

export default async function P2pPage() {
  const { supabase, org } = await requireOrgMember();
  const [{ data: numbers }, { data: contacts }] = await Promise.all([
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
  ]);

  return (
    <AppPage>
      <div className="space-y-6">
        <PageHeader
          title="P2P chat"
          description="Pick people, send a personalised opener, then continue 1:1 in Inbox."
        />
        <P2pBoard orgName={org.name} numbers={numbers ?? []} contacts={contacts ?? []} />
      </div>
    </AppPage>
  );
}
