import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { AppPage } from "@/components/app-page";
import { Badge } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toDisplay } from "@/lib/phone/normalise-phone";
import { DEFAULT_RELAY_PREFIX_TEMPLATE } from "@/lib/sms/relay-engine";
import { RelayDetailForms } from "../relay-detail-forms";

export default async function RelayDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, org } = await requireOrgMember();
  const { data: relay } = await supabase
    .from("sms_relays")
    .select("*")
    .eq("id", id)
    .eq("organisation_id", org.id)
    .maybeSingle();
  if (!relay) notFound();

  const [{ data: number }, { data: targets }, { data: messages }] = await Promise.all([
    supabase
      .from("sms_numbers")
      .select("phone_e164, label, purpose")
      .eq("id", relay.number_id)
      .maybeSingle(),
    supabase
      .from("sms_relay_targets")
      .select("id, phone_e164, display_name, is_active")
      .eq("relay_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("sms_relay_messages")
      .select(
        "id, direction, member_phone_e164, body, forwarded_body, forward_status, created_at",
      )
      .eq("relay_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  return (
    <AppPage>
      <div className="space-y-6">
        <div>
          <Link href="/relays" className="text-sm text-muted-foreground hover:text-foreground">
            ← Relays
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{relay.name}</h1>
            <Badge variant="secondary">{relay.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {number ? number.label || toDisplay(number.phone_e164) : "Unknown number"}
            {number?.purpose !== "relay"
              ? " — this number is no longer purpose=relay, so inbound will not take the relay leg."
              : null}
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Setup</CardTitle>
          </CardHeader>
          <CardContent>
            <RelayDetailForms
              relayId={relay.id}
              status={relay.status}
              prefixTemplate={relay.prefix_template ?? DEFAULT_RELAY_PREFIX_TEMPLATE}
              suffixTemplate={relay.suffix_template}
              quietHoursRespected={relay.quiet_hours_respected}
              targets={targets ?? []}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent messages</CardTitle>
          </CardHeader>
          <CardContent>
            {!messages?.length ? (
              <p className="text-sm text-muted-foreground">No traffic yet.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {messages.map((m) => (
                  <li key={m.id} className="rounded-md border border-border px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{m.direction}</span>
                      <Badge variant="outline">{m.forward_status}</Badge>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {m.member_phone_e164 ? `${m.member_phone_e164} · ` : ""}
                      {new Date(m.created_at).toLocaleString()}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">
                      {m.forwarded_body || m.body || "(empty)"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppPage>
  );
}
