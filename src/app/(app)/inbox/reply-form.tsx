"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendInboxReply } from "./actions";

export function ReplyForm({
  conversationId,
  optedOut,
}: {
  conversationId: string;
  optedOut: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    formData.set("conversationId", conversationId);
    const result = await sendInboxReply(formData);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  if (optedOut) {
    return (
      <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
        This contact has opted out. Replies are blocked.
      </p>
    );
  }

  return (
    <form action={onSubmit} className="space-y-2 border-t border-border p-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <Textarea name="body" required rows={3} placeholder="Reply — never held for quiet hours" />
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send reply"}
      </Button>
    </form>
  );
}
