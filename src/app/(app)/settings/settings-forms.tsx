"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Badge } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { attachNumber, saveProviderCredentials, sendTestSms, updateNumberPurpose } from "./actions";
import type { Organisation } from "@/lib/supabase/types";

type NumberRow = {
  id: string;
  phone_e164: string;
  purpose: string;
  status: string;
  label: string | null;
};

export function SettingsForms(props: {
  org: Organisation;
  canAdmin: boolean;
  sendingMode: "byo" | "hosted" | null;
  webhookUrl: string;
  hostedWebhookUrl: string;
  connected: boolean;
  hasWebhookSecret: boolean;
  lastVerifiedAt: string | null;
  mockProvider: boolean;
  numbers: NumberRow[];
}) {
  const router = useRouter();
  const [credError, setCredError] = useState<string | null>(null);
  const [credOk, setCredOk] = useState<string | null>(null);
  const [numberError, setNumberError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function onSaveCredentials(formData: FormData) {
    setPending("creds");
    setCredError(null);
    setCredOk(null);
    const result = await saveProviderCredentials(formData);
    setPending(null);
    if (result.error) {
      setCredError(result.error);
      return;
    }
    const senderList = (result.senders ?? []).map((s) => s.sender).join(", ") || "none listed";
    setCredOk(
      `Verified. Balance ${result.balance ?? 0}. Senders: ${senderList}.`,
    );
    router.refresh();
  }

  async function onAttach(formData: FormData) {
    setPending("number");
    setNumberError(null);
    const result = await attachNumber(formData);
    setPending(null);
    if (result.error) {
      setNumberError(result.error);
      return;
    }
    router.refresh();
  }

  async function onPurpose(formData: FormData) {
    setPending("purpose");
    setNumberError(null);
    const result = await updateNumberPurpose(formData);
    setPending(null);
    if (result.error) {
      setNumberError(result.error);
      return;
    }
    router.refresh();
  }

  async function onTestSend(formData: FormData) {
    setPending("send");
    setSendError(null);
    const result = await sendTestSms(formData);
    setPending(null);
    if (result.error) {
      setSendError(result.error);
      return;
    }
    if (result.conversationId) {
      router.push(`/inbox/${result.conversationId}`);
      router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      {props.mockProvider ? (
        <Alert>
          <code className="font-mono text-xs">SMS_PROVIDER=mock</code> — sends stay
          in-memory on this server. Use the thread “simulate reply” control to prove
          inbound without Mobile Message.
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>1. Mobile Message credentials</CardTitle>
          <CardDescription>
            Paste the API username and password from your Mobile Message dashboard.
            They are encrypted at rest with <code>SMS_CREDENTIALS_KEY</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={onSaveCredentials} className="space-y-4">
            {credError ? <Alert variant="destructive">{credError}</Alert> : null}
            {credOk ? <Alert>{credOk}</Alert> : null}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={props.connected ? "default" : "outline"}>
                {props.connected ? "Connected" : "Not connected"}
              </Badge>
              {props.hasWebhookSecret ? (
                <Badge variant="secondary">Webhook secret saved</Badge>
              ) : null}
              {props.lastVerifiedAt ? (
                <span className="text-muted-foreground">
                  Last verified {new Date(props.lastVerifiedAt).toLocaleString()}
                </span>
              ) : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="username">API username</Label>
                <Input id="username" name="username" autoComplete="off" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">API password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhookSecret">Webhook HMAC secret (optional in mock)</Label>
              <Input
                id="webhookSecret"
                name="webhookSecret"
                type="password"
                autoComplete="off"
                placeholder={props.hasWebhookSecret ? "Leave blank to keep the saved secret" : ""}
              />
            </div>
            <Button type="submit" disabled={pending === "creds" || !props.canAdmin}>
              {pending === "creds" ? "Verifying…" : "Save and verify"}
            </Button>
            {!props.canAdmin ? (
              <p className="text-sm text-muted-foreground">Only owners and admins can change credentials.</p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Dedicated number</CardTitle>
          <CardDescription>
            Buy the number in the Mobile Message dashboard, then register it here.
            There is no purchase API.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {props.numbers.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {props.numbers.map((n) => (
                <li
                  key={n.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <span className="font-mono">{n.phone_e164}</span>
                  <span className="text-muted-foreground">
                    {n.label ? `${n.label} · ` : ""}
                    {n.status}
                  </span>
                  <form action={onPurpose} className="flex items-center gap-2">
                    <input type="hidden" name="numberId" value={n.id} />
                    <select
                      name="purpose"
                      defaultValue={n.purpose}
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="inbox">inbox</option>
                      <option value="survey">survey</option>
                      <option value="relay">relay</option>
                      <option value="spare">spare</option>
                    </select>
                    <Button type="submit" size="sm" variant="outline" disabled={pending === "purpose" || !props.canAdmin}>
                      Save
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No numbers registered yet.</p>
          )}
          <form action={onAttach} className="grid gap-4 sm:grid-cols-2">
            {numberError ? (
              <div className="sm:col-span-2">
                <Alert variant="destructive">{numberError}</Alert>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="phone">Number</Label>
              <Input id="phone" name="phone" placeholder="0485 900 180" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="label">Label (optional)</Label>
              <Input id="label" name="label" placeholder="Inbox" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="purpose">Purpose</Label>
              <select
                id="purpose"
                name="purpose"
                defaultValue="inbox"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="inbox">Inbox / P2P / blast</option>
                <option value="survey">Survey</option>
                <option value="relay">Relay</option>
                <option value="spare">Spare</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={pending === "number" || !props.connected || !props.canAdmin}>
                {pending === "number" ? "Saving…" : "Register number"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Webhook URL</CardTitle>
          <CardDescription>
            Paste this as the inbound and status URL in Mobile Message (one URL per
            account). The <code>org</code> query is how Yarnhub multiplexes BYO accounts.
            Hosted numbers use the platform URL without <code>?org=</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">BYO (this organisation)</p>
            <p className="break-all rounded-md border border-border bg-secondary/40 px-3 py-2 font-mono text-sm">
              {props.webhookUrl}
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Hosted platform</p>
            <p className="break-all rounded-md border border-border bg-secondary/40 px-3 py-2 font-mono text-sm">
              {props.hostedWebhookUrl}
            </p>
          </div>
          {props.sendingMode === "hosted" ? (
            <p className="text-sm text-muted-foreground">
              This organisation is on hosted sending. Use the platform webhook URL on Yarnhub’s
              Mobile Message account.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>4. Test send</CardTitle>
          <CardDescription>
            Send from a registered inbox number. Replies attach to a thread at
            (organisation, our number, their phone).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={onTestSend} className="space-y-4">
            {sendError ? <Alert variant="destructive">{sendError}</Alert> : null}
            <div className="space-y-2">
              <Label htmlFor="numberId">From</Label>
              <select
                id="numberId"
                name="numberId"
                required
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                defaultValue={props.numbers[0]?.id ?? ""}
              >
                {props.numbers.length === 0 ? (
                  <option value="">Register a number first</option>
                ) : (
                  props.numbers
                    .filter((n) => n.status === "active")
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.phone_e164}
                        {n.label ? ` (${n.label})` : ""}
                      </option>
                    ))
                )}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="to">To</Label>
              <Input id="to" name="to" placeholder="0412 345 678" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="body">Message</Label>
              <Textarea
                id="body"
                name="body"
                required
                defaultValue={`Test from ${props.org.name}. Reply STOP to opt out.`}
              />
            </div>
            <Button
              type="submit"
              disabled={pending === "send" || props.numbers.length === 0}
            >
              {pending === "send" ? "Sending…" : "Send test SMS"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
