import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/sms/credentials";
import { decideWebhookAuth } from "@/lib/sms/inbound";
import { hostedWebhookMissingOrgDecision } from "@/lib/sms/hosted-routing";
import { resolveHostedEventOrgId } from "@/lib/sms/hosted-webhook";
import { processInboundWebhook } from "@/lib/sms/process-inbound";
import { webhookProviderFromSecrets } from "@/lib/sms/provider";

export const runtime = "nodejs";

function headerMap(req: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

function jsonResult(result: {
  ok: boolean;
  status: number;
  error?: string;
  conversationId?: string;
  optedOut?: boolean;
  unmatched?: boolean;
  surveySessionId?: string;
  relayId?: string;
  leg?: string;
}) {
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json({
    ok: true,
    conversationId: result.conversationId ?? null,
    optedOut: result.optedOut ?? false,
    unmatched: result.unmatched ?? false,
    surveySessionId: result.surveySessionId ?? null,
    relayId: result.relayId ?? null,
    leg: result.leg ?? null,
  });
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "yarnhub-sms-webhook" });
}

export async function POST(req: NextRequest) {
  try {
    const orgPublicId = req.nextUrl.searchParams.get("org")?.trim();
    const rawBody = await req.text();
    const admin = createAdminClient();
    const headers = headerMap(req);

    if (orgPublicId) {
      const { data: org, error: orgError } = await admin
        .from("organisations")
        .select("id, public_id")
        .eq("public_id", orgPublicId)
        .maybeSingle();
      if (orgError) throw orgError;
      if (!org) {
        return NextResponse.json(
          { ok: false, error: "Unknown organisation" },
          { status: 404 },
        );
      }

      const { data: account } = await admin
        .from("provider_accounts")
        .select("webhook_secret_ciphertext")
        .eq("organisation_id", org.id)
        .maybeSingle();

      const webhookSecret = account?.webhook_secret_ciphertext
        ? decryptSecret(account.webhook_secret_ciphertext)
        : null;

      const provider = webhookProviderFromSecrets({ webhookSecret });
      const hmacOk = provider.verifyWebhook(rawBody, headers);
      const auth = decideWebhookAuth({
        providerName: provider.name,
        hasWebhookSecret: Boolean(webhookSecret),
        hmacOk,
      });
      if (auth !== "ok") {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }

      const event = provider.parseWebhook(rawBody);
      const result = await processInboundWebhook({
        admin,
        orgId: org.id,
        event,
      });
      return jsonResult(result);
    }

    const { data: platform } = await admin
      .from("platform_sms_accounts")
      .select("webhook_secret_ciphertext")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const webhookSecret = platform?.webhook_secret_ciphertext
      ? decryptSecret(platform.webhook_secret_ciphertext)
      : null;
    const provider = webhookProviderFromSecrets({ webhookSecret });
    const hmacOk = provider.verifyWebhook(rawBody, headers);
    const hostedAuth = hostedWebhookMissingOrgDecision({
      hasPlatformSecret: Boolean(webhookSecret),
      hmacOk,
    });
    if (hostedAuth === "unauthorized") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (hostedAuth === "unconfigured") {
      return NextResponse.json({ ok: true, unmatched: true, reason: "hosted_unconfigured" });
    }

    const event = provider.parseWebhook(rawBody);
    if (event.type === "unknown") {
      return NextResponse.json({ ok: true, unmatched: false });
    }

    const orgId = await resolveHostedEventOrgId(admin, event);
    if (!orgId) {
      return NextResponse.json({ ok: true, unmatched: true });
    }

    const result = await processInboundWebhook({ admin, orgId, event });
    return jsonResult(result);
  } catch (err) {
    console.error("sms webhook error", err);
    return NextResponse.json({ ok: false, error: "Webhook failed" }, { status: 500 });
  }
}
