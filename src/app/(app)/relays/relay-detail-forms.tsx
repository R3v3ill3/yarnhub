"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { composeForwardBody } from "@/lib/sms/relay-engine";
import {
  addRelayTarget,
  setRelayStatus,
  setRelayTargetActive,
  updateRelay,
} from "./actions";

export function RelayDetailForms(props: {
  relayId: string;
  status: string;
  prefixTemplate: string;
  suffixTemplate: string | null;
  quietHoursRespected: boolean;
  targets: Array<{
    id: string;
    phone_e164: string;
    display_name: string | null;
    is_active: boolean;
  }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [prefix, setPrefix] = useState(props.prefixTemplate);
  const [suffix, setSuffix] = useState(props.suffixTemplate ?? "");
  const [quietHours, setQuietHours] = useState(props.quietHoursRespected);
  const ended = props.status === "ended";

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

  async function run(
    key: string,
    fn: (formData: FormData) => Promise<{ error?: string }>,
    formData: FormData,
  ) {
    setPending(key);
    setError(null);
    const result = await fn(formData);
    setPending(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error ? <Alert variant="destructive">{error}</Alert> : null}

      {!ended ? (
        <form
          action={(formData) => {
            if (quietHours) formData.set("quiet_hours_respected", "on");
            return run("save", updateRelay, formData);
          }}
          className="space-y-3"
        >
          <input type="hidden" name="relayId" value={props.relayId} />
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
            <Label htmlFor="suffix_template">Suffix</Label>
            <Textarea
              id="suffix_template"
              name="suffix_template"
              rows={2}
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
            />
          </div>
          <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-sm">
            {preview}
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={quietHours}
              onChange={(e) => setQuietHours(e.target.checked)}
              className="mt-1"
            />
            <span>Hold member forwards outside 09:00–20:00</span>
          </label>
          <Button type="submit" variant="outline" disabled={pending !== null}>
            {pending === "save" ? "Saving…" : "Save templates"}
          </Button>
        </form>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {props.status === "paused" ? (
          <form
            action={(formData) => run("activate", setRelayStatus, formData)}
          >
            <input type="hidden" name="relayId" value={props.relayId} />
            <input type="hidden" name="action" value="activate" />
            <Button type="submit" disabled={pending !== null}>
              Activate
            </Button>
          </form>
        ) : null}
        {props.status === "active" ? (
          <form action={(formData) => run("pause", setRelayStatus, formData)}>
            <input type="hidden" name="relayId" value={props.relayId} />
            <input type="hidden" name="action" value="pause" />
            <Button type="submit" variant="outline" disabled={pending !== null}>
              Pause
            </Button>
          </form>
        ) : null}
        {props.status !== "ended" ? (
          <form action={(formData) => run("end", setRelayStatus, formData)}>
            <input type="hidden" name="relayId" value={props.relayId} />
            <input type="hidden" name="action" value="end" />
            <Button type="submit" variant="destructive" disabled={pending !== null}>
              End relay
            </Button>
          </form>
        ) : null}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Targets</h3>
        {!props.targets.length ? (
          <p className="text-sm text-muted-foreground">No targets yet.</p>
        ) : (
          <ul className="space-y-2">
            {props.targets.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span>
                  {t.display_name ? `${t.display_name} · ` : ""}
                  {t.phone_e164}
                  {!t.is_active ? " (inactive)" : ""}
                </span>
                {!ended ? (
                  <form
                    action={(formData) => run(`target-${t.id}`, setRelayTargetActive, formData)}
                  >
                    <input type="hidden" name="relayId" value={props.relayId} />
                    <input type="hidden" name="targetId" value={t.id} />
                    <input type="hidden" name="is_active" value={t.is_active ? "false" : "true"} />
                    <Button type="submit" size="sm" variant="outline" disabled={pending !== null}>
                      {t.is_active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {!ended ? (
          <form
            action={(formData) => run("add-target", addRelayTarget, formData)}
            className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
          >
            <input type="hidden" name="relayId" value={props.relayId} />
            <Input name="phone" required placeholder="Target mobile" />
            <Input name="display_name" placeholder="Display name" />
            <Button type="submit" variant="outline" disabled={pending !== null}>
              Add
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
