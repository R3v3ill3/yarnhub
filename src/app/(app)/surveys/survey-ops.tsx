"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SURVEY_COHORT_LABELS, type SurveyCohort } from "@/lib/sms/reporting-cohorts";
import { archiveSurvey, createSurveyCohortList } from "./actions";

export function SurveyOps(props: { surveyId: string; status: string; csv: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onArchive() {
    setPending(true);
    setError(null);
    const formData = new FormData();
    formData.set("surveyId", props.surveyId);
    const result = await archiveSurvey(formData);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function onList(formData: FormData) {
    setPending(true);
    setError(null);
    formData.set("surveyId", props.surveyId);
    const result = await createSurveyCohortList(formData);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setMessage("List saved. Open Contacts to edit who is on it.");
  }

  function download() {
    const blob = new Blob([props.csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "survey-answers.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3 border-t border-border pt-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {message ? <Alert>{message}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={download}>
          Export answers CSV
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onArchive}>
          Archive
        </Button>
      </div>
      <form action={onList} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="cohort">Create list from</Label>
          <select
            id="cohort"
            name="cohort"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            defaultValue="completed"
          >
            {(Object.keys(SURVEY_COHORT_LABELS) as SurveyCohort[]).map((cohort) => (
              <option key={cohort} value={cohort}>
                {SURVEY_COHORT_LABELS[cohort]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2 sm:flex-1">
          <Label htmlFor="list_name">List name</Label>
          <Input id="list_name" name="list_name" placeholder="Completed the survey" />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={pending || props.status === "draft"}>
          Save list
        </Button>
      </form>
    </div>
  );
}
