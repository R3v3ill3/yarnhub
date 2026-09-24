"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { loadBargainingDemo, removeBargainingDemo } from "./actions";

export function DemoPanel(props: { loaded: boolean; canAdmin: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<"load" | "remove" | null>(null);

  async function onLoad() {
    setPending("load");
    setError(null);
    setNotice(null);
    const result = await loadBargainingDemo();
    setPending(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNotice(`Loaded ${result.contacts} contacts and ${result.threads} conversations.`);
    router.refresh();
  }

  async function onRemove() {
    setPending("remove");
    setError(null);
    setNotice(null);
    const result = await removeBargainingDemo();
    setPending(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNotice("Demo rows removed.");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {notice ? <Alert>{notice}</Alert> : null}
      {props.canAdmin ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending !== null} onClick={onLoad}>
            {pending === "load" ? "Loading…" : props.loaded ? "Reload demo" : "Load demo into this organisation"}
          </Button>
          {props.loaded ? (
            <Button type="button" variant="outline" disabled={pending !== null} onClick={onRemove}>
              {pending === "remove" ? "Removing…" : "Remove demo data"}
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Only owners and admins can load or remove the demo.</p>
      )}
    </div>
  );
}
