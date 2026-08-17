import { appUrl } from "@/lib/app-url";

const STRIPE_API = "https://api.stripe.com/v1";

export function stripeSecretKey(): string | undefined {
  return process.env.STRIPE_SECRET_KEY?.trim() || undefined;
}

export function stripeWebhookSecret(): string | undefined {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || undefined;
}

export function stripeConfigured(): boolean {
  return Boolean(stripeSecretKey());
}

export function creditPackSize(): number {
  const n = Number(process.env.STRIPE_CREDIT_PACK_SIZE ?? "100");
  return Number.isFinite(n) && n > 0 ? n : 100;
}

export function creditPackAmountCents(): number {
  const n = Number(process.env.STRIPE_CREDIT_PACK_CENTS ?? "2000");
  return Number.isFinite(n) && n > 0 ? n : 2000;
}

export async function createStripeCheckoutSession(args: {
  orgId: string;
  orgName: string;
  intentId: string;
  credits: number;
  amountCents: number;
}): Promise<{ url?: string; id?: string; error?: string }> {
  const secret = stripeSecretKey();
  if (!secret) {
    return {
      error:
        "Stripe is not connected. Install the Stripe integration on the yarnhub Vercel project (Marketplace → payments), then pull env vars.",
    };
  }

  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("success_url", `${appUrl()}/team?billing=success`);
  body.set("cancel_url", `${appUrl()}/team?billing=cancel`);
  body.set("client_reference_id", args.intentId);
  body.set("metadata[organisation_id]", args.orgId);
  body.set("metadata[credits]", String(args.credits));
  body.set("line_items[0][quantity]", "1");
  body.set("line_items[0][price_data][currency]", "aud");
  body.set("line_items[0][price_data][unit_amount]", String(args.amountCents));
  body.set(
    "line_items[0][price_data][product_data][name]",
    `${args.credits} Yarnhub hosted SMS credits (${args.orgName})`,
  );

  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok) {
    return { error: json.error?.message || `Stripe checkout failed (${res.status})` };
  }
  return { id: json.id, url: json.url };
}

export type StripeCheckoutSessionLike = {
  id?: string;
  client_reference_id?: string | null;
  payment_status?: string | null;
  metadata?: Record<string, string> | null;
};

export function stripeEventType(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const type = (payload as { type?: unknown }).type;
  return typeof type === "string" ? type : null;
}

export function stripeCheckoutSessionFromEvent(
  payload: unknown,
): StripeCheckoutSessionLike | null {
  if (!payload || typeof payload !== "object") return null;
  const data = (payload as { data?: { object?: unknown } }).data;
  const obj = data?.object;
  if (!obj || typeof obj !== "object") return null;
  return obj as StripeCheckoutSessionLike;
}
