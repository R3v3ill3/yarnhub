import type {
  MessageStatus,
  OutboundSms,
  SenderId,
  SendResult,
  SmsProvider,
  SmsWebhookEvent,
} from "./types";

export interface RecordedSend {
  message: OutboundSms;
  result: SendResult;
  idempotencyKey: string | null;
  sentAt: string;
}

/**
 * In-memory provider for local dev and tests: records every send,
 * answers status/senders/balance queries with fixed data, and can
 * synthesise webhook events so send/receive flows are testable without
 * credits or a provider account.
 */
export class MockSmsProvider implements SmsProvider {
  readonly name = "mock";
  readonly capabilities = { mms: false };

  readonly sends: RecordedSend[] = [];
  private counter = 0;
  balance = 1000;

  async sendBatch(
    msgs: OutboundSms[],
    opts?: { idempotencyKey?: string }
  ): Promise<SendResult[]> {
    return msgs.map((message) => {
      this.counter++;
      const result: SendResult = {
        to: message.to,
        status: "success",
        providerMessageId: `mock-${this.counter}`,
        customRef: message.customRef ?? null,
        cost: 1,
        encoding: "gsm",
      };
      this.sends.push({
        message,
        result,
        idempotencyKey: opts?.idempotencyKey ?? null,
        sentAt: new Date().toISOString(),
      });
      this.balance = Math.max(0, this.balance - 1);
      return result;
    });
  }

  async getMessageStatus(providerMessageId: string): Promise<MessageStatus> {
    const known = this.sends.some((s) => s.result.providerMessageId === providerMessageId);
    return {
      providerMessageId,
      status: known ? "delivered" : "unknown",
      deliveredAt: known ? new Date().toISOString() : null,
    };
  }

  async listSenders(): Promise<SenderId[]> {
    return [{ sender: "+61400000001", type: "dedicated_number", status: "active" }];
  }

  async getCreditBalance(): Promise<number> {
    return this.balance;
  }

  verifyWebhook(): boolean {
    return true;
  }

  parseWebhook(rawBody: string): SmsWebhookEvent {
    try {
      return JSON.parse(rawBody) as SmsWebhookEvent;
    } catch {
      return { type: "unknown", raw: rawBody };
    }
  }

  /** Synthesise an inbound reply to the most recent send to `from` (tests). */
  synthesiseInbound(from: string, body: string): SmsWebhookEvent {
    const lastSend = [...this.sends].reverse().find((s) => s.message.to === from);
    return {
      type: "inbound",
      from,
      to: lastSend?.message.sender ?? "+61400000001",
      body,
      providerMessageId: `mock-in-${++this.counter}`,
      originalMessageId: lastSend?.result.providerMessageId ?? null,
      originalCustomRef: lastSend?.message.customRef ?? null,
      receivedAt: new Date().toISOString(),
    };
  }

  /** Synthesise a delivery status event for a recorded send (tests). */
  synthesiseStatus(
    providerMessageId: string,
    status: "delivered" | "failed"
  ): SmsWebhookEvent {
    const send = this.sends.find((s) => s.result.providerMessageId === providerMessageId);
    return {
      type: "status",
      providerMessageId,
      customRef: send?.message.customRef ?? null,
      status,
      occurredAt: new Date().toISOString(),
    };
  }

  reset(): void {
    this.sends.length = 0;
    this.counter = 0;
    this.balance = 1000;
  }
}
