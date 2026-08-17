"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendInboxReply } from "./actions";

export function ReplyForm({
  conversationId,
  optedOut,
  canned,
}: {
  conversationId: string;
  optedOut: boolean;
  canned: Array<{ id: string; title: string; body: string }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

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
      {canned.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {canned.map((row) => (
            <Button
              key={row.id}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                if (bodyRef.current) bodyRef.current.value = row.body;
              }}
            >
              {row.title}
            </Button>
          ))}
        </div>
      ) : null}
      <Textarea
        ref={bodyRef}
        name="body"
        required
        rows={3}
        placeholder="Reply — never held for quiet hours"
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send reply"}
      </Button>
    </form>
  );
}
