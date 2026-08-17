import { describe, expect, it } from "vitest";
import { orgSendBlockedReason, sendBatchForOrg } from "../send-guard";
import type { SmsProvider } from "../provider";

function thenable(data: unknown) {
  const result = { data, error: null };
  const builder: {
    select: () => typeof builder;
    eq: () => typeof builder;
    maybeSingle: () => Promise<typeof result>;
    then: Promise<typeof result>["then"];
  } = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve(result),
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

function fakeDb(args: {
  suspended?: boolean;
  kyc?: string;
  mode?: "byo" | "hosted" | null;
  credits?: number;
}) {
  return {
    from(table: string) {
      if (table === "organisations") {
        return thenable({
          sending_suspended: Boolean(args.suspended),
          kyc_status: args.kyc ?? "none",
        });
      }
      if (table === "provider_accounts") {
        return thenable({ mode: args.mode ?? null });
      }
      if (table === "sms_credit_ledger") {
        return thenable([{ delta: args.credits ?? 0 }]);
      }
      return thenable(null);
    },
  } as never;
}

const provider: SmsProvider = {
  name: "mock",
  capabilities: { mms: false },
  sendBatch: async (msgs) =>
    msgs.map((m) => ({
      to: m.to,
      status: "success" as const,
      providerMessageId: "x",
    })),
  getMessageStatus: async (id) => ({ providerMessageId: id, status: "delivered" }),
  listSenders: async () => [],
  getCreditBalance: async () => 0,
  verifyWebhook: () => true,
  parseWebhook: () => ({ type: "unknown", raw: null }),
};

describe("orgSendBlockedReason", () => {
  it("blocks a suspended org", async () => {
    expect(await orgSendBlockedReason(fakeDb({ suspended: true, mode: "byo" }), "org")).toMatch(
      /suspended/i,
    );
  });

  it("blocks hosted without KYC", async () => {
    expect(
      await orgSendBlockedReason(fakeDb({ mode: "hosted", kyc: "pending", credits: 10 }), "org"),
    ).toMatch(/KYC/i);
  });

  it("blocks hosted with no credits", async () => {
    expect(
      await orgSendBlockedReason(fakeDb({ mode: "hosted", kyc: "approved", credits: 0 }), "org"),
    ).toMatch(/credits/i);
  });

  it("allows BYO when not suspended", async () => {
    expect(await orgSendBlockedReason(fakeDb({ mode: "byo" }), "org")).toBeNull();
  });
});

describe("sendBatchForOrg", () => {
  it("returns per-recipient errors when blocked", async () => {
    const results = await sendBatchForOrg(fakeDb({ suspended: true }), {
      orgId: "org",
      provider,
      msgs: [{ to: "+61400000001", body: "hi", sender: "+61411111111" }],
    });
    expect(results[0]?.status).toBe("error");
    expect(results[0]?.error).toMatch(/suspended/i);
  });
});
