/**
 * SMS provider interface — modelled on `lib/phone/telephony/types.ts`.
 *
 * First implementation is Mobile Message (mobilemessage.com.au); a mock
 * provider covers local dev and tests. The interface keeps a future
 * provider swap (Twilio, etc.) cheap: consumers only ever see
 * `getSmsProvider()` from `@/lib/sms/provider`.
 */

export interface OutboundSms {
  /** Recipient, E.164 (`+614xxxxxxxx`). */
  to: string;
  body: string;
  /** Registered sender: dedicated number, shared number or alpha sender ID. */
  sender: string;
  /** Our correlation ref (e.g. send_log id) echoed back on webhooks. */
  customRef?: string;
  /** ISO 8601 timestamp for a scheduled send. */
  scheduledFor?: string;
  /** Reserved for MMS-optionality (brief §8.1) — Mobile Message has no MMS today. */
  media?: null;
}

export type SendResultStatus = "success" | "blocked" | "error";

export interface SendResult {
  to: string;
  /** `blocked` = recipient unsubscribed provider-side; message not sent. */
  status: SendResultStatus;
  providerMessageId: string | null;
  customRef?: string | null;
  /** Credits consumed (message parts). */
  cost?: number;
  encoding?: string;
  error?: string;
}

export type MessageDeliveryStatus =
  | "pending"
  | "scheduled"
  | "sent"
  | "delivered"
  | "failed"
  | "cancelled"
  | "unknown";

export interface MessageStatus {
  providerMessageId: string;
  status: MessageDeliveryStatus;
  customRef?: string | null;
  deliveredAt?: string | null;
}

export interface SenderId {
  sender: string;
  type?: string;
  status?: string;
}

/** Parsed webhook payload: inbound reply, platform-side STOP, or delivery status. */
export type SmsWebhookEvent =
  | {
      type: "inbound";
      from: string;
      to: string;
      body: string;
      providerMessageId: string | null;
      /** Provider's reply correlation to the most recent outbound. */
      originalMessageId: string | null;
      originalCustomRef: string | null;
      receivedAt: string | null;
    }
  | {
      type: "unsubscribe";
      from: string;
      to: string;
      providerMessageId: string | null;
      receivedAt: string | null;
    }
  | {
      type: "status";
      providerMessageId: string | null;
      customRef: string | null;
      status: MessageDeliveryStatus;
      occurredAt: string | null;
    }
  | { type: "unknown"; raw: unknown };

export interface SmsProvider {
  readonly name: string;
  /** MMS-optionality from day one (brief §8.1). */
  readonly capabilities: { mms: boolean };

  sendBatch(
    msgs: OutboundSms[],
    opts?: { idempotencyKey?: string }
  ): Promise<SendResult[]>;

  getMessageStatus(providerMessageId: string): Promise<MessageStatus>;

  listSenders(): Promise<SenderId[]>;

  /** Remaining credit balance. */
  getCreditBalance(): Promise<number>;

  /** Verify a webhook's HMAC signature against the raw request body. */
  verifyWebhook(rawBody: string, headers: Record<string, string>): boolean;

  parseWebhook(rawBody: string): SmsWebhookEvent;
}
