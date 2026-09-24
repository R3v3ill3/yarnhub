"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BLAST_COHORT_LABELS, type BlastCohort } from "@/lib/sms/reporting-cohorts";
import { createBlastCohortList, setBlastLifecycle } from "./actions";

export function BlastOps(props: { blastId: string; status: string; csv: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onLifecycle(action: string) {
    setPending(true);
    setError(null);
    const formData = new FormData();
    formData.set("blastId", props.blastId);
    formData.set("action", action);
    const result = await setBlastLifecycle(formData);
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
    formData.set("blastId", props.blastId);
    const result = await createBlastCohortList(formData);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setMessage("List saved. Open Contacts to edit who is on it.");
    router.refresh();
  }

  function download() {
    const blob = new Blob([props.csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "blast-items.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {message ? <Alert>{message}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        {props.status === "draft" || props.status === "paused" ? (
          <Button type="button" size="sm" disabled={pending} onClick={() => onLifecycle("resume")}>
            {props.status === "draft" ? "Queue" : "Resume"}
          </Button>
        ) : null}
        {props.status === "queued" || props.status === "sending" ? (
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => onLifecycle("pause")}>
            Pause
          </Button>
        ) : null}
        {props.status !== "sent" && props.status !== "cancelled" ? (
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => onLifecycle("cancel")}>
            Cancel
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="secondary" onClick={download}>
          Export CSV
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => onLifecycle("archive")}>
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
            defaultValue="failed"
          >
            {(Object.keys(BLAST_COHORT_LABELS) as BlastCohort[]).map((cohort) => (
              <option key={cohort} value={cohort}>
                {BLAST_COHORT_LABELS[cohort]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2 sm:flex-1">
          <Label htmlFor="list_name">List name</Label>
          <Input id="list_name" name="list_name" placeholder="Failed — site visit" />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Save list
        </Button>
      </form>
    </div>
  );
}
