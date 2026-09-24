"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toDisplay } from "@/lib/phone/normalise-phone";
import { addTestRecipient, removeTestRecipient } from "./actions";

export function TestRoster(props: {
  contacts: Array<{ id: string; first_name: string | null; last_name: string | null; phone_e164: string }>;
  roster: Array<{ contactId: string; name: string; phone: string }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const onRoster = new Set(props.roster.map((person) => person.contactId));

  async function onAdd(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await addTestRecipient(formData);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function onRemove(contactId: string) {
    setPending(true);
    setError(null);
    const formData = new FormData();
    formData.set("contactId", contactId);
    const result = await removeTestRecipient(formData);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test recipients</CardTitle>
        <CardDescription>
          Surveys marked as a test send only to these people, up to 25. A test cannot reach
          the rest of your contacts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <form action={onAdd} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="space-y-2 sm:flex-1">
            <Label htmlFor="contactId">Add a tester</Label>
            <select
              id="contactId"
              name="contactId"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              defaultValue=""
            >
              <option value="" disabled>
                Choose a contact
              </option>
              {props.contacts
                .filter((contact) => !onRoster.has(contact.id))
                .map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {[contact.first_name, contact.last_name].filter(Boolean).join(" ")} ·{" "}
                    {toDisplay(contact.phone_e164)}
                  </option>
                ))}
            </select>
          </div>
          <Button type="submit" variant="secondary" disabled={pending}>
            Add
          </Button>
        </form>
        <ul className="space-y-1 text-sm">
          {props.roster.map((person) => (
            <li key={person.contactId} className="flex items-center justify-between gap-2">
              <span>
                {person.name || "Unnamed"} · {toDisplay(person.phone)}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => onRemove(person.contactId)}
              >
                Remove
              </Button>
            </li>
          ))}
          {!props.roster.length ? (
            <li className="text-muted-foreground">No testers yet.</li>
          ) : null}
        </ul>
      </CardContent>
    </Card>
  );
}
