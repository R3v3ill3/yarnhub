import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSmsProviderForOrg,
  type OutboundSms,
  type SendResult,
  type SmsProvider,
} from "@/lib/sms/provider";
import { providerAccountLookup } from "@/lib/sms/provider-lookup";
import { creditBalance, creditLedgerInsert } from "@/lib/sms/credits";
import { withHostedSendSlot } from "@/lib/sms/hosted-semaphore";
import { countSegments } from "@/lib/sms/segments";

export async function loadOrgSendState(
  db: SupabaseClient,
  orgId: string,
): Promise<{
  sending_suspended: boolean;
  kyc_status: string;
  mode: "byo" | "hosted" | null;
}> {
  const [{ data: org }, { data: account }] = await Promise.all([
    db
      .from("organisations")
      .select("sending_suspended, kyc_status")
      .eq("id", orgId)
      .maybeSingle(),
    db.from("provider_accounts").select("mode").eq("organisation_id", orgId).maybeSingle(),
  ]);
  return {
    sending_suspended: Boolean(org?.sending_suspended),
    kyc_status: (org?.kyc_status as string | undefined) ?? "none",
    mode: (account?.mode as "byo" | "hosted" | null) ?? null,
  };
}

export async function orgSendBlockedReason(
  db: SupabaseClient,
  orgId: string,
): Promise<string | null> {
  const state = await loadOrgSendState(db, orgId);
  if (state.sending_suspended) {
    return "Sending is suspended for this organisation";
  }
  if (state.mode === "hosted" && state.kyc_status !== "approved") {
    return "Hosted sending needs approved KYC first";
  }
  if (state.mode === "hosted") {
    const balance = await creditBalance(db, orgId);
    if (balance < 1) return "No hosted SMS credits remaining";
  }
  return null;
}

function creditsForResults(msgs: OutboundSms[], results: SendResult[]): number {
  let n = 0;
  results.forEach((result, i) => {
    if (result.status !== "success") return;
    if (typeof result.cost === "number" && result.cost > 0) {
      n += result.cost;
      return;
    }
    n += countSegments(msgs[i]?.body ?? "").segments;
  });
  return n;
}

export async function sendBatchForOrg(
  db: SupabaseClient,
  args: {
    orgId: string;
    provider: SmsProvider;
    msgs: OutboundSms[];
    opts?: { idempotencyKey?: string };
  },
): Promise<SendResult[]> {
  const blocked = await orgSendBlockedReason(db, args.orgId);
  if (blocked) {
    return args.msgs.map((m) => ({
      to: m.to,
      status: "error" as const,
      providerMessageId: null,
      error: blocked,
    }));
  }

  const state = await loadOrgSendState(db, args.orgId);
  const run = () => args.provider.sendBatch(args.msgs, args.opts);

  const results =
    state.mode === "hosted"
      ? await withHostedSendSlot(db, `org:${args.orgId}`, run)
      : await run();

  if (state.mode === "hosted") {
    const used = creditsForResults(args.msgs, results);
    if (used > 0) {
      const debit = await creditLedgerInsert(db, {
        orgId: args.orgId,
        delta: -used,
        reason: "send",
        ref: args.opts?.idempotencyKey ?? null,
      });
      if (debit.error) {
        console.error("hosted credit debit failed", debit.error);
      }
    }
  }

  return results;
}

export function wrapSmsProviderForOrg(
  db: SupabaseClient,
  orgId: string,
  provider: SmsProvider,
): SmsProvider {
  return {
    name: provider.name,
    capabilities: provider.capabilities,
    sendBatch: (msgs, opts) => sendBatchForOrg(db, { orgId, provider, msgs, opts }),
    getMessageStatus: (id) => provider.getMessageStatus(id),
    listSenders: () => provider.listSenders(),
    getCreditBalance: () => provider.getCreditBalance(),
    verifyWebhook: (body, headers) => provider.verifyWebhook(body, headers),
    parseWebhook: (body) => provider.parseWebhook(body),
  };
}

export function gatedProviderFactory(db: SupabaseClient) {
  return async (orgId: string) =>
    wrapSmsProviderForOrg(
      db,
      orgId,
      await getSmsProviderForOrg(orgId, providerAccountLookup(db)),
    );
}
