// Hand-written row types for the SMS module tables:
//   - 20260810100000_sms_foundations (sms_numbers, sms_number_assignments)
//   - 20260810120000_sms_broadcast (sms_lists, sms_list_items,
//     sms_send_log, sms_delivery_events, vw_sms_campaign_summary)
//   - 20260810140000_sms_conversations (sms_conversations, sms_messages,
//     sms_conversation_notes, sms_canned_replies)
//   - 20260811120000_sms_surveys (sms_surveys, sms_survey_questions,
//     sms_survey_sessions, sms_survey_answers + funnel views)
//   - 20260811140000_sms_ballots (sms_surveys ballot columns,
//     sms_ballot_roll, sms_ballot_events, vw_sms_ballot_tally)
//   - 20260811160000_sms_relays (sms_relays, sms_relay_targets,
//     sms_relay_messages)
//   - 20260811190000_sms_ai_reporting (sms_messages.ai_assisted,
//     vw_sms_sender_stats, vw_sms_campaign_rollup)
// TODO: replace with generated types after migration apply (pnpm gen:types).

export type SmsNumberPurpose = "organiser" | "relay" | "survey" | "spare";

export interface SmsNumberRow {
  number_id: number;
  phone_e164: string;
  label: string | null;
  purpose: SmsNumberPurpose;
  organiser_id: number | null;
  provider: string;
  status: "active" | "retired";
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SmsNumberAssignmentRow {
  assignment_id: number;
  number_id: number;
  purpose: SmsNumberPurpose;
  organiser_id: number | null;
  assigned_at: string;
  unassigned_at: string | null;
}

// ─── Phase 1 (broadcast) ────────────────────────────────────────────

export type SmsListStatus =
  | "draft"
  | "queued"
  | "sending"
  | "sent"
  | "paused"
  | "cancelled";

export type SmsListItemStatus =
  | "pending"
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "skipped"
  | "opted_out"
  | "blocked";

export type SmsSendLogStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "blocked";

export type SmsDeliveryEventType =
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "replied"
  | "opted_out";

export interface SmsListRow {
  list_id: number;
  campaign_id: number;
  draft_id: number | null;
  name: string;
  description: string | null;
  status: SmsListStatus;
  source_filters: Record<string, unknown> | null;
  sender_number_id: number | null;
  timezone: string;
  blackout_override: boolean;
  blackout_override_reason: string | null;
  scheduled_for: string | null;
  total_items: number;
  sent_items: number;
  delivered_items: number;
  failed_items: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SmsListItemRow {
  item_id: number;
  list_id: number;
  worker_id: number;
  phone_e164: string | null;
  sort_order: number;
  status: SmsListItemStatus;
  claimed_at: string | null;
  provider_message_id: string | null;
  failure_reason: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  send_before: string | null;
  /** P2P only: per-item opener. NULL uses the board draft body. */
  body_override: string | null;
  created_at: string;
  updated_at: string;
}

export interface SmsSendLogRow {
  send_id: number;
  draft_id: number;
  campaign_id: number;
  worker_id: number;
  list_id: number | null;
  phone_e164: string | null;
  provider_message_id: string | null;
  segments: number | null;
  cost: number | null;
  status: SmsSendLogStatus;
  sent_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  reply_count: number;
  first_reply_at: string | null;
  created_at: string;
}

export interface SmsDeliveryEventRow {
  event_id: number;
  provider_message_id: string;
  event_type: SmsDeliveryEventType;
  part_number: number;
  payload: Record<string, unknown> | null;
  occurred_at: string;
}

// ─── Phase 2 (inbox & 2-way conversations) ──────────────────────────

/**
 * Spoke contact state machine (brief §3.1 item 2) plus 'triage' for
 * unmatched inbound. Inbound always flips a worker-matched thread to
 * 'needs_response' (including closed → reopen).
 */
export type SmsConversationState =
  | "needs_message"
  | "messaged"
  | "needs_response"
  | "convo"
  | "closed"
  | "triage";

export type SmsMessageDirection = "inbound" | "outbound";

export type SmsMessageStatus =
  | "received"
  | "queued"
  | "sent"
  | "delivered"
  | "failed";

export interface SmsConversationRow {
  conversation_id: number;
  our_number_id: number;
  worker_id: number | null;
  phone_e164: string;
  campaign_id: number | null;
  activity_id: number | null;
  state: SmsConversationState;
  assignee_user_id: string | null;
  escalated_to_user_id: string | null;
  claim_user_id: string | null;
  claimed_until: string | null;
  unread_count: number;
  last_message_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SmsMessageRow {
  message_id: number;
  conversation_id: number;
  direction: SmsMessageDirection;
  body: string | null;
  phone_e164: string | null;
  sender_user_id: string | null;
  provider_message_id: string | null;
  interaction_id: number | null;
  status: SmsMessageStatus;
  error: string | null;
  segments: number | null;
  /**
   * Phase 7 (20260811190000, brief §8.2): true when the outbound body
   * originated from an AI "Draft reply" candidate (possibly edited).
   */
  ai_assisted: boolean;
  created_at: string;
}

export interface SmsConversationNoteRow {
  note_id: number;
  conversation_id: number;
  author_user_id: string;
  body: string;
  created_at: string;
}

export interface SmsCannedReplyRow {
  reply_id: number;
  campaign_id: number | null;
  title: string;
  body: string;
  is_active: boolean;
  /**
   * Phase 3 scripted-answer link (20260811100000): the assessment
   * outcome this reply follows up — binary values (yes/no/unsure/
   * abstain) or '1'..'5' for scale ratings. NULL = plain canned reply.
   */
  outcome_value: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Phase 3 (in-chat assessment capture) ───────────────────────────

/**
 * Thread context scopes (brief §7.3): 'conversation' is the native
 * thread; 'activity' filters to activity-linked traffic; 'campaign' /
 * 'all' merge every conversation for the worker (read-only in the UI —
 * the composer always sends to the current conversation).
 */
export type SmsThreadScope = "conversation" | "activity" | "campaign" | "all";

// ─── Phase 4 (survey engine) ────────────────────────────────────────

export type SmsSurveyPurpose = "survey" | "indicative_ballot";
export type SmsSurveyStatus = "draft" | "open" | "paused" | "closed";

export type SmsSurveyPauseMode = "soft" | "hard";

/**
 * Phase 5 ballot revote policy (brief §4.2 / §8.1): 'locked' =
 * one vote per member (default); 'revote_until_close' = last
 * response wins, supersessions logged in sms_ballot_events.
 */
export type SmsBallotRevotePolicy = "locked" | "revote_until_close";
export type SmsSurveyQuestionType = "choice" | "yes_no" | "scale" | "open_text";

/**
 * §4.1 per-recipient session state machine:
 * queued → invited → active → completed | expired | opted_out |
 * handed_off | undeliverable. At most ONE invited/active session
 * per phone (partial unique index).
 */
export type SmsSurveySessionState =
  | "queued"
  | "invited"
  | "active"
  | "completed"
  | "expired"
  | "opted_out"
  | "handed_off"
  | "undeliverable";

export interface SmsSurveyChoiceOption {
  value: string;
  label: string;
  synonyms?: string[];
  /**
   * Explicit write to a 1–5 scale assessment when this option is chosen.
   * null / omitted = don’t write a rating for this option.
   */
  maps_to_rating?: number | null;
  /**
   * Explicit write to a binary assessment (yes|no|unsure|abstain).
   * null / omitted = don’t write a binary value for this option.
   */
  maps_to_binary?: string | null;
}

export interface SmsSurveyScaleRange {
  min: number;
  max: number;
}

/** Per-answer next-question overrides: parsed value → question_id | 'end'. */
export type SmsSurveyBranching = Record<string, number | "end">;

export interface SmsSurveyRow {
  survey_id: number;
  campaign_id: number;
  activity_id: number | null;
  /** Phase 8 (20260811180000): cohort this draft survey was fired from, if any. Provenance/default-selection hint only. */
  source_worker_list_id: number | null;
  title: string;
  purpose: SmsSurveyPurpose;
  status: SmsSurveyStatus;
  version: number;
  /** Trusted-group test survey (default true). Promote clones to a non-test launch. */
  is_test: boolean;
  pause_mode: SmsSurveyPauseMode | null;
  paused_at: string | null;
  archived_at: string | null;
  retry_limit: number;
  question_timeout_minutes: number;
  session_ttl_hours: number;
  reminder_offsets: number[];
  handoff_escalate_to: string | null;
  sender_number_id: number | null;
  timezone: string;
  blackout_override: boolean;
  blackout_override_reason: string | null;
  invitation_body: string | null;
  completion_body: string | null;
  /** Phase 5 (20260811140000): ballot integrity extras. */
  revote_policy: SmsBallotRevotePolicy;
  /** Per-ballot salt for receipt hashes — receipts are recomputed, never stored. */
  receipt_salt: string;
  /** When true the UI shows no per-member answer surface; the tally view is the reporting surface. */
  results_restricted: boolean;
  opened_at: string | null;
  closed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SmsSurveyQuestionRow {
  question_id: number;
  survey_id: number;
  sort_order: number;
  prompt: string;
  qtype: SmsSurveyQuestionType;
  options: SmsSurveyChoiceOption[] | SmsSurveyScaleRange | null;
  branching: SmsSurveyBranching | null;
  write_rating: boolean;
  /** Phase 8 (20260811180000): per-question override of the survey ratings target. NULL = fall back to survey.activity_id. */
  activity_id: number | null;
  invalid_prompt: string | null;
  nudge_text: string | null;
  /** Set when a post-open edit removes a question that already has answers. */
  retired_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SmsSurveySessionRow {
  session_id: number;
  survey_id: number;
  survey_version: number;
  worker_id: number;
  phone_e164: string;
  conversation_id: number | null;
  state: SmsSurveySessionState;
  current_question_id: number | null;
  retry_count: number;
  nudged: boolean;
  reminders_sent: number;
  last_prompt_at: string | null;
  invited_at: string | null;
  first_answer_at: string | null;
  last_activity_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SmsSurveyAnswerRow {
  answer_id: number;
  session_id: number;
  question_id: number;
  raw_body: string | null;
  parsed_value: string | null;
  invalid_attempts: number;
  provider_message_id: string | null;
  received_at: string;
  created_at: string;
}

export interface VwSmsSurveyFunnelRow {
  survey_id: number;
  campaign_id: number;
  total_sessions: number;
  queued_count: number;
  invited_count: number;
  active_count: number;
  completed_count: number;
  expired_count: number;
  opted_out_count: number;
  handed_off_count: number;
  undeliverable_count: number;
  ever_invited_count: number;
  started_count: number;
}

export interface VwSmsSurveyQuestionStatsRow {
  survey_id: number;
  question_id: number;
  sort_order: number;
  qtype: SmsSurveyQuestionType;
  answered_count: number;
  unparsed_count: number;
  invalid_attempts: number;
}

/**
 * Aggregate answer counts per (question, parsed_value) for the visual
 * report (20260812160000). Aggregate only — no worker ids, no raw
 * bodies. open_text is excluded (free text belongs in the CSV).
 */
export interface VwSmsSurveyAnswerDistributionRow {
  survey_id: number;
  question_id: number;
  sort_order: number;
  qtype: SmsSurveyQuestionType;
  parsed_value: string;
  /** Every session that answered, including still-in-progress ones. */
  answer_count: number;
  /** Completed sessions only — the ballot reading of "a response". */
  completed_answer_count: number;
}

// ─── Phase 5 (indicative ballot mode) ───────────────────────────────

/** Eligibility roll frozen at ballot open (§4.2 roll-first). */
export interface SmsBallotRollRow {
  roll_id: number;
  survey_id: number;
  worker_id: number;
  phone_e164: string;
  included_at: string;
  source: "audience_freeze";
}

export type SmsBallotEventType =
  | "roll_frozen"
  | "invitation_sent"
  | "vote_received"
  | "vote_superseded"
  | "vote_rejected_locked"
  | "receipt_sent"
  | "ballot_opened"
  | "ballot_closed"
  | "tally_generated";

/**
 * Append-only ballot audit log (§4.2). vote_received/receipt_sent
 * payloads carry neither choices nor receipt codes; vote_superseded
 * snapshots the prior answers (supersessions are logged).
 */
export interface SmsBallotEventRow {
  event_id: number;
  survey_id: number;
  event_type: SmsBallotEventType;
  worker_id: number | null;
  session_id: number | null;
  payload: Record<string, unknown> | null;
  occurred_at: string;
}

/** Aggregate tally row — no worker ids (vw_sms_ballot_tally). */
export interface VwSmsBallotTallyRow {
  survey_id: number;
  question_id: number;
  sort_order: number;
  qtype: SmsSurveyQuestionType;
  parsed_value: string;
  vote_count: number;
}

/** The `ballot` block on the survey detail GET (purpose = indicative_ballot). */
export interface SmsBallotDetail {
  turnout: {
    roll_count: number;
    votes_cast: number;
    turnout_pct: number;
  };
  tally: VwSmsBallotTallyRow[];
  /** Recomputed receipt codes, lexicographically sorted (never stored, never worker-linked). */
  receipts: string[];
  events: SmsBallotEventRow[];
}

// ─── Phase 6 (relay & forwarding — "patch-through") ─────────────────

/** Created 'paused' — forwarding starts only on explicit activation. */
export type SmsRelayStatus = "active" | "paused" | "ended";

export type SmsRelayDirection = "member_to_target" | "target_to_member";

export type SmsRelayModerationStatus =
  | "auto_approved"
  | "pending"
  | "approved"
  | "rejected";

/**
 * held = not scheduled to forward (pending moderation, relay paused,
 * opted-out member, unbridgeable target reply); queued = approved,
 * awaiting a send slot / retry (the timers cron drains these — and
 * nothing else); sending = claimed by an in-flight send (claimed_at-
 * stamped, stale-swept back to queued after 15 min); sent/delivered/
 * failed = provider outcome (forwarded_at only set on success);
 * rejected = moderation rejected.
 */
export type SmsRelayForwardStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "held"
  | "rejected";

export interface SmsRelayRow {
  relay_id: number;
  /** NULL = org-wide relay. */
  campaign_id: number | null;
  name: string;
  number_id: number;
  prefix_template: string | null;
  suffix_template: string | null;
  status: SmsRelayStatus;
  moderation_required: boolean;
  quiet_hours_respected: boolean;
  timezone: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SmsRelayTargetRow {
  target_id: number;
  relay_id: number;
  /** The external party's mobile — never exposed to members. */
  phone_e164: string;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
}

export interface SmsRelayMessageRow {
  relay_message_id: number;
  relay_id: number;
  direction: SmsRelayDirection;
  member_worker_id: number | null;
  member_phone_e164: string | null;
  target_id: number | null;
  /** Original inbound body, verbatim. */
  body: string | null;
  /**
   * The exact outbound forward body, both directions (member→target:
   * prefix + member message + suffix; target→member: display-name-
   * prefixed reply), rendered at receipt time.
   */
  forwarded_body: string | null;
  moderation_status: SmsRelayModerationStatus;
  moderated_by: string | null;
  moderated_at: string | null;
  provider_message_id: string | null;
  forward_provider_message_id: string | null;
  forward_status: SmsRelayForwardStatus;
  /** 'sending' claim stamp (stale-swept by the cron). */
  claimed_at: string | null;
  /** Only set after a successful provider send. */
  forwarded_at: string | null;
  created_at: string;
}

// ─── Phase 7 (AI assist & reporting) ────────────────────────────────

/**
 * vw_sms_sender_stats (20260811190000): per (campaign, sender)
 * outbound stats. campaign_id NULL = org-wide triage threads;
 * median_reply_latency_seconds NULL when the sender has no
 * inbound→outbound pairs.
 */
export interface VwSmsSenderStatsRow {
  campaign_id: number | null;
  sender_user_id: string;
  replies_sent: number;
  conversations: number;
  ai_assisted_count: number;
  median_reply_latency_seconds: number | null;
}

/**
 * vw_sms_campaign_rollup (20260811190000): campaign-level totals
 * across blasts / conversations / surveys. Rates use delivered as the
 * denominator (brief §3.1 item 11).
 */
export interface VwSmsCampaignRollupRow {
  campaign_id: number;
  blast_count: number;
  sends_count: number;
  delivered_count: number;
  failed_count: number;
  delivery_rate_pct: number;
  conversation_count: number;
  active_conversation_count: number;
  inbound_reply_count: number;
  conversations_with_reply: number;
  reply_rate_pct: number;
  opt_outs_count: number;
  survey_count: number;
  surveys_completed_count: number;
}

export interface VwSmsCampaignSummaryRow {
  campaign_id: number;
  list_id: number;
  list_name: string;
  list_status: SmsListStatus;
  draft_id: number | null;
  sender_number_id: number | null;
  timezone: string;
  blackout_override: boolean;
  scheduled_for: string | null;
  total_items: number;
  sent_items: number;
  delivered_items: number;
  failed_items: number;
  created_at: string;
  item_count: number;
  pending_count: number;
  queued_count: number;
  sending_count: number;
  sent_count: number;
  delivered_count: number;
  failed_count: number;
  skipped_count: number;
  opted_out_count: number;
  blocked_count: number;
  delivery_rate_pct: number;
}

// ─── P2P chat boards (20260812140000) ───────────────────────────────

/**
 * sms_lists.mode: 'blast' = cron-drained broadcast, 'p2p' = chat-board
 * working list (progressive per-selection sends; never queued/sending).
 */
export type SmsListMode = "blast" | "p2p";

/**
 * vw_sms_campaign_summary after 20260812140000 appends the trailing
 * `mode` column. Optional until the migration is applied everywhere —
 * consumers treat a missing mode as 'blast'.
 */
export interface VwSmsCampaignSummaryRowWithMode
  extends VwSmsCampaignSummaryRow {
  mode?: SmsListMode;
}

/** Board row DTO from GET /api/campaigns/[id]/sms-lists/[listId]/p2p. */
export interface SmsP2pBoardItem {
  item_id: number;
  worker_id: number;
  worker_name: string;
  first_name: string;
  last_name: string;
  occupation: string | null;
  employer_name: string | null;
  phone_e164: string | null;
  sort_order: number;
  status: SmsListItemStatus;
  failure_reason: string | null;
  sent_at: string | null;
  sms_opt_out: boolean;
  conversation_id: number | null;
  conversation_state: SmsConversationState | null;
  unread_count: number;
  /** Per-item opener. NULL = board default. */
  body_override: string | null;
}

/** Payload of GET /api/campaigns/[id]/sms-lists/[listId]/p2p. */
export interface SmsP2pBoardPayload {
  list: {
    list_id: number;
    campaign_id: number;
    name: string;
    status: SmsListStatus;
    mode: SmsListMode;
    sender_number_id: number | null;
    sender_phone_e164: string | null;
    sender_label: string | null;
    timezone: string;
    created_at: string;
  };
  draft: { draft_id: number; body: string } | null;
  items: SmsP2pBoardItem[];
  /** Campaign merge-field base context for client-side previews. */
  merge_context: Record<string, string | undefined>;
}

/** Per-item outcome from POST .../p2p-send. */
export interface SmsP2pSendResultItem {
  item_id: number;
  status: "sent" | "failed" | "blocked" | "opted_out" | "skipped";
  conversation_id: number | null;
  error: string | null;
}

export interface SmsP2pSendResponse {
  ok: true;
  sent: number;
  failed: number;
  blocked: number;
  opted_out: number;
  skipped: number;
  results: SmsP2pSendResultItem[];
}
