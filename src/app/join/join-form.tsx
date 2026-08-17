"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { acceptInvite } from "./actions";

export function JoinForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onAccept() {
    setPending(true);
    setError(null);
    const result = await acceptInvite(token);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.push("/inbox");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Join an organisation</CardTitle>
        <CardDescription>
          This invite is tied to the email on your Yarnhub account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <Button type="button" className="w-full" disabled={pending} onClick={onAccept}>
          {pending ? "Joining…" : "Accept invite"}
        </Button>
      </CardContent>
    </Card>
  );
}
