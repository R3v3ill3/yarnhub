"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toDisplay } from "@/lib/phone/normalise-phone";
import {
  filterSurveySenders,
  surveySenderPurposeHint,
  surveySenderSortKey,
} from "@/lib/sms/sender-purpose";
import { closeSurvey, launchSurvey, pauseSurvey } from "./actions";

type NumberRow = {
  id: string;
  phone_e164: string;
  purpose: string;
  status: string;
  label: string | null;
};

export function SurveyLaunchForm(props: {
  surveyId: string;
  status: string;
  numbers: NumberRow[];
  lists: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [overlap, setOverlap] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [audience, setAudience] = useState<"all" | "list">("all");
  const [override, setOverride] = useState(false);

  const senders = filterSurveySenders(props.numbers.filter((n) => n.status === "active")).sort(
    (a, b) => surveySenderSortKey(a) - surveySenderSortKey(b),
  );
  const canLaunch = props.status === "draft" || props.status === "paused";

  async function onLaunch(formData: FormData) {
    setPending(true);
    setError(null);
    setNotice(null);
    if (overlap) formData.set("confirmOverlap", "1");
    const result = await launchSurvey(formData);
    setPending(false);
    if (result.overlap) {
      setOverlap(result.overlap);
      return;
    }
    if (result.error) {
      setError(result.error);
      return;
    }
    setOverlap(null);
    setNotice(
      [
        result.invited != null ? `Invited ${result.invited}.` : null,
        result.warning,
      ]
        .filter(Boolean)
        .join(" "),
    );
    router.refresh();
  }

  async function onPause(formData: FormData) {
    setPending(true);
    const result = await pauseSurvey(formData);
    setPending(false);
    if (result.error) setError(result.error);
    else router.refresh();
  }

  async function onClose(formData: FormData) {
    setPending(true);
    const result = await closeSurvey(formData);
    setPending(false);
    if (result.error) setError(result.error);
    else router.refresh();
  }

  return (
    <div className="space-y-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {notice ? <Alert>{notice}</Alert> : null}
      {overlap ? <Alert>{overlap}</Alert> : null}

      {canLaunch ? (
        <form action={onLaunch} className="space-y-4">
          <input type="hidden" name="surveyId" value={props.surveyId} />
          <div className="space-y-2">
            <Label htmlFor="numberId">Sender</Label>
            <select
              id="numberId"
              name="numberId"
              required
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              defaultValue={senders[0]?.id ?? ""}
            >
              {senders.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label || toDisplay(n.phone_e164)}
                  {surveySenderPurposeHint(n.purpose)}
                </option>
              ))}
            </select>
            {!senders.length ? (
              <p className="text-sm text-muted-foreground">
                Register a survey or inbox number in Settings. Relay numbers are excluded.
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label>Audience</Label>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="audience"
                  value="all"
                  checked={audience === "all"}
                  onChange={() => setAudience("all")}
                />
                All contacts
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="audience"
                  value="list"
                  checked={audience === "list"}
                  onChange={() => setAudience("list")}
                  disabled={!props.lists.length}
                />
                A saved list
              </label>
            </div>
            {audience === "list" ? (
              <select
                name="listId"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {props.lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="blackout_override"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
              className="mt-1"
            />
            <span>Send invitations outside 09:00–20:00</span>
          </label>
          {override ? (
            <Input
              name="blackout_override_reason"
              required={override}
              minLength={8}
              placeholder="Override reason"
            />
          ) : null}
          <Button type="submit" disabled={pending || !senders.length}>
            {pending ? "Launching…" : overlap ? "Launch anyway" : "Launch"}
          </Button>
        </form>
      ) : null}

      {props.status === "open" ? (
        <form action={onPause} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="surveyId" value={props.surveyId} />
          <div className="space-y-1">
            <Label htmlFor="pause_mode">Pause</Label>
            <select
              id="pause_mode"
              name="pause_mode"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              defaultValue="soft"
            >
              <option value="soft">Soft (still accept answers)</option>
              <option value="hard">Hard (tell people to wait)</option>
            </select>
          </div>
          <Button type="submit" variant="outline" disabled={pending}>
            Pause
          </Button>
        </form>
      ) : null}

      {props.status !== "closed" ? (
        <form action={onClose}>
          <input type="hidden" name="surveyId" value={props.surveyId} />
          <Button type="submit" variant="destructive" disabled={pending}>
            Close survey
          </Button>
        </form>
      ) : null}
    </div>
  );
}
