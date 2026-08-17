"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Badge } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toDisplay } from "@/lib/phone/normalise-phone";
import { claimConversation, updateContactNotes } from "./actions";

export function ContactPane(props: {
  conversationId: string;
  contactId: string | null;
  name: string;
  phone: string;
  optedOut: boolean;
  notes: string;
  claimedBy: string | null;
  claimedLabel: string | null;
  currentUserId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    if (!props.contactId) return;
    setPending(true);
    setError(null);
    formData.set("contactId", props.contactId);
    formData.set("conversationId", props.conversationId);
    const result = await updateContactNotes(formData);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <aside className="space-y-4 border-t border-border p-4 lg:w-72 lg:overflow-y-auto lg:border-l lg:border-t-0">
      <div>
        <p className="font-medium">{props.name || toDisplay(props.phone)}</p>
        <p className="font-mono text-sm text-muted-foreground">{toDisplay(props.phone)}</p>
        {props.optedOut ? (
          <Badge variant="destructive" className="mt-2">
            Opted out
          </Badge>
        ) : (
          <Badge variant="secondary" className="mt-2">
            Can receive SMS
          </Badge>
        )}
      </div>
      <form
        action={async () => {
          setPending(true);
          setError(null);
          const fd = new FormData();
          fd.set("conversationId", props.conversationId);
          fd.set("action", props.claimedBy === props.currentUserId ? "release" : "claim");
          const result = await claimConversation(fd);
          setPending(false);
          if (result.error) {
            setError(result.error);
            return;
          }
          router.refresh();
        }}
      >
        <p className="text-sm text-muted-foreground">
          {props.claimedBy
            ? `Claimed by ${props.claimedLabel || "a teammate"}`
            : "Unclaimed"}
        </p>
        <Button type="submit" size="sm" variant="outline" className="mt-2" disabled={pending}>
          {props.claimedBy === props.currentUserId ? "Release claim" : "Claim thread"}
        </Button>
      </form>
      {props.contactId ? (
        <form action={onSubmit} className="space-y-2">
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" name="notes" rows={8} defaultValue={props.notes} />
          <Button type="submit" variant="secondary" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save notes"}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">No contact record yet.</p>
      )}
    </aside>
  );
}
