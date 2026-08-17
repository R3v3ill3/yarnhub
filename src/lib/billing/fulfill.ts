import type { SupabaseClient } from "@supabase/supabase-js";
import { creditLedgerInsert } from "@/lib/sms/credits";
import type { StripeCheckoutSessionLike } from "@/lib/billing/stripe";

export async function fulfillStripeCheckoutSession(
  db: SupabaseClient,
  session: StripeCheckoutSessionLike,
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  if (session.payment_status && session.payment_status !== "paid") {
    return { ok: true, skipped: true };
  }
  const intentId = session.client_reference_id?.trim();
  if (!intentId) return { ok: false, error: "Missing checkout intent id" };

  const { data: intent, error } = await db
    .from("billing_checkout_intents")
    .select("id, organisation_id, credits, status, provider_ref")
    .eq("id", intentId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!intent) return { ok: false, error: "Unknown checkout intent" };
  if (intent.status === "completed") return { ok: true, skipped: true };

  const ref = `stripe:${session.id ?? intentId}`;
  const { data: existing } = await db
    .from("sms_credit_ledger")
    .select("id")
    .eq("organisation_id", intent.organisation_id)
    .eq("ref", ref)
    .limit(1)
    .maybeSingle();
  if (!existing) {
    const credited = await creditLedgerInsert(db, {
      orgId: intent.organisation_id as string,
      delta: intent.credits as number,
      reason: "stripe_checkout",
      ref,
    });
    if (credited.error) return { ok: false, error: credited.error };
  }

  const { error: updateError } = await db
    .from("billing_checkout_intents")
    .update({
      status: "completed",
      provider_ref: session.id ?? intent.provider_ref,
      completed_at: new Date().toISOString(),
    })
    .eq("id", intent.id)
    .eq("status", "pending");
  if (updateError) return { ok: false, error: updateError.message };
  return { ok: true };
}
