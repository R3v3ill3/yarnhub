import Link from "next/link";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { AppPage } from "@/components/app-page";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { toDisplay } from "@/lib/phone/normalise-phone";

export default async function RelaysPage() {
  const { supabase, org } = await requireOrgMember();
  const [{ data: relays }, { data: numbers }] = await Promise.all([
    supabase
      .from("sms_relays")
      .select("id, name, status, created_at, number_id")
      .eq("organisation_id", org.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("sms_numbers")
      .select("id, phone_e164, label")
      .eq("organisation_id", org.id),
  ]);

  const numberById = new Map((numbers ?? []).map((n) => [n.id, n]));

  return (
    <AppPage>
      <div className="space-y-6">
        <PageHeader
          title="Relays"
          description="Members text a dedicated number; messages forward to a target with attribution. Replies come back through the same number — no CLI spoofing."
          actions={
            <Button asChild>
              <Link href="/relays/new">New relay</Link>
            </Button>
          }
        />
        {!relays?.length ? (
          <p className="text-sm text-muted-foreground">
            No relays yet. Register a number with purpose “relay” in Settings, then
            create one here.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border-2 border-border">
            {relays.map((relay) => {
              const number = numberById.get(relay.number_id);
              return (
                <li key={relay.id}>
                  <Link
                    href={`/relays/${relay.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent/40"
                  >
                    <div>
                      <p className="font-medium">{relay.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {number
                          ? number.label || toDisplay(number.phone_e164)
                          : "Unknown number"}
                      </p>
                    </div>
                    <Badge variant="secondary">{relay.status}</Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppPage>
  );
}
