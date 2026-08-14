import Link from "next/link";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { AppPage } from "@/components/app-page";
import { BlastComposeForm } from "../compose-form";

export default async function NewBlastPage() {
  const { supabase, org } = await requireOrgMember();
  const [{ data: numbers }, { data: lists }, { count }] = await Promise.all([
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
  ]);

  return (
    <AppPage>
      <div className="space-y-6">
        <div>
          <Link href="/blasts" className="text-sm text-muted-foreground hover:text-foreground">
            ← Blasts
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">New blast</h1>
        </div>
        <BlastComposeForm
          orgName={org.name}
          numbers={numbers ?? []}
          lists={lists ?? []}
          eligibleCount={count ?? 0}
        />
      </div>
    </AppPage>
  );
}
