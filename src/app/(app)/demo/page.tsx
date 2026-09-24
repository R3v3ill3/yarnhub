import Link from "next/link";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { isAdminRole } from "@/lib/auth/roles";
import { AppPage } from "@/components/app-page";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { redgumDemoContactId } from "@/lib/demo/load-redgum-demo";
import { DemoPanel } from "./demo-panel";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    href: "/surveys",
    title: "Survey",
    body: "Log of claims at Redgum Resources: support, which claim matters, confidence, and whether they will sign a majority support petition. The survey is paused so the timer will not text anyone.",
  },
  {
    href: "/blasts",
    title: "Blast",
    body: "Management refuses to bargain. The message points at a hypothetical petition on example.com. Delivery is already recorded, including failures and an opt-out.",
  },
  {
    href: "/p2p",
    title: "P2P",
    body: "Four sends: an introduction, wages and safety, surging interest in the pit, then a request for classification and one workmate to join.",
  },
  {
    href: "/inbox",
    title: "Inbox",
    body: "The same people reply. Priya, Tom, Jess and Rina carry the four-step yarn. A few threads are waiting on a reply.",
  },
  {
    href: "/relays",
    title: "Relay",
    body: "Members text a dedicated line. Messages are attributed and passed to Alex Chen in HR at Redgum Resources, asking them to bargain. Replies come back through the same number. Nothing is left queued.",
  },
  {
    href: "/reports",
    title: "Reports",
    body: "Blast item statuses and the survey funnel (completed, active, invited, expired, opted out, undeliverable) read from this data.",
  },
];

export default async function DemoPage() {
  const { supabase, org, role } = await requireOrgMember();
  const { data: marker } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", redgumDemoContactId(org.id))
    .maybeSingle();

  return (
    <AppPage>
      <div className="space-y-6">
        <PageHeader
          title="Bargaining demo"
          description="A fictional Mineworkers Union campaign at Redgum Resources. Every number is an ACMA fiction mobile, reserved for stories and not connected to a person."
        />
        <Card>
          <CardHeader>
            <CardTitle>{marker ? "Demo is loaded" : "Load the Redgum Ridge campaign"}</CardTitle>
            <CardDescription>
              Rows are added to {org.name}. They are not sent. Reloading replaces the same demo rows and leaves your other contacts alone. Do not relaunch the survey — that would try to text the fiction numbers.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DemoPanel loaded={Boolean(marker)} canAdmin={isAdminRole(role)} />
          </CardContent>
        </Card>
        <div className="grid gap-4 md:grid-cols-2">
          {STEPS.map((step) => (
            <Card key={step.href}>
              <CardHeader>
                <CardTitle>
                  <Link href={step.href} className="hover:underline">
                    {step.title}
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{step.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppPage>
  );
}
