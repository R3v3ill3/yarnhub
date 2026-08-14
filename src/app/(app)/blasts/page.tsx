import Link from "next/link";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { AppPage } from "@/components/app-page";
import { Badge } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default async function BlastsPage() {
  const { supabase, org } = await requireOrgMember();
  const { data: blasts } = await supabase
    .from("sms_blasts")
    .select("id, name, status, created_at, queued_at, completed_at")
    .eq("organisation_id", org.id)
    .order("created_at", { ascending: false });

  return (
    <AppPage>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Blasts</h1>
            <p className="text-muted-foreground">
              Queue a bulk SMS. Cron drains every 5 minutes during the send window.
            </p>
          </div>
          <Button asChild>
            <Link href="/blasts/new">New blast</Link>
          </Button>
        </div>
        {!blasts?.length ? (
          <p className="text-sm text-muted-foreground">No blasts yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {blasts.map((blast) => (
              <li key={blast.id}>
                <Link
                  href={`/blasts/${blast.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent/40"
                >
                  <div>
                    <p className="font-medium">{blast.name || "Untitled blast"}</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(blast.created_at).toLocaleString()}
                    </p>
                  </div>
                  <Badge variant="secondary">{blast.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppPage>
  );
}
