"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { simulateInboundReply } from "./actions";

export function SimulateReplyForm({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    formData.set("conversationId", conversationId);
    const result = await simulateInboundReply(formData);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <form action={onSubmit} className="space-y-3 rounded-xl border border-border p-4">
      <p className="text-sm font-medium">Simulate inbound reply (mock provider)</p>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <Textarea name="body" placeholder="Hello — this is a reply" defaultValue="Hello from the phone" />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Appending…" : "Append inbound reply"}
      </Button>
    </form>
  );
}
