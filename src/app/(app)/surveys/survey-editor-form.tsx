"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SURVEY_QUESTION_SOFT_CAP, renderInvitation } from "@/lib/sms/survey-engine";
import type { SmsSurveyQuestionRow } from "@/types/sms";
import { createSurvey } from "./actions";
import type { SmsSurveyQuestionType } from "@/types/sms";

type DraftQuestion = {
  prompt: string;
  qtype: SmsSurveyQuestionType;
  options: string;
  yesGoto: string;
  noGoto: string;
};

function previewQuestion(question: DraftQuestion, index: number): SmsSurveyQuestionRow {
  const options =
    question.qtype === "choice"
      ? question.options
          .split(",")
          .map((label) => label.trim())
          .filter(Boolean)
          .map((label, optionIndex) => ({
            value: label.toLowerCase().replace(/\s+/g, "_") || `opt_${optionIndex + 1}`,
            label,
          }))
      : question.qtype === "scale"
        ? { min: 1, max: 5 }
        : null;
  return {
    question_id: String(index),
    survey_id: "draft",
    sort_order: index,
    prompt: question.prompt || "Question",
    qtype: question.qtype,
    options,
    branching: null,
    write_rating: false,
    activity_id: null,
    invalid_prompt: null,
    nudge_text: null,
    retired_at: null,
    created_at: "",
    updated_at: "",
  };
}

export function SurveyEditorForm(props: { orgName: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [questions, setQuestions] = useState<DraftQuestion[]>([
    { prompt: "", qtype: "yes_no", options: "", yesGoto: "next", noGoto: "next" },
  ]);
  const [invitation, setInvitation] = useState(
    `Hi {{first_name}}, ${props.orgName} has a few quick questions. Reply STOP to opt out.`,
  );

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    formData.set("questionCount", String(questions.length));
    questions.forEach((q, i) => {
      formData.set(`q_${i}_prompt`, q.prompt);
      formData.set(`q_${i}_qtype`, q.qtype);
      formData.set(`q_${i}_options`, q.options);
      formData.set(`q_${i}_yes_goto`, q.yesGoto);
      formData.set(`q_${i}_no_goto`, q.noGoto);
    });
    const result = await createSurvey(formData);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.surveyId) router.push(`/surveys/${result.surveyId}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New survey</CardTitle>
        <CardDescription>
          Linear questions. Invitation and question 1 go out as one SMS. Prefer a
          survey-purpose number so replies stay in the session.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={onSubmit} className="space-y-4">
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" required placeholder="Site visit follow-up" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invitation_body">Invitation (sent with question 1)</Label>
            <Textarea
              id="invitation_body"
              name="invitation_body"
              rows={3}
              value={invitation}
              onChange={(event) => setInvitation(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="completion_body">Completion message (optional)</Label>
            <Textarea id="completion_body" name="completion_body" rows={2} />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Questions</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={questions.length >= SURVEY_QUESTION_SOFT_CAP + 3}
                onClick={() =>
                  setQuestions((current) => [
                    ...current,
                    { prompt: "", qtype: "yes_no", options: "", yesGoto: "next", noGoto: "next" },
                  ])
                }
              >
                Add question
              </Button>
            </div>
            {questions.length > SURVEY_QUESTION_SOFT_CAP ? (
              <Alert>More than {SURVEY_QUESTION_SOFT_CAP} questions tends to drop completion.</Alert>
            ) : null}
            {questions.map((q, i) => (
              <div key={i} className="space-y-2 rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Q{i + 1}</p>
                  {questions.length > 1 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setQuestions((current) => current.filter((_, idx) => idx !== i))
                      }
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
                <Textarea
                  required
                  rows={2}
                  placeholder="Question prompt"
                  value={q.prompt}
                  onChange={(e) =>
                    setQuestions((current) =>
                      current.map((row, idx) =>
                        idx === i ? { ...row, prompt: e.target.value } : row,
                      ),
                    )
                  }
                />
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={q.qtype}
                  onChange={(e) =>
                    setQuestions((current) =>
                      current.map((row, idx) =>
                        idx === i
                          ? { ...row, qtype: e.target.value as SmsSurveyQuestionType }
                          : row,
                      ),
                    )
                  }
                >
                  <option value="yes_no">Yes / no</option>
                  <option value="choice">Choice</option>
                  <option value="scale">Scale 1–5</option>
                  <option value="open_text">Open text</option>
                </select>
                {q.qtype === "choice" ? (
                  <Input
                    placeholder="Options, comma-separated"
                    value={q.options}
                    onChange={(e) =>
                      setQuestions((current) =>
                        current.map((row, idx) =>
                          idx === i ? { ...row, options: e.target.value } : row,
                        ),
                      )
                    }
                  />
                ) : null}
                {q.qtype === "yes_no" ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(["yesGoto", "noGoto"] as const).map((field) => (
                      <label key={field} className="space-y-1 text-xs">
                        <span>{field === "yesGoto" ? "If yes, go to" : "If no, go to"}</span>
                        <select
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                          value={q[field]}
                          onChange={(event) =>
                            setQuestions((current) =>
                              current.map((row, idx) =>
                                idx === i ? { ...row, [field]: event.target.value } : row,
                              ),
                            )
                          }
                        >
                          <option value="next">Next question</option>
                          <option value="end">End survey</option>
                          {questions.map((_, target) =>
                            target === i ? null : (
                              <option key={target} value={String(target)}>
                                Question {target + 1}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="retry_limit">Retries</Label>
              <Input id="retry_limit" name="retry_limit" type="number" min={0} max={5} defaultValue={2} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="question_timeout_minutes">Question timeout (minutes)</Label>
              <Input
                id="question_timeout_minutes"
                name="question_timeout_minutes"
                type="number"
                min={1}
                defaultValue={120}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="session_ttl_hours">Session lifetime (hours)</Label>
              <Input id="session_ttl_hours" name="session_ttl_hours" type="number" min={1} defaultValue={72} />
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="is_test" className="mt-1" defaultChecked />
            <span>
              Test mode. Launch sends only to the test roster (25 people maximum), never the
              full contact list.
            </span>
          </label>
          <div className="rounded-md border border-dashed border-border bg-secondary/30 p-3 text-sm">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Preview of the first text
            </p>
            <pre className="whitespace-pre-wrap font-sans">
              {renderInvitation(invitation, previewQuestion(questions[0], 0))}
            </pre>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save draft"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
