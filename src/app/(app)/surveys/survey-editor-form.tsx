"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SURVEY_QUESTION_SOFT_CAP } from "@/lib/sms/survey-engine";
import { createSurvey } from "./actions";
import type { SmsSurveyQuestionType } from "@/types/sms";

type DraftQuestion = {
  prompt: string;
  qtype: SmsSurveyQuestionType;
  options: string;
};

export function SurveyEditorForm(props: { orgName: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [questions, setQuestions] = useState<DraftQuestion[]>([
    { prompt: "", qtype: "yes_no", options: "" },
  ]);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    formData.set("questionCount", String(questions.length));
    questions.forEach((q, i) => {
      formData.set(`q_${i}_prompt`, q.prompt);
      formData.set(`q_${i}_qtype`, q.qtype);
      formData.set(`q_${i}_options`, q.options);
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
              defaultValue={`Hi {{first_name}}, ${props.orgName} has a few quick questions. Reply STOP to opt out.`}
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
                    { prompt: "", qtype: "yes_no", options: "" },
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
              </div>
            ))}
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save draft"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
