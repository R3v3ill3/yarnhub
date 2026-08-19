export type OrgRole = "owner" | "admin" | "member";

export type SmsNumberPurpose = "inbox" | "survey" | "relay" | "spare";

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  public_id: string;
  timezone: string;
  created_at: string;
  sending_suspended?: boolean;
  kyc_status?: "none" | "pending" | "approved" | "rejected";
  kyc_legal_name?: string | null;
  kyc_abn?: string | null;
}

export interface OrganisationMember {
  organisation_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
}

export interface Contact {
  id: string;
  organisation_id: string;
  first_name: string | null;
  last_name: string | null;
  phone_e164: string;
  sms_opt_out: boolean;
  sms_opt_out_at: string | null;
  sms_opt_out_source: string | null;
  sms_consent_source: "manual" | "import" | "legacy" | null;
  notes: string | null;
  created_at: string;
}

export interface ProviderAccount {
  id: string;
  organisation_id: string;
  provider: string;
  mode: "byo" | "hosted";
  credentials_ciphertext: string | null;
  webhook_secret_ciphertext: string | null;
  last_verified_at: string | null;
  created_at: string;
}

export interface SmsNumber {
  id: string;
  organisation_id: string;
  provider_account_id: string;
  phone_e164: string;
  purpose: SmsNumberPurpose;
  status: "active" | "retired";
  label: string | null;
  created_at: string;
}

export interface SmsConversation {
  id: string;
  organisation_id: string;
  our_number_id: string;
  contact_id: string | null;
  phone_e164: string;
  state: "open" | "needs_reply" | "closed";
  last_message_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  unread_count: number;
  created_at: string;
}

export interface SmsMessage {
  id: string;
  organisation_id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  body: string;
  phone_e164: string | null;
  sender_user_id: string | null;
  provider_message_id: string | null;
  status: string | null;
  created_at: string;
}

export type BlastStatus =
  | "draft"
  | "queued"
  | "sending"
  | "sent"
  | "paused"
  | "cancelled";

export type BlastItemStatus =
  | "queued"
  | "sending"
  | "sent"
  | "blocked"
  | "failed"
  | "opted_out"
  | "skipped";

export interface ContactList {
  id: string;
  organisation_id: string;
  name: string;
  created_at: string;
}

export interface SmsBlast {
  id: string;
  organisation_id: string;
  name: string | null;
  body: string;
  sender_number_id: string;
  timezone: string;
  blackout_override: boolean;
  blackout_override_reason: string | null;
  scheduled_for: string | null;
  status: BlastStatus;
  created_by: string | null;
  queued_at: string | null;
  completed_at: string | null;
  created_at: string;
}
