import { AppPage } from "@/components/app-page";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

function countBy(rows: Array<{ status?: string; state?: string }>, key: "status" | "state") {
  const map = new Map<string, number>();
  for (const row of rows) {
    const value = (row[key] as string | undefined) ?? "unknown";
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export default async function ReportsPage() {
  const { org, supabase } = await requireOrgMember();
  const [{ data: blasts }, { data: items }, { data: surveys }, { data: sessions }] = await Promise.all([
    supabase
      .from("sms_blasts")
      .select("id, name, status, created_at")
      .eq("organisation_id", org.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("sms_blast_items").select("status").eq("organisation_id", org.id),
    supabase
      .from("sms_surveys")
      .select("id, title, status")
      .eq("organisation_id", org.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("sms_survey_sessions").select("survey_id, state").eq("organisation_id", org.id),
  ]);

  const itemCounts = countBy(items ?? [], "status");
  const sessionCounts = countBy(sessions ?? [], "state");
  const sessionsBySurvey = new Map<string, Map<string, number>>();
  for (const row of sessions ?? []) {
    const surveyId = row.survey_id as string;
    const state = (row.state as string) ?? "unknown";
    if (!sessionsBySurvey.has(surveyId)) sessionsBySurvey.set(surveyId, new Map());
    const inner = sessionsBySurvey.get(surveyId)!;
    inner.set(state, (inner.get(state) ?? 0) + 1);
  }

  return (
    <AppPage>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-muted-foreground">
            Blast delivery and survey funnel for {org.name}.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Blast delivery</CardTitle>
            <CardDescription>Item statuses across all blasts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-2 sm:grid-cols-3 text-sm">
              {itemCounts.map(([status, n]) => (
                <div key={status} className="rounded-md border border-border px-3 py-2">
                  <dt className="text-muted-foreground">{status}</dt>
                  <dd className="text-lg font-semibold">{n}</dd>
                </div>
              ))}
              {itemCounts.length === 0 ? (
                <p className="text-muted-foreground">No blast items yet.</p>
              ) : null}
            </dl>
            <ul className="space-y-2 text-sm">
              {(blasts ?? []).map((blast) => (
                <li key={blast.id} className="flex justify-between gap-2 border-b border-border pb-2">
                  <span>{blast.name || "Untitled blast"}</span>
                  <span className="text-muted-foreground">{blast.status}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Survey funnel</CardTitle>
            <CardDescription>Session states across surveys (invited → active → completed).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-2 sm:grid-cols-3 text-sm">
              {sessionCounts.map(([state, n]) => (
                <div key={state} className="rounded-md border border-border px-3 py-2">
                  <dt className="text-muted-foreground">{state}</dt>
                  <dd className="text-lg font-semibold">{n}</dd>
                </div>
              ))}
              {sessionCounts.length === 0 ? (
                <p className="text-muted-foreground">No survey sessions yet.</p>
              ) : null}
            </dl>
            <ul className="space-y-2 text-sm">
              {(surveys ?? []).map((survey) => {
                const funnel = sessionsBySurvey.get(survey.id) ?? new Map();
                const parts = [...funnel.entries()].map(([k, v]) => `${k} ${v}`).join(" · ");
                return (
                  <li key={survey.id} className="border-b border-border pb-2">
                    <p>{survey.title}</p>
                    <p className="text-muted-foreground">
                      {survey.status}
                      {parts ? ` · ${parts}` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
    </AppPage>
  );
}
