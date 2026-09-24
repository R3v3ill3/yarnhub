import { requireOrgMember } from "@/lib/auth/require-org-member";
import { AppPage } from "@/components/app-page";
import { parseSmsActionKind } from "@/lib/sms/action-kind";
import { LIVE_RELAY_STATUSES } from "@/lib/sms/relay-runtime";
import { SmsCreateWizard } from "./wizard";

export default async function NewSmsActionPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind } = await searchParams;
  const initialKind = parseSmsActionKind(kind);
  const { supabase, org } = await requireOrgMember();
  const [{ data: numbers }, { data: lists }, { count }, { data: contacts }, { data: liveRelays }] =
    await Promise.all([
      supabase
        .from("sms_numbers")
        .select("id, phone_e164, purpose, status, label")
        .eq("organisation_id", org.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("contact_lists")
        .select("id, name")
        .eq("organisation_id", org.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("organisation_id", org.id)
        .eq("sms_opt_out", false),
      initialKind === "chat"
        ? supabase
            .from("contacts")
            .select("id, first_name, last_name, phone_e164, sms_opt_out")
            .eq("organisation_id", org.id)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      supabase
        .from("sms_relays")
        .select("number_id")
        .eq("organisation_id", org.id)
        .in("status", [...LIVE_RELAY_STATUSES]),
    ]);

  return (
    <AppPage>
      <SmsCreateWizard
        key={initialKind ?? "pick"}
        initialKind={initialKind}
        orgName={org.name}
        numbers={numbers ?? []}
        lists={lists ?? []}
        eligibleCount={count ?? 0}
        contacts={contacts ?? []}
        occupiedRelayNumberIds={(liveRelays ?? []).map((row) => row.number_id)}
      />
    </AppPage>
  );
}
