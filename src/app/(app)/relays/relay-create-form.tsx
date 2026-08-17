"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toDisplay } from "@/lib/phone/normalise-phone";
import {
  DEFAULT_RELAY_PREFIX_TEMPLATE,
  composeForwardBody,
} from "@/lib/sms/relay-engine";
import { filterRelaySenders } from "@/lib/sms/sender-purpose";
import { createRelay } from "./actions";

type NumberRow = {
  id: string;
  phone_e164: string;
  purpose: string;
  status: string;
  label: string | null;
};

type DraftTarget = { phone: string; display_name: string };

export function RelayCreateForm(props: {
  numbers: NumberRow[];
  occupiedNumberIds: string[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [prefix, setPrefix] = useState(DEFAULT_RELAY_PREFIX_TEMPLATE);
  const [suffix, setSuffix] = useState("");
  const [targets, setTargets] = useState<DraftTarget[]>([{ phone: "", display_name: "" }]);
  const [quietHours, setQuietHours] = useState(true);

  const occupied = new Set(props.occupiedNumberIds);
  const senders = filterRelaySenders(
    props.numbers.filter((n) => n.status === "active" && !occupied.has(n.id)),
  );

  const preview = useMemo(
    () =>
      composeForwardBody({
        prefixTemplate: prefix,
        suffixTemplate: suffix,
        memberBody: "Can you help with this?",
        context: { first_name: "Alex", last_name: "Mitchell", employer_name: "" },
      }),
    [prefix, suffix],
  );

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    if (quietHours) formData.set("quiet_hours_respected", "on");
    for (const t of targets) {
      formData.append("target_phone", t.phone);
      formData.append("target_name", t.display_name);
    }
    const result = await createRelay(formData);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.relayId) router.push(`/relays/${result.relayId}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New relay</CardTitle>
        <CardDescription>
          Created paused. Activate on the next screen when the targets are ready.
          Relays only send from numbers whose purpose is relay.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={onSubmit} className="space-y-4">
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required placeholder="MP office patch" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="numberId">Relay number</Label>
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
                </option>
              ))}
            </select>
            {!senders.length ? (
              <p className="text-sm text-muted-foreground">
                No free relay-purpose numbers. In Settings, register or set a number
                to purpose “relay”. One live relay per number.
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="prefix_template">Attribution prefix</Label>
            <Input
              id="prefix_template"
              name="prefix_template"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="suffix_template">Suffix (optional)</Label>
            <Textarea
              id="suffix_template"
              name="suffix_template"
              rows={2}
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
            />
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
            <p className="mb-1 text-xs text-muted-foreground">Preview (what the target receives)</p>
            {preview}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={quietHours}
              onChange={(e) => setQuietHours(e.target.checked)}
              className="mt-1"
            />
            <span>Hold member forwards outside 09:00–20:00 (cron drains later)</span>
          </label>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Targets</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setTargets((current) => [...current, { phone: "", display_name: "" }])
                }
              >
                Add target
              </Button>
            </div>
            {targets.map((t, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-2">
                <Input
                  placeholder="0412 000 000"
                  value={t.phone}
                  onChange={(e) =>
                    setTargets((current) =>
                      current.map((row, idx) =>
                        idx === i ? { ...row, phone: e.target.value } : row,
                      ),
                    )
                  }
                />
                <Input
                  placeholder="Display name"
                  value={t.display_name}
                  onChange={(e) =>
                    setTargets((current) =>
                      current.map((row, idx) =>
                        idx === i ? { ...row, display_name: e.target.value } : row,
                      ),
                    )
                  }
                />
              </div>
            ))}
          </div>
          <Button type="submit" disabled={pending || !senders.length}>
            {pending ? "Saving…" : "Create paused"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
