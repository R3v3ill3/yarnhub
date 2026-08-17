"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Badge } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ORG_TIMEZONES } from "@/lib/org/timezones";
import {
  deleteCannedReply,
  inviteMember,
  removeMember,
  requestHostedSending,
  revokeInvite,
  saveCannedReply,
  startCreditCheckout,
  submitKyc,
  updateMemberRole,
  updateOrgTimezone,
} from "./actions";

type MemberRow = { user_id: string; role: string; email: string };
type InviteRow = { id: string; email: string; role: string; expires_at: string; accepted_at: string | null };
type CannedRow = { id: string; title: string; body: string };
type AuditRow = { id: string; action: string; created_at: string; actor: string };

export function TeamForms(props: {
  canAdmin: boolean;
  timezone: string;
  members: MemberRow[];
  invites: InviteRow[];
  canned: CannedRow[];
  audit: AuditRow[];
  kycStatus: string;
  kycLegalName: string;
  kycAbn: string;
  sendingMode: "byo" | "hosted" | null;
  sendingSuspended: boolean;
  creditBalance: number;
  stripeConfigured: boolean;
  creditPackSize: number;
  creditPackCents: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function run(
    key: string,
    fn: () => Promise<{ error?: string; inviteUrl?: string }>,
  ) {
    setPending(key);
    setError(null);
    const result = await fn();
    setPending(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.inviteUrl) setInviteUrl(result.inviteUrl);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {props.sendingSuspended ? (
        <Alert variant="destructive">Sending is suspended for this organisation.</Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Timezone</CardTitle>
          <CardDescription>
            Quiet hours and blast windows use this IANA timezone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            action={(formData) => run("tz", () => updateOrgTimezone(formData))}
          >
            <div className="space-y-2">
              <Label htmlFor="timezone">Default timezone</Label>
              <select
                id="timezone"
                name="timezone"
                defaultValue={props.timezone}
                disabled={!props.canAdmin}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {ORG_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
            {props.canAdmin ? (
              <Button type="submit" disabled={pending === "tz"}>
                {pending === "tz" ? "Saving…" : "Save"}
              </Button>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            Owners and admins manage credentials, launches, invites, and hosted billing.
            All members can use inbox and P2P.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2 text-sm">
            {props.members.map((m) => (
              <li
                key={m.user_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              >
                <span>
                  {m.email}{" "}
                  <Badge variant="secondary" className="ml-1">
                    {m.role}
                  </Badge>
                </span>
                {props.canAdmin ? (
                  <div className="flex flex-wrap gap-2">
                    <form action={(formData) => run(`role-${m.user_id}`, () => updateMemberRole(formData))}>
                      <input type="hidden" name="userId" value={m.user_id} />
                      <select
                        name="role"
                        defaultValue={m.role}
                        className="mr-2 h-8 rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="owner">owner</option>
                        <option value="admin">admin</option>
                        <option value="member">member</option>
                      </select>
                      <Button type="submit" size="sm" variant="outline" disabled={pending === `role-${m.user_id}`}>
                        Save
                      </Button>
                    </form>
                    <form action={() => run(`rm-${m.user_id}`, () => {
                      const fd = new FormData();
                      fd.set("userId", m.user_id);
                      return removeMember(fd);
                    })}>
                      <Button type="submit" size="sm" variant="ghost" disabled={pending === `rm-${m.user_id}`}>
                        Remove
                      </Button>
                    </form>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>

          {props.canAdmin ? (
            <form
              className="grid gap-3 sm:grid-cols-3"
              action={(formData) => run("invite", () => inviteMember(formData))}
            >
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="email">Invite email</Label>
                <Input id="email" name="email" type="email" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <select
                  id="role"
                  name="role"
                  defaultValue="member"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <div className="sm:col-span-3">
                <Button type="submit" disabled={pending === "invite"}>
                  {pending === "invite" ? "Sending…" : "Create invite link"}
                </Button>
              </div>
            </form>
          ) : null}
          {inviteUrl ? (
            <Alert>
              Share this join link (shown once):{" "}
              <span className="break-all font-mono text-xs">{inviteUrl}</span>
            </Alert>
          ) : null}

          {props.invites.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {props.invites.map((inv) => (
                <li
                  key={inv.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <span>
                    {inv.email} · {inv.role} · expires{" "}
                    {new Date(inv.expires_at).toLocaleDateString()}
                  </span>
                  {props.canAdmin ? (
                    <form
                      action={() =>
                        run(`rev-${inv.id}`, () => {
                          const fd = new FormData();
                          fd.set("inviteId", inv.id);
                          return revokeInvite(fd);
                        })
                      }
                    >
                      <Button type="submit" size="sm" variant="ghost" disabled={pending === `rev-${inv.id}`}>
                        Revoke
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Canned replies</CardTitle>
          <CardDescription>Insert these from the inbox reply box.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2 text-sm">
            {props.canned.map((row) => (
              <li key={row.id} className="rounded-md border border-border px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{row.title}</p>
                  <form
                    action={() =>
                      run(`can-${row.id}`, () => {
                        const fd = new FormData();
                        fd.set("replyId", row.id);
                        return deleteCannedReply(fd);
                      })
                    }
                  >
                    <Button type="submit" size="sm" variant="ghost" disabled={pending === `can-${row.id}`}>
                      Delete
                    </Button>
                  </form>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{row.body}</p>
              </li>
            ))}
            {!props.canned.length ? (
              <li className="text-muted-foreground">None yet.</li>
            ) : null}
          </ul>
          <form className="space-y-3" action={(formData) => run("canned", () => saveCannedReply(formData))}>
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="body">Body</Label>
              <Textarea id="body" name="body" required rows={3} />
            </div>
            <Button type="submit" disabled={pending === "canned"}>
              {pending === "canned" ? "Saving…" : "Add canned reply"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hosted sending & KYC</CardTitle>
          <CardDescription>
            Hosted numbers sit on Yarnhub’s Mobile Message account. BYO stays on Settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Mode: {props.sendingMode ?? "not set"} · KYC: {props.kycStatus} · Credits:{" "}
            {props.creditBalance}
          </p>
          {props.canAdmin ? (
            <>
              <form className="grid gap-3 sm:grid-cols-2" action={(formData) => run("kyc", () => submitKyc(formData))}>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="kyc_legal_name">Legal name</Label>
                  <Input
                    id="kyc_legal_name"
                    name="kyc_legal_name"
                    required
                    defaultValue={props.kycLegalName}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="kyc_abn">ABN</Label>
                  <Input id="kyc_abn" name="kyc_abn" required defaultValue={props.kycAbn} />
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={pending === "kyc"}>
                    {pending === "kyc" ? "Submitting…" : "Submit KYC"}
                  </Button>
                </div>
              </form>
              {props.sendingMode !== "byo" ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending === "hosted"}
                  onClick={() => run("hosted", () => requestHostedSending())}
                >
                  {pending === "hosted" ? "Saving…" : "Request hosted sending"}
                </Button>
              ) : null}
              <form action={() => run("pay", () => startCreditCheckout())}>
                <Button type="submit" disabled={pending === "pay" || !props.stripeConfigured}>
                  {pending === "pay"
                    ? "Redirecting…"
                    : `Buy ${props.creditPackSize} credits (A$${(props.creditPackCents / 100).toFixed(2)})`}
                </Button>
              </form>
              {!props.stripeConfigured ? (
                <p className="text-sm text-muted-foreground">
                  Stripe checkout is not connected on this deployment yet. Platform admins can
                  still grant credits from the platform console.
                </p>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit</CardTitle>
          <CardDescription>Credential, invite, role, KYC, and billing events.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {props.audit.map((row) => (
              <li key={row.id} className="flex flex-wrap justify-between gap-2 border-b border-border pb-2">
                <span>
                  {row.action}
                  {row.actor ? ` · ${row.actor}` : ""}
                </span>
                <span className="text-muted-foreground">
                  {new Date(row.created_at).toLocaleString()}
                </span>
              </li>
            ))}
            {!props.audit.length ? (
              <li className="text-muted-foreground">No events yet.</li>
            ) : null}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
