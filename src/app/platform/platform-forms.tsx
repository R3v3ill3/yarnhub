"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Badge } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hostedSmsWebhookUrl } from "@/lib/app-url";
import {
  addPoolNumber,
  assignPoolNumber,
  grantCredits,
  savePlatformCredentials,
  setOrgKycStatus,
  setSendingSuspended,
} from "./actions";

type OrgRow = {
  id: string;
  name: string;
  kyc_status: string;
  sending_suspended: boolean;
  credits: number;
};
type PoolRow = {
  id: string;
  phone_e164: string;
  label: string | null;
  status: string;
  assigned_organisation_id: string | null;
};

export function PlatformForms(props: {
  hasPlatformAccount: boolean;
  orgs: OrgRow[];
  pool: PoolRow[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<{ error?: string; balance?: number }>) {
    setPending(key);
    setError(null);
    setOk(null);
    const result = await fn();
    setPending(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (typeof result.balance === "number") {
      setOk(`Verified. Platform MM balance ${result.balance}.`);
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {ok ? <Alert>{ok}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Platform Mobile Message</CardTitle>
          <CardDescription>
            Hosted tenants share this account. Point MM’s account webhook at{" "}
            <code className="font-mono text-xs">{hostedSmsWebhookUrl()}</code> (no{" "}
            <code>?org=</code>).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" action={(fd) => run("creds", () => savePlatformCredentials(fd))}>
            <Badge variant={props.hasPlatformAccount ? "default" : "outline"}>
              {props.hasPlatformAccount ? "Configured" : "Not configured"}
            </Badge>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="username">API username</Label>
                <Input id="username" name="username" required autoComplete="off" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">API password</Label>
                <Input id="password" name="password" type="password" required autoComplete="new-password" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhookSecret">Webhook HMAC secret</Label>
              <Input id="webhookSecret" name="webhookSecret" type="password" autoComplete="off" />
            </div>
            <Button type="submit" disabled={pending === "creds"}>
              {pending === "creds" ? "Saving…" : "Save platform credentials"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Number pool</CardTitle>
          <CardDescription>
            Buy numbers in the Mobile Message dashboard, then register them here. Assignment is
            manual after KYC.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2 text-sm">
            {props.pool.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                <span className="font-mono">
                  {n.phone_e164}
                  {n.label ? ` · ${n.label}` : ""}
                </span>
                <span className="text-muted-foreground">{n.status}</span>
                {n.status === "available" ? (
                  <form
                    className="flex flex-wrap items-center gap-2"
                    action={(fd) => {
                      fd.set("poolId", n.id);
                      return run(`assign-${n.id}`, () => assignPoolNumber(fd));
                    }}
                  >
                    <select
                      name="organisationId"
                      required
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="">Organisation</option>
                      {props.orgs.map((org) => (
                        <option key={org.id} value={org.id}>
                          {org.name}
                        </option>
                      ))}
                    </select>
                    <select
                      name="purpose"
                      defaultValue="inbox"
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="inbox">inbox</option>
                      <option value="survey">survey</option>
                      <option value="relay">relay</option>
                      <option value="spare">spare</option>
                    </select>
                    <Button type="submit" size="sm" disabled={pending === `assign-${n.id}`}>
                      Assign
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
            {!props.pool.length ? <li className="text-muted-foreground">Pool is empty.</li> : null}
          </ul>
          <form className="grid gap-3 sm:grid-cols-2" action={(fd) => run("pool", () => addPoolNumber(fd))}>
            <div className="space-y-2">
              <Label htmlFor="phone">Number</Label>
              <Input id="phone" name="phone" placeholder="0485 900 180" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="label">Label</Label>
              <Input id="label" name="label" />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={pending === "pool"}>
                Add to pool
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Organisations</CardTitle>
          <CardDescription>KYC, panic suspend, and credit grants.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm">
            {props.orgs.map((org) => (
              <li key={org.id} className="space-y-2 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{org.name}</p>
                  <span className="text-muted-foreground">
                    KYC {org.kyc_status} · credits {org.credits}
                    {org.sending_suspended ? " · SUSPENDED" : ""}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <form action={(fd) => {
                    fd.set("organisationId", org.id);
                    return run(`kyc-${org.id}`, () => setOrgKycStatus(fd));
                  }}>
                    <select
                      name="kyc_status"
                      defaultValue={org.kyc_status}
                      className="mr-2 h-8 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="none">none</option>
                      <option value="pending">pending</option>
                      <option value="approved">approved</option>
                      <option value="rejected">rejected</option>
                    </select>
                    <Button type="submit" size="sm" variant="outline">
                      Save KYC
                    </Button>
                  </form>
                  <form action={() => {
                    const fd = new FormData();
                    fd.set("organisationId", org.id);
                    fd.set("suspended", org.sending_suspended ? "false" : "true");
                    return run(`sus-${org.id}`, () => setSendingSuspended(fd));
                  }}>
                    <Button type="submit" size="sm" variant={org.sending_suspended ? "outline" : "destructive"}>
                      {org.sending_suspended ? "Unsuspend" : "Panic suspend"}
                    </Button>
                  </form>
                  <form
                    className="flex items-center gap-2"
                    action={(fd) => {
                      fd.set("organisationId", org.id);
                      return run(`cred-${org.id}`, () => grantCredits(fd));
                    }}
                  >
                    <Input name="credits" type="number" defaultValue={100} className="h-8 w-24" />
                    <Button type="submit" size="sm">
                      Grant credits
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
