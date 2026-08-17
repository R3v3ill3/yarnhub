"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export function ThreadLive({ conversationId }: { conversationId: string }) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      .channel(`inbox:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "sms_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          if (!cancelled) router.refresh();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, router]);

  return null;
}
