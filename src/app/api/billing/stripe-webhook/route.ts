import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripeEventType, stripeCheckoutSessionFromEvent, stripeWebhookSecret } from "@/lib/billing/stripe";
import { verifyStripeWebhookSignature } from "@/lib/billing/stripe-webhook";
import { fulfillStripeCheckoutSession } from "@/lib/billing/fulfill";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const secret = stripeWebhookSecret();
  if (!secret) {
    return NextResponse.json({ ok: false, error: "Stripe webhook is not configured" }, { status: 503 });
  }

  const rawBody = await req.text();
  const ok = verifyStripeWebhookSignature({
    rawBody,
    header: req.headers.get("stripe-signature"),
    secret,
  });
  if (!ok) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const type = stripeEventType(payload);
  if (type !== "checkout.session.completed") {
    return NextResponse.json({ ok: true, ignored: type });
  }

  const session = stripeCheckoutSessionFromEvent(payload);
  if (!session) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const admin = createAdminClient();
  const result = await fulfillStripeCheckoutSession(admin, session);
  if (result.error) {
    console.error("stripe fulfill failed", result.error);
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, skipped: result.skipped ?? false });
}
