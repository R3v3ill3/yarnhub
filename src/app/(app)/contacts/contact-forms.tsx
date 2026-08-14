"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addContact, importContactsCsv, snapshotContactList } from "./actions";

export function ContactForms({
  lists,
}: {
  lists: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [csvMessage, setCsvMessage] = useState<string | null>(null);
  const [listMessage, setListMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function onAdd(formData: FormData) {
    setPending("add");
    setError(null);
    const result = await addContact(formData);
    setPending(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function onCsv(formData: FormData) {
    setPending("csv");
    setCsvMessage(null);
    const result = await importContactsCsv(formData);
    setPending(null);
    if (result.error) {
      setCsvMessage(result.error);
      return;
    }
    setCsvMessage(`Imported ${result.imported ?? 0}, skipped ${result.skipped ?? 0}.`);
    router.refresh();
  }

  async function onList(formData: FormData) {
    setPending("list");
    setListMessage(null);
    const result = await snapshotContactList(formData);
    setPending(null);
    if (result.error) {
      setListMessage(result.error);
      return;
    }
    setListMessage("List saved from current contacts.");
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Add a contact</CardTitle>
          <CardDescription>Matched on E.164 only — no worker wash.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={onAdd} className="space-y-3">
            {error ? <Alert variant="destructive">{error}</Alert> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="first_name">First name</Label>
                <Input id="first_name" name="first_name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last_name">Last name</Label>
                <Input id="last_name" name="last_name" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Mobile</Label>
              <Input id="phone" name="phone" required placeholder="0412 345 678" />
            </div>
            <Button type="submit" disabled={pending === "add"}>
              {pending === "add" ? "Saving…" : "Add contact"}
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>CSV import</CardTitle>
          <CardDescription>
            Header row with phone / first_name / last_name, or a single phone column.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={onCsv} className="space-y-3">
            {csvMessage ? <Alert>{csvMessage}</Alert> : null}
            <Textarea
              name="csv"
              rows={8}
              placeholder={"first_name,last_name,phone\nAlex,Mitchell,0412345678"}
            />
            <Button type="submit" variant="secondary" disabled={pending === "csv"}>
              {pending === "csv" ? "Importing…" : "Import CSV"}
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Save as a list</CardTitle>
          <CardDescription>
            Snapshot everyone currently in Contacts for blast targeting.
            {lists.length ? ` Existing: ${lists.map((l) => l.name).join(", ")}.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={onList} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            {listMessage ? <Alert className="sm:w-full">{listMessage}</Alert> : null}
            <div className="space-y-2 sm:flex-1">
              <Label htmlFor="list_name">List name</Label>
              <Input id="list_name" name="list_name" required placeholder="August members" />
            </div>
            <Button type="submit" variant="outline" disabled={pending === "list"}>
              {pending === "list" ? "Saving…" : "Save list"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
