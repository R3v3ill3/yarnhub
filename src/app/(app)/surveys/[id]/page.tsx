import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { AppPage } from "@/components/app-page";
import { Badge } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toDisplay } from "@/lib/phone/normalise-phone";
import { SmsSurveyFlowChart } from "@/components/sms-survey-flow-chart";
import { SurveyReportDashboard } from "@/components/sms-survey-report";
import { surveyAnswersToWideCsv } from "@/lib/sms/survey-export";
import { flowFromSaved } from "@/lib/sms/survey-flow";
import {
  funnelFromSessions,
  participationSlices,
  questionSlices,
} from "@/lib/sms/survey-report";
import type { SmsSurveyQuestionType } from "@/types/sms";
import { SurveyLaunchForm } from "../survey-launch-form";
import { SurveyOps } from "../survey-ops";

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
        .select("id, sort_order, prompt, qtype, options, branching")
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
      supabase
        .from("sms_survey_sessions")
        .select("id, state, phone_e164, first_answer_at, contacts ( first_name, last_name )")
        .eq("survey_id", id),
    ]);
  const sessionIds = (sessions ?? []).map((session) => session.id as string);
  const { data: answers } = sessionIds.length
    ? await supabase
        .from("sms_survey_answers")
        .select("session_id, question_id, parsed_value, raw_body")
        .eq("organisation_id", org.id)
        .in("session_id", sessionIds)
    : { data: [] };
  const answersBySession = new Map<string, Record<string, { parsed_value: string | null; raw_body: string | null }>>();
  for (const answer of answers ?? []) {
    const bucket = answersBySession.get(answer.session_id) ?? {};
    bucket[answer.question_id] = {
      parsed_value: answer.parsed_value,
      raw_body: answer.raw_body,
    };
    answersBySession.set(answer.session_id, bucket);
  }

  const counts = (sessions ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[row.state] = (acc[row.state] ?? 0) + 1;
    return acc;
  }, {});
  const savedQuestions = questions ?? [];
  const answerRows = answers ?? [];
  const funnel = funnelFromSessions(
    (sessions ?? []).map((session) => ({
      state: session.state as string,
      first_answer_at: (session.first_answer_at as string | null) ?? null,
    })),
  );
  const participation = participationSlices(funnel);

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
            {survey.is_test ? <Badge>Test</Badge> : null}
          </div>
        </div>
        <SmsSurveyFlowChart
          questions={flowFromSaved(
            savedQuestions.map((question) => ({
              id: question.id,
              prompt: question.prompt,
              qtype: question.qtype,
              branching: question.branching,
            })),
          )}
          markerId="survey-detail-flow"
        />
        <SurveyReportDashboard
          status={survey.status}
          invited={funnel.ever_invited_count}
          started={funnel.started_count}
          completed={funnel.completed_count}
          participation={participation}
          questions={savedQuestions.map((question) => {
            const mine = answerRows.filter((answer) => answer.question_id === question.id);
            return {
              id: question.id,
              prompt: question.prompt,
              qtype: question.qtype,
              slices: questionSlices(
                {
                  question_id: question.id,
                  qtype: question.qtype as SmsSurveyQuestionType,
                  options: question.options,
                },
                mine.map((answer) => ({
                  question_id: answer.question_id,
                  parsed_value: answer.parsed_value,
                })),
              ),
              answered: mine.filter((answer) => answer.parsed_value != null || answer.raw_body).length,
              unparsed: mine.filter((answer) => answer.parsed_value == null && answer.raw_body).length,
            };
          })}
        />
        <Card>
          <CardHeader>
            <CardTitle>Questions</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              {(questions ?? []).map((q) => (
                <li key={q.id}>
                  <span className="font-medium">{q.prompt}</span>{" "}
                  <span className="text-muted-foreground">
                    ({q.qtype}
                    {q.branching ? ", branched" : ""})
                  </span>
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
            {survey.is_test ? (
              <p className="text-sm">
                Test mode is on. Launch ignores the audience picker and texts the test roster only.
              </p>
            ) : null}
            <SurveyLaunchForm
              surveyId={survey.id}
              status={survey.status}
              numbers={numbers ?? []}
              lists={lists ?? []}
            />
            <SurveyOps
              surveyId={survey.id}
              status={survey.status}
              csv={surveyAnswersToWideCsv({
                questions: (questions ?? []).map((question) => ({
                  id: question.id,
                  prompt: question.prompt,
                  sort_order: question.sort_order,
                })),
                respondents: (sessions ?? []).map((session) => {
                  const contact = session.contacts as
                    | { first_name: string | null; last_name: string | null }
                    | { first_name: string | null; last_name: string | null }[]
                    | null;
                  const person = Array.isArray(contact) ? contact[0] : contact;
                  return {
                    name: [person?.first_name, person?.last_name].filter(Boolean).join(" "),
                    phone: session.phone_e164,
                    state: session.state,
                    answers: answersBySession.get(session.id) ?? {},
                  };
                }),
              })}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Answers</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">Person</th>
                  <th className="py-2 pr-3 font-medium">State</th>
                  {(questions ?? []).map((question) => (
                    <th key={question.id} className="py-2 pr-3 font-medium">
                      {question.prompt}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(sessions ?? []).map((session) => {
                  const contact = session.contacts as
                    | { first_name: string | null; last_name: string | null }
                    | { first_name: string | null; last_name: string | null }[]
                    | null;
                  const person = Array.isArray(contact) ? contact[0] : contact;
                  const name = [person?.first_name, person?.last_name].filter(Boolean).join(" ");
                  const byQuestion = answersBySession.get(session.id) ?? {};
                  return (
                    <tr key={session.id} className="border-t border-border">
                      <td className="py-2 pr-3">
                        {name || toDisplay(session.phone_e164)}
                      </td>
                      <td className="py-2 pr-3">{session.state}</td>
                      {(questions ?? []).map((question) => (
                        <td key={question.id} className="py-2 pr-3">
                          {byQuestion[question.id]?.raw_body ||
                            byQuestion[question.id]?.parsed_value ||
                            "—"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!sessions?.length ? (
              <p className="text-sm text-muted-foreground">No sessions yet.</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </AppPage>
  );
}
