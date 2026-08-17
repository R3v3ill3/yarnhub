import type { SupabaseClient } from "@supabase/supabase-js";

export async function creditBalance(
  db: SupabaseClient,
  orgId: string,
): Promise<number> {
  const { data, error } = await db
    .from("sms_credit_ledger")
    .select("delta")
    .eq("organisation_id", orgId);
  if (error) throw error;
  return (data ?? []).reduce((sum, row) => sum + (row.delta as number), 0);
}

export async function creditLedgerInsert(
  db: SupabaseClient,
  args: {
    orgId: string;
    delta: number;
    reason: string;
    ref?: string | null;
    createdBy?: string | null;
  },
): Promise<{ error?: string }> {
  if (args.delta === 0) return { error: "Credit delta cannot be zero" };
  const { error } = await db.from("sms_credit_ledger").insert({
    organisation_id: args.orgId,
    delta: args.delta,
    reason: args.reason,
    ref: args.ref ?? null,
    created_by: args.createdBy ?? null,
  });
  if (error) return { error: error.message };
  return {};
}
