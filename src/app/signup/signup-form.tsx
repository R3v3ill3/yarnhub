"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { createFirstOrganisation } from "@/app/onboarding/actions";

export function SignupForm({ inviteToken }: { inviteToken: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const email = String(formData.get("email") ?? "");
      const password = String(formData.get("password") ?? "");
      const orgName = String(formData.get("orgName") ?? "");
      const supabase = createBrowserSupabaseClient();
      const origin = window.location.origin;
      if (inviteToken) {
        sessionStorage.setItem("yarnhub_invite_token", inviteToken);
      } else {
        sessionStorage.setItem("yarnhub_org_name", orgName);
      }
      const nextPath = inviteToken ? `/join/${inviteToken}` : "/settings";
      const { data, error: signError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
        },
      });
      if (signError) {
        setError(signError.message);
        return;
      }
      if (!data.session) {
        setMessage(
          inviteToken
            ? "Check your email to confirm the account, then sign in. You will join the organisation from the invite link."
            : "Check your email to confirm the account, then sign in. You will create the organisation on first login.",
        );
        return;
      }
      if (inviteToken) {
        router.push(`/join/${inviteToken}`);
        router.refresh();
        return;
      }
      const created = await createFirstOrganisation(orgName);
      if (created.error) {
        setError(created.error);
        return;
      }
      router.push("/settings");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>
          {inviteToken
            ? "Create an account with the invited email, then accept the join link."
            : "First login creates your organisation. Connect Mobile Message next."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={onSubmit} className="space-y-4">
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          {message ? <Alert>{message}</Alert> : null}
          {inviteToken ? (
            <input type="hidden" name="invite" value={inviteToken} />
          ) : (
            <div className="space-y-2">
              <Label htmlFor="orgName">Organisation name</Label>
              <Input id="orgName" name="orgName" required minLength={2} placeholder="Northside Trades" />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Creating…" : "Create account"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href={inviteToken ? `/login?next=${encodeURIComponent(`/join/${inviteToken}`)}` : "/login"} className="text-foreground underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
