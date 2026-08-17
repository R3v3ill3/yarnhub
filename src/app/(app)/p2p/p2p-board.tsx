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
import { toDisplay } from "@/lib/phone/normalise-phone";
import {
  P2P_SEND_CAP,
  filterP2pItems,
  isP2pSendable,
  pruneP2pSelection,
  selectNextN,
  type P2pBoardItemLike,
} from "@/lib/sms/p2p";
import { countSegmentsWorstCase } from "@/lib/sms/segments";
import { filterInboxSafeSenders } from "@/lib/sms/sender-purpose";
import { queueP2pSend } from "./actions";

type NumberRow = {
  id: string;
  phone_e164: string;
  purpose: string;
  status: string;
  label: string | null;
};

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone_e164: string;
  sms_opt_out: boolean;
};

function toBoardItem(c: ContactRow): P2pBoardItemLike {
  return {
    item_id: c.id,
    status: "pending",
    worker_name: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.phone_e164,
    employer_name: null,
    phone_e164: c.phone_e164,
    sms_opt_out: c.sms_opt_out,
  };
}

export function P2pBoard(props: {
  orgName: string;
  numbers: NumberRow[];
  contacts: ContactRow[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [body, setBody] = useState(
    `Hi {{first_name}}, it's ${props.orgName}. Reply STOP to opt out.`,
  );
  const [override, setOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const items = props.contacts.map(toBoardItem);
  const filtered = filterP2pItems(items, { search, status: "all" });
  const pruned = pruneP2pSelection(items, selected);
  const senders = filterInboxSafeSenders(props.numbers.filter((n) => n.status === "active"));
  const segments = useMemo(() => countSegmentsWorstCase(body), [body]);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    if (warning) formData.set("confirmWarning", "1");
    for (const id of pruned) formData.append("contactId", String(id));
    const result = await queueP2pSend(formData);
    setPending(false);
    if (result.warning) {
      setWarning(result.warning);
      return;
    }
    if (result.error) {
      setError(result.error);
      return;
    }
    setSelected(new Set());
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <Card>
        <CardHeader>
          <CardTitle>Working list</CardTitle>
          <CardDescription>
            Select up to {P2P_SEND_CAP} people. After send, replies land in Inbox.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder="Search name or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSelected(selectNextN(filtered, pruned, 10))}
            >
              Select next 10
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
            <span className="self-center text-sm text-muted-foreground">
              {pruned.size} selected
            </span>
          </div>
          <div className="max-h-[28rem] overflow-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium"> </th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Phone</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const id = String(item.item_id);
                  const sendable = isP2pSendable(item);
                  return (
                    <tr key={id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          disabled={!sendable}
                          checked={pruned.has(id)}
                          onChange={(e) => {
                            const next = new Set(pruned);
                            if (e.target.checked) {
                              if (next.size >= P2P_SEND_CAP) return;
                              next.add(id);
                            } else {
                              next.delete(id);
                            }
                            setSelected(next);
                          }}
                        />
                      </td>
                      <td className="px-3 py-2">{item.worker_name}</td>
                      <td className="px-3 py-2 font-mono">
                        {item.phone_e164 ? toDisplay(item.phone_e164) : "—"}
                        {item.sms_opt_out ? (
                          <span className="ml-2 text-muted-foreground">opted out</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {!filtered.length ? (
                  <tr>
                    <td className="px-3 py-6 text-muted-foreground" colSpan={3}>
                      No contacts match.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Personalised opener</CardTitle>
          <CardDescription>
            Merge fields resolve per contact. 1:1 replies after this are never blackout-blocked.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={onSubmit} className="space-y-4">
            {error ? <Alert variant="destructive">{error}</Alert> : null}
            {warning ? <Alert>{warning} Submit again to send anyway.</Alert> : null}
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
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="body">Opener</Label>
                <p className="text-xs text-muted-foreground">
                  {segments.encoding} · {segments.segments} part{segments.segments === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {INSERT_VARIABLES.map((token) => (
                  <Button
                    key={token}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setBody((current) =>
                        `${current}${current.endsWith(" ") || current.length === 0 ? "" : " "}${token}`,
                      )
                    }
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
                />
              </div>
            ) : null}
            <Button type="submit" disabled={pending || !senders.length || pruned.size === 0}>
              {pending ? "Sending…" : warning ? "Send anyway" : `Send to ${pruned.size}`}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
