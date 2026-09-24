"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addThreadNote, setConversationState } from "./actions";

export function ThreadExtras(props: { conversationId: string; closed: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onState() {
    setPending(true);
    setError(null);
    const formData = new FormData();
    formData.set("conversationId", props.conversationId);
    formData.set("state", props.closed ? "open" : "closed");
    const result = await setConversationState(formData);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function onNote(formData: FormData) {
    setPending(true);
    setError(null);
    formData.set("conversationId", props.conversationId);
    const result = await addThreadNote(formData);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2 border-t border-border px-4 py-3">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <div className="flex flex-wrap items-end gap-2">
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onState}>
          {props.closed ? "Reopen" : "Close"}
        </Button>
        <form action={onNote} className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
          <Textarea name="body" rows={2} placeholder="Staff note, not sent" className="min-w-0 flex-1" />
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            Add note
          </Button>
        </form>
      </div>
    </div>
  );
}
