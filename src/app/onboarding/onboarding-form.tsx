"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { createFirstOrganisation } from "./actions";

export function OnboardingForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [orgName, setOrgName] = useState("");

  useEffect(() => {
    const stored = sessionStorage.getItem("yarnhub_org_name");
    if (stored) setOrgName(stored);
  }, []);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await createFirstOrganisation(String(formData.get("orgName") ?? ""));
    if (result.error) {
      setError(result.error);
      setPending(false);
      return;
    }
    sessionStorage.removeItem("yarnhub_org_name");
    router.push("/settings");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Name your organisation</CardTitle>
        <CardDescription>
          This name is the legal sender identity on SMS (not the Yarnhub brand).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={onSubmit} className="space-y-4">
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <div className="space-y-2">
            <Label htmlFor="orgName">Organisation name</Label>
            <Input
              id="orgName"
              name="orgName"
              required
              minLength={2}
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Saving…" : "Continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
