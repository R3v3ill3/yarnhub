import type { SupabaseClient } from "@supabase/supabase-js";

const LEASE_MS = 30_000;
const MAX_ATTEMPTS = 8;
const WAIT_MS = 250;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withHostedSendSlot<T>(
  db: SupabaseClient,
  holder: string,
  fn: () => Promise<T>,
): Promise<T> {
  const slot = await acquireSlot(db, holder);
  if (slot == null) {
    throw new Error("Hosted send capacity is full (Mobile Message 5-request cap). Retry shortly.");
  }
  try {
    return await fn();
  } finally {
    await db
      .from("sms_hosted_send_slots")
      .update({ leased_until: new Date(0).toISOString(), holder: null })
      .eq("slot", slot);
  }
}

async function acquireSlot(db: SupabaseClient, holder: string): Promise<number | null> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const now = new Date().toISOString();
    const { data: free } = await db
      .from("sms_hosted_send_slots")
      .select("slot")
      .lt("leased_until", now)
      .order("slot", { ascending: true })
      .limit(1);
    const slot = free?.[0]?.slot as number | undefined;
    if (slot == null) {
      await sleep(WAIT_MS);
      continue;
    }
    const until = new Date(Date.now() + LEASE_MS).toISOString();
    const { data: claimed } = await db
      .from("sms_hosted_send_slots")
      .update({ leased_until: until, holder })
      .eq("slot", slot)
      .lt("leased_until", now)
      .select("slot");
    if (claimed?.[0]?.slot != null) return claimed[0].slot as number;
    await sleep(WAIT_MS);
  }
  return null;
}
