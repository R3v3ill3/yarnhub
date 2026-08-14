"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { INSERT_VARIABLES } from "@/lib/comms/template-variables";
import { countSegmentsWorstCase } from "@/lib/sms/segments";
import { filterInboxSafeSenders } from "@/lib/sms/sender-purpose";
import { queueBlast } from "./actions";
import { toDisplay } from "@/lib/phone/normalise-phone";

type NumberRow = {
  id: string;
  phone_e164: string;
  purpose: string;
  status: string;
  label: string | null;
};

export function BlastComposeForm(props: {
  orgName: string;
  numbers: NumberRow[];
  lists: Array<{ id: string; name: string }>;
  eligibleCount: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [body, setBody] = useState(
    `Hi {{first_name}}, this is ${props.orgName}. Reply STOP to opt out.`,
  );
  const [override, setOverride] = useState(false);
  const [pending, setPending] = useState(false);
  const [audience, setAudience] = useState<"all" | "list">("all");

  const senders = filterInboxSafeSenders(
    props.numbers.filter((n) => n.status === "active"),
  );
  const segments = useMemo(() => countSegmentsWorstCase(body), [body]);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    if (warning) formData.set("confirmWarning", "1");
    const result = await queueBlast(formData);
    setPending(false);
    if (result.warning) {
      setWarning(result.warning);
      return;
    }
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.blastId) router.push(`/blasts/${result.blastId}`);
  }

  function insertToken(token: string) {
    setBody((current) => `${current}${current.endsWith(" ") || current.length === 0 ? "" : " "}${token}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compose blast</CardTitle>
        <CardDescription>
          Queued messages send in the 09:00–20:00 window for {props.orgName} unless you
          record a blackout override.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={onSubmit} className="space-y-4">
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          {warning ? (
            <Alert>
              {warning} Submit again to queue anyway.
            </Alert>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="name">Internal name (optional)</Label>
            <Input id="name" name="name" placeholder="August update" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="numberId">Send from</Label>
            <select
              id="numberId"
              name="numberId"
              required
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              defaultValue={senders[0]?.id ?? ""}
            >
              {senders.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label || toDisplay(n.phone_e164)} ({n.purpose})
                </option>
              ))}
            </select>
            {!senders.length ? (
              <p className="text-sm text-muted-foreground">
                Register an inbox or spare number in Settings first.
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
                All contacts who can receive SMS ({props.eligibleCount})
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
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="body">Message</Label>
              <p className="text-xs text-muted-foreground">
                {segments.encoding} · {segments.segments} part{segments.segments === 1 ? "" : "s"} ·{" "}
                {segments.length}/{segments.perSegment} (worst-case merge)
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {INSERT_VARIABLES.map((token) => (
                <Button
                  key={token}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => insertToken(token)}
                >
                  {token}
                </Button>
              ))}
            </div>
            <Textarea
              id="body"
              name="body"
              rows={6}
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="blackout_override"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
              className="mt-1"
            />
            <span>Send outside 09:00–20:00 (record a reason)</span>
          </label>
          {override ? (
            <div className="space-y-2">
              <Label htmlFor="blackout_override_reason">Override reason</Label>
              <Input
                id="blackout_override_reason"
                name="blackout_override_reason"
                required={override}
                minLength={8}
                placeholder="Urgent safety notice"
              />
            </div>
          ) : null}
          <Button type="submit" disabled={pending || !senders.length}>
            {pending ? "Queueing…" : warning ? "Queue anyway" : "Queue blast"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
