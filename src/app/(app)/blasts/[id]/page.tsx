import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { AppPage } from "@/components/app-page";
import { Badge } from "@/components/ui/alert";
import { toDisplay } from "@/lib/phone/normalise-phone";

export default async function BlastDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, org } = await requireOrgMember();
  const { data: blast } = await supabase
    .from("sms_blasts")
    .select(
      "id, name, body, status, timezone, blackout_override, blackout_override_reason, created_at, queued_at, completed_at, sms_numbers ( phone_e164, label )",
    )
    .eq("id", id)
    .eq("organisation_id", org.id)
    .maybeSingle();
  if (!blast) notFound();

  const { data: items } = await supabase
    .from("sms_blast_items")
    .select("id, status, phone_e164, failure_reason, sent_at")
    .eq("blast_id", id)
    .eq("organisation_id", org.id)
    .order("sort_order", { ascending: true });

  const { data: logs } = await supabase
    .from("sms_send_log")
    .select("blast_item_id, status")
    .eq("blast_id", id)
    .eq("organisation_id", org.id);

  const deliveryByItem = new Map(
    (logs ?? []).map((row) => [row.blast_item_id as string | null, row.status as string]),
  );

  const counts = (items ?? []).reduce<Record<string, number>>((acc, item) => {
    const status = deliveryByItem.get(item.id) ?? item.status;
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});
  const sender = blast.sms_numbers as
    | { phone_e164: string; label: string | null }
    | { phone_e164: string; label: string | null }[]
    | null;
  const our = Array.isArray(sender) ? sender[0] : sender;

  return (
    <AppPage>
      <div className="space-y-6">
        <div>
          <Link href="/blasts" className="text-sm text-muted-foreground hover:text-foreground">
            ← Blasts
          </Link>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {blast.name || "Untitled blast"}
            </h1>
            <Badge>{blast.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Via {our?.label || (our ? toDisplay(our.phone_e164) : "unknown number")} ·{" "}
            {blast.timezone}
            {blast.blackout_override ? " · blackout override" : ""}
          </p>
        </div>
        <pre className="whitespace-pre-wrap rounded-xl border border-border bg-secondary/30 p-4 text-sm">
          {blast.body}
        </pre>
        <div className="flex flex-wrap gap-2 text-sm">
          {Object.entries(counts).map(([status, n]) => (
            <Badge key={status} variant="secondary">
              {status}: {n}
            </Badge>
          ))}
        </div>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Phone</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {(items ?? []).map((item) => {
                const delivery = deliveryByItem.get(item.id);
                return (
                  <tr key={item.id} className="border-t border-border">
                    <td className="px-4 py-2 font-mono">{toDisplay(item.phone_e164)}</td>
                    <td className="px-4 py-2">{delivery ?? item.status}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {item.failure_reason ||
                        (item.sent_at ? new Date(item.sent_at).toLocaleString() : "—")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppPage>
  );
}
