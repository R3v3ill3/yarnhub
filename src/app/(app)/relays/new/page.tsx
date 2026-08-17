import Link from "next/link";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { AppPage } from "@/components/app-page";
import { RelayCreateForm } from "../relay-create-form";
import { LIVE_RELAY_STATUSES } from "@/lib/sms/relay-runtime";

export default async function NewRelayPage() {
  const { supabase, org } = await requireOrgMember();
  const [{ data: numbers }, { data: live }] = await Promise.all([
    supabase
      .from("sms_numbers")
      .select("id, phone_e164, purpose, status, label")
      .eq("organisation_id", org.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("sms_relays")
      .select("number_id")
      .eq("organisation_id", org.id)
      .in("status", [...LIVE_RELAY_STATUSES]),
  ]);

  return (
    <AppPage>
      <div className="space-y-6">
        <div>
          <Link href="/relays" className="text-sm text-muted-foreground hover:text-foreground">
            ← Relays
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">New relay</h1>
        </div>
        <RelayCreateForm
          numbers={numbers ?? []}
          occupiedNumberIds={(live ?? []).map((r) => r.number_id)}
        />
      </div>
    </AppPage>
  );
}
