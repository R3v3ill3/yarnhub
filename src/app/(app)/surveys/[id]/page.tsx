import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { AppPage } from "@/components/app-page";
import { Badge } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SurveyLaunchForm } from "../survey-launch-form";

export default async function SurveyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, org } = await requireOrgMember();
  const { data: survey } = await supabase
    .from("sms_surveys")
    .select("*")
    .eq("id", id)
    .eq("organisation_id", org.id)
    .maybeSingle();
  if (!survey) notFound();

  const [{ data: questions }, { data: numbers }, { data: lists }, { data: sessions }] =
    await Promise.all([
      supabase
        .from("sms_survey_questions")
        .select("id, sort_order, prompt, qtype")
        .eq("survey_id", id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("sms_numbers")
        .select("id, phone_e164, purpose, status, label")
        .eq("organisation_id", org.id),
      supabase
        .from("contact_lists")
        .select("id, name")
        .eq("organisation_id", org.id)
        .order("created_at", { ascending: false }),
      supabase.from("sms_survey_sessions").select("id, state").eq("survey_id", id),
    ]);

  const counts = (sessions ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[row.state] = (acc[row.state] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <AppPage>
      <div className="space-y-6">
        <div>
          <Link href="/surveys" className="text-sm text-muted-foreground hover:text-foreground">
            ← Surveys
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{survey.title}</h1>
            <Badge variant="secondary">{survey.status}</Badge>
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Questions</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              {(questions ?? []).map((q) => (
                <li key={q.id}>
                  <span className="font-medium">{q.prompt}</span>{" "}
                  <span className="text-muted-foreground">({q.qtype})</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Launch</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Sessions:{" "}
              {Object.entries(counts)
                .map(([state, n]) => `${state} ${n}`)
                .join(" · ") || "none yet"}
            </p>
            <SurveyLaunchForm
              surveyId={survey.id}
              status={survey.status}
              numbers={numbers ?? []}
              lists={lists ?? []}
            />
          </CardContent>
        </Card>
      </div>
    </AppPage>
  );
}
