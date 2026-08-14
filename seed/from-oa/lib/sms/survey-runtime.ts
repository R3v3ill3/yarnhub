/**
 * Server-side survey session runtime (brief §4.1) — the I/O layer
 * around the pure engine in `survey-engine.ts`. Shared by the webhook
 * inbound leg (answer processing), survey open (immediate invitations
 * via `survey-invitation-dispatch`), and the timers cron (invitations,
 * nudges, reminders, TTL expiry).
 *
 * Everything here runs on the SERVICE-ROLE client: sms_survey_sessions
 * / sms_survey_answers have no authenticated write policies. Campaign
 * scoping is enforced upstream (surveys are built via RLS-checked
 * routes; the campaign/activity pairing is validated at build time),
 * which is what makes these admin writes safe.
 *
 * Conversation policy (decided in-phase):
 *   - every survey message (in and out) is appended to the session's
 *     inbox thread, so a handoff always arrives with the transcript;
 *   - ordinary Q↔A traffic does TIMESTAMP-ONLY touches (no unread
 *     bump / needs_response flip) so live surveys don't flood the
 *     inbox queues — only freetext-on-choice captures and handoffs
 *     surface the thread via touch_sms_conversation_inbound;
 *   - in-session replies (next question, re-prompts, completion) send
 *     immediately — they are conversational, never blackout-blocked
 *     (the Phase 2 1:1 rule). Invitations/nudges/reminders are
 *     bulk-adjacent and respect the blackout window (cron-side).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SmsProvider, SendResult } from "@/lib/sms/provider";
import { countSegments } from "@/lib/sms/segments";
import {
  BALLOT_LOCKED_REPLY,
  appendReceiptToCompletion,
  computeBallotReceipt,
  decideBallotRevote,
} from "@/lib/sms/ballot";
import {
  nextStep,
  outcomeMapping,
  parseAnswer,
  renderQuestion,
  retryLadder,
} from "@/lib/sms/survey-engine";
import type {
  SmsBallotEventType,
  SmsSurveyQuestionRow,
  SmsSurveyRow,
  SmsSurveySessionRow,
} from "@/types/sms";
import { loadQuestionsForVersion } from "@/lib/sms/survey-versions";

const UNIQUE_VIOLATION = "23505";
/** sms_interactions.phone_number is VARCHAR(30). */
const PHONE_NUMBER_MAX = 30;
/** sms_survey_answers.parsed_value is VARCHAR(50). */
const PARSED_MAX = 50;
/** sms_interactions.cta_response rides into binary_value (VARCHAR(30)). */
const CTA_MAX = 30;

// Untyped admin/service client (survey tables are not in generated
// types until the migration is applied).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export const LIVE_SESSION_STATES = ["invited", "active"] as const;

export interface SurveyBundle {
  survey: SmsSurveyRow;
  questions: SmsSurveyQuestionRow[];
}

export async function loadSurveyBundle(
  db: Db,
  surveyId: number,
  surveyVersion?: number | null,
): Promise<SurveyBundle | null> {
  const { data: survey, error } = await db
    .from("sms_surveys")
    .select("*")
    .eq("survey_id", surveyId)
    .maybeSingle();
  if (error) throw error;
  if (!survey) return null;
  const questions =
    surveyVersion != null
      ? await loadQuestionsForVersion(db, surveyId, surveyVersion)
      : await loadQuestionsForVersion(
          db,
          surveyId,
          (survey as SmsSurveyRow).version,
        );
  return {
    survey: survey as SmsSurveyRow,
    questions,
  };
}

/**
 * The one live ('invited'/'active') session on a phone — the partial
 * unique index guarantees at most one exists.
 */
export async function findLiveSessionByPhone(
  db: Db,
  phoneE164: string,
): Promise<SmsSurveySessionRow | null> {
  const { data, error } = await db
    .from("sms_survey_sessions")
    .select("*")
    .eq("phone_e164", phoneE164)
    .in("state", [...LIVE_SESSION_STATES])
    .limit(1);
  if (error) throw error;
  return (data?.[0] as SmsSurveySessionRow | undefined) ?? null;
}

/**
 * Terminate a phone's survey sessions on opt-out (brief §2.3
 * constraint 3: unsubscribe events double as session terminators).
 * Queued sessions are ended too — an opted-out member must not be
 * invited later.
 */
export async function terminateSessionsForPhone(
  db: Db,
  phoneE164: string,
  occurredAt: string,
): Promise<Array<{ session_id: number; conversation_id: number | null }>> {
  const { data, error } = await db
    .from("sms_survey_sessions")
    .update({ state: "opted_out", last_activity_at: occurredAt })
    .eq("phone_e164", phoneE164)
    .in("state", ["queued", ...LIVE_SESSION_STATES])
    .select("session_id, conversation_id");
  if (error) {
    console.error("terminateSessionsForPhone failed:", error);
    return [];
  }
  return (data ?? []) as Array<{
    session_id: number;
    conversation_id: number | null;
  }>;
}

/**
 * Find-or-create the campaign-scoped inbox thread for a survey
 * session on the survey's sender number (the blast-mirror idiom:
 * prefer an open thread on the pair — campaign scope first, then
 * most recent — else upsert on the NULLS-NOT-DISTINCT thread key,
 * which also reopens a closed same-key thread as 'messaged').
 */
export async function ensureSurveyConversation(
  db: Db,
  args: {
    ourNumberId: number;
    phoneE164: string;
    workerId: number;
    campaignId: number;
    occurredAt: string;
  },
): Promise<number | null> {
  const { ourNumberId, phoneE164, workerId, campaignId, occurredAt } = args;
  const { data: open, error } = await db
    .from("sms_conversations")
    .select("conversation_id, campaign_id, last_message_at")
    .eq("our_number_id", ourNumberId)
    .eq("phone_e164", phoneE164)
    .neq("state", "closed");
  if (error) throw error;
  const candidates = (open ?? []) as Array<{
    conversation_id: number;
    campaign_id: number | null;
    last_message_at: string | null;
  }>;
  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      const aScope = a.campaign_id === campaignId ? 0 : 1;
      const bScope = b.campaign_id === campaignId ? 0 : 1;
      if (aScope !== bScope) return aScope - bScope;
      const aT = a.last_message_at ? Date.parse(a.last_message_at) : 0;
      const bT = b.last_message_at ? Date.parse(b.last_message_at) : 0;
      return bT - aT;
    });
    return candidates[0].conversation_id;
  }

  const { data: created, error: upErr } = await db
    .from("sms_conversations")
    .upsert(
      {
        our_number_id: ourNumberId,
        phone_e164: phoneE164,
        worker_id: workerId,
        campaign_id: campaignId,
        state: "messaged",
        last_message_at: occurredAt,
        last_outbound_at: occurredAt,
      },
      { onConflict: "our_number_id,phone_e164,campaign_id" },
    )
    .select("conversation_id")
    .single();
  if (upErr) {
    console.error("ensureSurveyConversation upsert failed:", upErr);
    return null;
  }
  return (created?.conversation_id as number | undefined) ?? null;
}

/**
 * Guarded, monotonic timestamp touch — recency only, no unread bump
 * or state flip (survey traffic must not flood the inbox queues).
 */
export async function touchConversationTimestamps(
  db: Db,
  conversationId: number,
  occurredAt: string,
  direction: "inbound" | "outbound",
): Promise<void> {
  const stamp =
    direction === "inbound"
      ? { last_message_at: occurredAt, last_inbound_at: occurredAt }
      : { last_message_at: occurredAt, last_outbound_at: occurredAt };
  const { error } = await db
    .from("sms_conversations")
    .update(stamp)
    .eq("conversation_id", conversationId)
    .or(`last_message_at.is.null,last_message_at.lt.${occurredAt}`);
  if (error) console.error("touchConversationTimestamps failed:", error);
}

/**
 * Append a message row to the thread — idempotent on
 * provider_message_id. Returns whether the row is NEW (the gate for
 * every session side effect).
 */
export async function appendSurveyMessage(
  db: Db,
  row: {
    conversation_id: number;
    direction: "inbound" | "outbound";
    body: string | null;
    phone_e164: string | null;
    provider_message_id: string | null;
    interaction_id?: number | null;
    status: string;
    error?: string | null;
    created_at: string;
  },
): Promise<boolean> {
  const messageRow = {
    ...row,
    segments: row.body ? countSegments(row.body).segments : null,
  };
  if (row.provider_message_id) {
    const { data, error } = await db
      .from("sms_messages")
      .upsert(messageRow, {
        onConflict: "provider_message_id",
        ignoreDuplicates: true,
      })
      .select("message_id");
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return false;
      throw error;
    }
    return (data?.length ?? 0) > 0;
  }
  const { error } = await db.from("sms_messages").insert(messageRow);
  if (error) throw error;
  return true;
}

export type SurveyPromptKind =
  | "invitation"
  | "question"
  | "reprompt"
  | "completion"
  | "nudge"
  | "reminder"
  | "ballot_locked";

/**
 * Send one survey prompt from the survey's sender number and mirror
 * it into the session's thread. Returns the provider result (or null
 * when the provider call itself threw — the caller decides whether
 * that reverts a claim or is simply logged; an already-recorded
 * answer must never be lost to a failed send).
 */
export async function sendSurveyPrompt(
  db: Db,
  provider: SmsProvider,
  args: {
    session: Pick<
      SmsSurveySessionRow,
      "session_id" | "phone_e164" | "conversation_id"
    >;
    senderDigits: string;
    body: string;
    kind: SurveyPromptKind;
  },
): Promise<SendResult | null> {
  const { session, senderDigits, body, kind } = args;
  const sentAt = new Date().toISOString();
  let result: SendResult | null = null;
  try {
    const results = await provider.sendBatch(
      [
        {
          to: session.phone_e164,
          body,
          sender: senderDigits,
          customRef: `survey-${session.session_id}`,
        },
      ],
      { idempotencyKey: `sms-survey-${session.session_id}-${kind}-${Date.now()}` },
    );
    result = results[0] ?? null;
  } catch (err) {
    console.error(
      `sendSurveyPrompt: provider send failed (session ${session.session_id}, ${kind}):`,
      err,
    );
    return null;
  }

  if (session.conversation_id != null) {
    try {
      await appendSurveyMessage(db, {
        conversation_id: session.conversation_id,
        direction: "outbound",
        body,
        phone_e164: session.phone_e164,
        provider_message_id: result?.providerMessageId ?? null,
        status: result?.status === "success" ? "sent" : "failed",
        error:
          result?.status === "success"
            ? null
            : (result?.error ?? `Provider send ${result?.status ?? "failed"}`),
        created_at: sentAt,
      });
      await touchConversationTimestamps(
        db,
        session.conversation_id,
        sentAt,
        "outbound",
      );
    } catch (err) {
      console.error(
        `sendSurveyPrompt: thread mirror failed (session ${session.session_id}):`,
        err,
      );
    }
  }
  return result;
}

/** Opt-out mirror on the worker row (compliance-critical, guarded). */
export async function mirrorWorkerOptOut(
  db: Db,
  workerId: number,
  occurredAt: string,
): Promise<void> {
  const { error } = await db
    .from("workers")
    .update({
      sms_opt_out: true,
      sms_opt_out_at: occurredAt,
      sms_opt_out_source: "inbound_stop",
    })
    .eq("worker_id", workerId)
    .eq("sms_opt_out", false);
  if (error) console.error("mirrorWorkerOptOut failed:", error);
}

// ─── Phase 5: ballot integrity helpers (brief §4.2) ─────────────────

export interface BallotEventInsert {
  survey_id: number;
  event_type: SmsBallotEventType;
  worker_id?: number | null;
  session_id?: number | null;
  payload?: Record<string, unknown> | null;
  occurred_at?: string;
}

/**
 * Append rows to the sms_ballot_events audit log — best-effort
 * (logged, never throws): a lost event row must not 500 the webhook
 * or lose an already-recorded vote. At-least-once overall; the
 * documented crash windows are in the Phase 5 plan.
 */
export async function recordBallotEvents(
  db: Db,
  rows: BallotEventInsert[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await db.from("sms_ballot_events").insert(rows);
  if (error) console.error("recordBallotEvents failed:", error);
}

/**
 * Recompute a session's receipt code (§4.2): the non-NULL parsed
 * answers in question order (bound to their question ids), hashed
 * with the ballot's salt. Receipts are never stored — completion
 * sends and the audit list both come through here.
 */
export async function computeSessionReceipt(
  db: Db,
  survey: Pick<SmsSurveyRow, "receipt_salt">,
  questions: SmsSurveyQuestionRow[],
  sessionId: number,
  workerId: number,
): Promise<string> {
  const { data, error } = await db
    .from("sms_survey_answers")
    .select("question_id, parsed_value")
    .eq("session_id", sessionId)
    .not("parsed_value", "is", null);
  if (error) throw error;
  const byQuestion = new Map<number, string>(
    ((data ?? []) as Array<{ question_id: number; parsed_value: string }>).map(
      (a) => [a.question_id, a.parsed_value],
    ),
  );
  const ordered = [...questions]
    .sort((a, b) => a.sort_order - b.sort_order || a.question_id - b.question_id)
    .map((q) => {
      const value = byQuestion.get(q.question_id);
      return value != null ? { questionId: q.question_id, value } : null;
    })
    .filter((a): a is { questionId: number; value: string } => a != null);
  return computeBallotReceipt(survey.receipt_salt, workerId, ordered);
}

/**
 * The most recent COMPLETED session on this phone whose survey is an
 * OPEN indicative ballot — the revote/locked leg's lookup (webhook
 * precedence step 2b). Ordinary surveys' completed sessions are never
 * matched, so their inbound still falls through to conversational
 * routing bit-for-bit.
 */
export async function findCompletedBallotSessionByPhone(
  db: Db,
  phoneE164: string,
): Promise<SmsSurveySessionRow | null> {
  const { data, error } = await db
    .from("sms_survey_sessions")
    .select("*, sms_surveys!inner(status, purpose)")
    .eq("phone_e164", phoneE164)
    .eq("state", "completed")
    .eq("sms_surveys.status", "open")
    .eq("sms_surveys.purpose", "indicative_ballot")
    .order("completed_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data?.[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  // Strip the join column before handing back a session row.
  const { sms_surveys: _join, ...session } = row;
  void _join;
  return session as unknown as SmsSurveySessionRow;
}

async function loadSenderDigits(
  db: Db,
  numberId: number | null,
): Promise<string | null> {
  if (numberId == null) return null;
  const { data } = await db
    .from("sms_numbers")
    .select("phone_e164, status")
    .eq("number_id", numberId)
    .maybeSingle();
  if (!data || data.status !== "active") return null;
  return (data.phone_e164 as string).replace(/^\+/, "");
}

export interface SurveyInboundArgs {
  session: SmsSurveySessionRow;
  phoneE164: string;
  body: string;
  providerMessageId: string | null;
  receivedAt: string;
}

export interface SurveyInboundResult {
  /** false = the survey no longer applies; fall through to conversational routing. */
  handled: boolean;
  response: Record<string, unknown>;
}

/**
 * The webhook survey leg: parse the inbound against the session's
 * current question, record the answer / walk the retry ladder /
 * branch / complete / hand off, and send the next prompt.
 *
 * Idempotency: the thread-append upsert on provider_message_id is the
 * single gate — a redelivered webhook records nothing twice and sends
 * nothing twice.
 */
export async function processSurveyInbound(
  db: Db,
  provider: SmsProvider,
  args: SurveyInboundArgs,
): Promise<SurveyInboundResult> {
  const { session, phoneE164, body, providerMessageId, receivedAt } = args;

  const bundle = await loadSurveyBundle(
    db,
    session.survey_id,
    session.survey_version,
  );
  if (!bundle || bundle.questions.length === 0) {
    await db
      .from("sms_survey_sessions")
      .update({ state: "expired", last_activity_at: receivedAt })
      .eq("session_id", session.session_id)
      .in("state", [...LIVE_SESSION_STATES]);
    return { handled: false, response: {} };
  }
  const { survey, questions } = bundle;

  // Hard pause: acknowledge but do not advance / record answers.
  if (survey.status === "paused" && survey.pause_mode === "hard") {
    if (survey.sender_number_id) {
      try {
        const { data: sender } = await db
          .from("sms_numbers")
          .select("phone_e164")
          .eq("number_id", survey.sender_number_id)
          .maybeSingle();
        const digits = (sender?.phone_e164 as string | undefined)?.replace(
          /^\+/,
          "",
        );
        if (digits) {
          await sendSurveyPrompt(db, provider, {
            session,
            senderDigits: digits,
            body:
              "This survey is paused — please wait for a follow-up message. Offshore Alliance.",
            kind: "nudge",
          });
        }
      } catch (err) {
        console.error("hard-pause auto-reply failed:", err);
      }
    }
    return {
      handled: true,
      response: {
        ok: true,
        survey_session_id: session.session_id,
        paused: true,
        pause_mode: "hard",
      },
    };
  }

  // Soft pause or closed/broken: only open (+ soft paused) accept answers.
  if (survey.status !== "open" && survey.status !== "paused") {
    await db
      .from("sms_survey_sessions")
      .update({ state: "expired", last_activity_at: receivedAt })
      .eq("session_id", session.session_id)
      .in("state", [...LIVE_SESSION_STATES]);
    return { handled: false, response: {} };
  }
  if (survey.status === "paused" && survey.pause_mode !== "soft") {
    return {
      handled: true,
      response: {
        ok: true,
        survey_session_id: session.session_id,
        paused: true,
      },
    };
  }

  const currentQuestion =
    questions.find((q) => q.question_id === session.current_question_id) ??
    questions[0];

  const parsed = parseAnswer(currentQuestion, body);

  // ── Idempotency gates (up front, BEFORE any write) ──────────
  // Dedupe requires BOTH: the thread message already recorded AND an
  // answer row present for the current question. Gating on the
  // message alone would make a crash between the thread append and
  // the answer upsert drop the answer forever on the provider's
  // retry (at-most-once); gating on the answer means the retry
  // RECOVERS the crash window instead (at-least-once).
  let messageExisted = false;
  if (providerMessageId) {
    const { data: existingMsg } = await db
      .from("sms_messages")
      .select("message_id")
      .eq("provider_message_id", providerMessageId)
      .maybeSingle();
    messageExisted = !!existingMsg;
  }
  const { data: existingAnswerRows } = await db
    .from("sms_survey_answers")
    .select("parsed_value, invalid_attempts, raw_body, received_at")
    .eq("session_id", session.session_id)
    .eq("question_id", currentQuestion.question_id)
    .limit(1);
  const existingAnswer = existingAnswerRows?.[0] as
    | {
        parsed_value: string | null;
        invalid_attempts: number;
        raw_body: string | null;
        received_at: string;
      }
    | undefined;

  const dedupeResponse: SurveyInboundResult = {
    handled: true,
    response: {
      ok: true,
      survey_session_id: session.session_id,
      deduplicated: true,
    },
  };
  // Once an inbound is on the thread, never re-run survey side effects
  // against a possibly-advanced current_question. MM account webhooks
  // historically lacked message_id and retried 2–3×; re-processing the
  // same "2"/"5"/"Yes" against the next question skipped prompts and
  // fired spurious invalids. Prefer at-most-once sends over recovering
  // a crash between append and answer upsert.
  if (messageExisted) return dedupeResponse;

  // Question already has a real answer — webhook retry / out-of-order
  // delivery must not advance again or send the next prompt twice.
  if (existingAnswer?.parsed_value != null) return dedupeResponse;

  // No provider message id = no dedupe handle. Cheap replay guard: an
  // identical raw body already captured on this question within the
  // last 10 minutes is treated as a redelivery.
  const REPLAY_WINDOW_MS = 10 * 60 * 1000;
  if (
    !providerMessageId &&
    existingAnswer &&
    existingAnswer.raw_body === body &&
    Math.abs(Date.parse(receivedAt) - Date.parse(existingAnswer.received_at)) <=
      REPLAY_WINDOW_MS
  ) {
    return dedupeResponse;
  }

  // Interaction row (the §5.1 audit + rating pipeline). Rating values
  // ride ONLY on parsed write_rating answers — fn_sms_to_rating treats
  // cta_response as a binary whenever activity_id is set, so all three
  // stay NULL otherwise. Phase 8: the target activity is the
  // per-question override when set, else the survey-level target —
  // the gate is COALESCE-aware (not just the stamped column) so a
  // question-level target with no survey-level target still writes,
  // even though the current UI cannot produce that state.
  const targetActivityId = currentQuestion.activity_id ?? survey.activity_id;
  const isRatingAnswer =
    parsed.kind === "parsed" &&
    currentQuestion.write_rating &&
    targetActivityId != null;
  let targetIsBinary: boolean | null = null;
  if (isRatingAnswer && targetActivityId != null) {
    const { data: targetAct } = await db
      .from("campaign_activities")
      .select("is_binary")
      .eq("activity_id", targetActivityId)
      .maybeSingle();
    targetIsBinary =
      typeof targetAct?.is_binary === "boolean" ? targetAct.is_binary : null;
  }
  const mapping = isRatingAnswer
    ? outcomeMapping(
        currentQuestion,
        parsed.kind === "parsed" ? parsed.value : "",
        { isBinary: targetIsBinary },
      )
    : { rating: null, binary: null };
  const hasMapping = mapping.rating != null || mapping.binary != null;

  let interactionId: number | null = null;
  if (providerMessageId) {
    const { data: existing } = await db
      .from("sms_interactions")
      .select("id")
      .eq("external_message_id", providerMessageId)
      .maybeSingle();
    if (existing) interactionId = existing.id as number;
  }
  if (interactionId == null) {
    const { data: inserted, error: insErr } = await db
      .from("sms_interactions")
      .insert({
        worker_id: session.worker_id,
        campaign_id: survey.campaign_id,
        activity_id: targetActivityId,
        direction: "inbound",
        phone_number: phoneE164.slice(0, PHONE_NUMBER_MAX),
        phone_e164: phoneE164,
        body,
        cta_response:
          isRatingAnswer && hasMapping && parsed.kind === "parsed"
            ? parsed.value.slice(0, CTA_MAX)
            : null,
        maps_to_rating: mapping.rating,
        maps_to_binary: mapping.binary,
        external_message_id: providerMessageId,
        received_at: receivedAt,
        notes: `Survey #${survey.survey_id} Q${currentQuestion.sort_order + 1}`,
      })
      .select("id")
      .single();
    if (insErr) {
      if (insErr.code === UNIQUE_VIOLATION && providerMessageId) {
        const { data: raced } = await db
          .from("sms_interactions")
          .select("id")
          .eq("external_message_id", providerMessageId)
          .maybeSingle();
        interactionId = (raced?.id as number | undefined) ?? null;
      } else {
        throw insErr;
      }
    } else {
      interactionId = inserted.id as number;
    }
  }

  // Thread append — the idempotency gate for everything below.
  let conversationId = session.conversation_id;
  if (conversationId == null && survey.sender_number_id != null) {
    conversationId = await ensureSurveyConversation(db, {
      ourNumberId: survey.sender_number_id,
      phoneE164,
      workerId: session.worker_id,
      campaignId: survey.campaign_id,
      occurredAt: receivedAt,
    });
    if (conversationId != null) {
      await db
        .from("sms_survey_sessions")
        .update({ conversation_id: conversationId })
        .eq("session_id", session.session_id);
    }
  }

  // Thread append — primary idempotency gate on provider_message_id
  // (including the synthetic MM inbound id). Concurrent retries lose
  // the upsert race and bail before any session advance / reply send.
  if (conversationId != null) {
    const appendedNew = await appendSurveyMessage(db, {
      conversation_id: conversationId,
      direction: "inbound",
      body,
      phone_e164: phoneE164,
      provider_message_id: providerMessageId,
      interaction_id: interactionId,
      status: "received",
      created_at: receivedAt,
    });
    if (!appendedNew) return dedupeResponse;
  }

  const sessionWithConv = { ...session, conversation_id: conversationId };
  const senderDigits = await loadSenderDigits(db, survey.sender_number_id);

  const upsertAnswer = async (
    parsedValue: string | null,
    invalidAttempts: number,
  ) => {
    const { error } = await db.from("sms_survey_answers").upsert(
      {
        session_id: session.session_id,
        question_id: currentQuestion.question_id,
        raw_body: body,
        parsed_value: parsedValue,
        invalid_attempts: invalidAttempts,
        provider_message_id: providerMessageId,
        received_at: receivedAt,
      },
      { onConflict: "session_id,question_id" },
    );
    if (error) throw error;
  };

  /**
   * Guarded live-state transition. Returns whether a row matched —
   * false means the session left the live states mid-flight (cron
   * expiry/opt-out race) OR another inbound already advanced
   * current_question_id, and the caller must NOT send a reply.
   */
  const updateSession = async (
    patch: Record<string, unknown>,
    opts?: { requireCurrentQuestion?: boolean },
  ): Promise<boolean> => {
    let q = db
      .from("sms_survey_sessions")
      .update({ last_activity_at: receivedAt, ...patch })
      .eq("session_id", session.session_id)
      .in("state", [...LIVE_SESSION_STATES]);
    if (opts?.requireCurrentQuestion !== false) {
      q = q.eq("current_question_id", currentQuestion.question_id);
    }
    const { data, error } = await q.select("session_id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  };

  /** Surface the thread to humans (unread bump + needs_response). */
  const surfaceConversation = async () => {
    if (conversationId == null) return;
    const { error } = await db.rpc("touch_sms_conversation_inbound", {
      p_conversation_id: conversationId,
      p_occurred_at: receivedAt,
    });
    if (error) console.error("touch_sms_conversation_inbound failed:", error);
  };

  const quietTouch = async () => {
    if (conversationId == null) return;
    await touchConversationTimestamps(db, conversationId, receivedAt, "inbound");
  };

  // Worker opt-out re-check ahead of any reply send (staff opt-outs
  // must stop prompts even mid-session). Returns the provider result
  // (null when the send was skipped/failed) so ballot completions can
  // log receipt_sent only when the receipt actually went out.
  const sendReply = async (
    replyBody: string,
    kind: SurveyPromptKind,
  ): Promise<SendResult | null> => {
    if (!senderDigits) return null;
    const { data: worker } = await db
      .from("workers")
      .select("sms_opt_out")
      .eq("worker_id", session.worker_id)
      .maybeSingle();
    if (worker?.sms_opt_out) {
      await updateSession({ state: "opted_out" });
      return null;
    }
    const result = await sendSurveyPrompt(db, provider, {
      session: sessionWithConv,
      senderDigits,
      body: replyBody,
      kind,
    });
    if (result?.status === "blocked") {
      await mirrorWorkerOptOut(db, session.worker_id, receivedAt);
      await updateSession({ state: "opted_out" });
      return result;
    }
    await db
      .from("sms_survey_sessions")
      .update({ last_prompt_at: new Date().toISOString() })
      .eq("session_id", session.session_id);
    return result;
  };

  if (parsed.kind === "parsed") {
    await upsertAnswer(
      parsed.value.slice(0, PARSED_MAX),
      existingAnswer?.invalid_attempts ?? 0,
    );
    await quietTouch();

    const step = nextStep(questions, currentQuestion, parsed.value);
    if (step.kind === "question") {
      const advanced = await updateSession({
        state: "active",
        current_question_id: step.question.question_id,
        retry_count: 0,
        nudged: false,
        first_answer_at: session.first_answer_at ?? receivedAt,
      });
      if (advanced) {
        await sendReply(renderQuestion(step.question), "question");
      }
      return {
        handled: true,
        response: {
          ok: true,
          survey_session_id: session.session_id,
          answered: currentQuestion.question_id,
          next_question_id: step.question.question_id,
        },
      };
    }

    const completedNow = await updateSession({
      state: "completed",
      current_question_id: null,
      retry_count: 0,
      nudged: false,
      first_answer_at: session.first_answer_at ?? receivedAt,
      completed_at: receivedAt,
    });
    const completion = survey.completion_body?.trim();
    if (completedNow && survey.purpose === "indicative_ballot") {
      // Ballot completion (§4.2): mint the receipt and send it even
      // with no authored completion body. vote_received carries no
      // choices and no receipt code (worker_id + code would let staff
      // map code → member); receipt_sent only when the send succeeded.
      let receipt: string | null = null;
      try {
        receipt = await computeSessionReceipt(
          db,
          survey,
          questions,
          session.session_id,
          session.worker_id,
        );
      } catch (err) {
        console.error(
          `ballot receipt computation failed (session ${session.session_id}):`,
          err,
        );
      }
      await recordBallotEvents(db, [
        {
          survey_id: survey.survey_id,
          event_type: "vote_received",
          worker_id: session.worker_id,
          session_id: session.session_id,
          payload: { provider_message_id: providerMessageId },
          occurred_at: receivedAt,
        },
      ]);
      const completionBody = receipt
        ? appendReceiptToCompletion(completion ?? null, receipt)
        : completion;
      if (completionBody) {
        const sent = await sendReply(completionBody, "completion");
        if (receipt && sent?.status === "success") {
          await recordBallotEvents(db, [
            {
              survey_id: survey.survey_id,
              event_type: "receipt_sent",
              worker_id: session.worker_id,
              session_id: session.session_id,
            },
          ]);
        }
      }
    } else if (completedNow && completion) {
      await sendReply(completion, "completion");
    }
    return {
      handled: true,
      response: {
        ok: true,
        survey_session_id: session.session_id,
        completed: true,
      },
    };
  }

  if (parsed.kind === "freetext_on_choice") {
    // Capture verbatim and surface to a human WITHOUT burning a retry
    // (brief §4.1). Still send the first-level re-prompt so the member
    // is not left hanging — long prose on a choice/yes_no/scale
    // question used to stall the survey with no reply. Session stays
    // live so a proper follow-up answer still advances it. The free-
    // text IS the member's first engagement, so it stamps
    // first_answer_at (started_count must not undercount these).
    await upsertAnswer(
      existingAnswer?.parsed_value ?? null,
      existingAnswer?.invalid_attempts ?? 0,
    );
    const stillLive = await updateSession({
      first_answer_at: session.first_answer_at ?? receivedAt,
    });
    await surfaceConversation();
    // Always offer the first-level guide copy here, even when
    // retry_limit is 0 (that limit only governs the short-invalid
    // ladder → handoff path; free-text must not silent-stall).
    const guide = retryLadder(currentQuestion, 0, Math.max(survey.retry_limit, 1));
    if (stillLive && guide.kind === "reprompt") {
      await sendReply(guide.body, "reprompt");
    }
    return {
      handled: true,
      response: {
        ok: true,
        survey_session_id: session.session_id,
        freetext_captured: true,
        reprompted: guide.kind === "reprompt",
      },
    };
  }

  // invalid → retry ladder.
  await upsertAnswer(
    existingAnswer?.parsed_value ?? null,
    (existingAnswer?.invalid_attempts ?? 0) + 1,
  );
  const step = retryLadder(currentQuestion, session.retry_count, survey.retry_limit);

  if (step.kind === "reprompt") {
    const stillLive = await updateSession({
      retry_count: session.retry_count + 1,
    });
    await quietTouch();
    if (stillLive) await sendReply(step.body, "reprompt");
    return {
      handled: true,
      response: {
        ok: true,
        survey_session_id: session.session_id,
        reprompted: session.retry_count + 1,
      },
    };
  }

  // Handoff: transcript is already in the thread; escalate + surface.
  await updateSession({ state: "handed_off" });
  if (conversationId != null && survey.handoff_escalate_to) {
    const { error } = await db
      .from("sms_conversations")
      .update({ escalated_to_user_id: survey.handoff_escalate_to })
      .eq("conversation_id", conversationId)
      .is("escalated_to_user_id", null);
    if (error) console.error("survey handoff escalation failed:", error);
  }
  await surfaceConversation();
  return {
    handled: true,
    response: {
      ok: true,
      survey_session_id: session.session_id,
      handed_off: true,
    },
  };
}

/**
 * Webhook precedence step 2b (Phase 5, brief §4.2): an inbound from a
 * member whose ballot session is already COMPLETED while the ballot
 * is still open.
 *
 *   - Only a PARSED answer to the ballot's FIRST question counts as a
 *     vote attempt; anything else returns handled:false so the message
 *     routes conversationally, bit-for-bit Phase 2/3 (no robotic
 *     "vote already recorded" reply to unrelated messages).
 *   - revote_policy 'locked' → answers untouched; vote_rejected_locked
 *     logged; the locked reply sent from the ballot's sender number.
 *   - 'revote_until_close' → guarded reopen at Q1 (exactly-once via
 *     the state='completed' predicate; a 23505 from the one-live-per-
 *     phone index is a belt — the live-session leg runs first, so no
 *     live session exists on the phone when we get here), then
 *     vote_superseded with the prior answers snapshot, then the SAME
 *     inbound is handed to processSurveyInbound on the refreshed
 *     session: the Q1 answer upsert-overwrites, branches/advances,
 *     and re-completion mints a NEW receipt (last response wins).
 *     invited_at is re-stamped so the TTL timer restarts for the
 *     revote window.
 *
 * Redelivery topology: once reopened the session is LIVE, so a
 * webhook retry is caught upstream by findLiveSessionByPhone — this
 * leg only ever sees a message while the session is still completed.
 * The locked path carries its own provider_message_id dedupe gate.
 */
export async function processBallotPostCompletion(
  db: Db,
  provider: SmsProvider,
  args: SurveyInboundArgs,
): Promise<SurveyInboundResult> {
  const { session, phoneE164, body, providerMessageId, receivedAt } = args;
  const notHandled: SurveyInboundResult = { handled: false, response: {} };

  const bundle = await loadSurveyBundle(
    db,
    session.survey_id,
    session.survey_version,
  );
  if (
    !bundle ||
    (bundle.survey.status !== "open" &&
      !(
        bundle.survey.status === "paused" &&
        bundle.survey.pause_mode === "soft"
      )) ||
    bundle.survey.purpose !== "indicative_ballot" ||
    bundle.questions.length === 0
  ) {
    return notHandled;
  }
  const { survey, questions } = bundle;
  const firstQuestion = questions[0];

  const parsed = parseAnswer(firstQuestion, body);
  const decision = decideBallotRevote(survey.revote_policy ?? "locked", parsed);
  if (decision === "not_vote_attempt") return notHandled;

  // Dedupe gate for BOTH branches, BEFORE any state change: a message
  // row already in the thread means this is a webhook redelivery. The
  // locked path must not re-reply or double-log — and the supersede
  // path must not reopen at all: a redelivery of the ORIGINAL
  // completing message would otherwise reopen the session, and the
  // inner processSurveyInbound's own dedupe would then never
  // re-complete it — permanently un-completing the vote and logging a
  // spurious supersession.
  if (providerMessageId) {
    const { data: existingMsg } = await db
      .from("sms_messages")
      .select("message_id")
      .eq("provider_message_id", providerMessageId)
      .maybeSingle();
    if (existingMsg) {
      return {
        handled: true,
        response: {
          ok: true,
          ballot_session_id: session.session_id,
          deduplicated: true,
        },
      };
    }
  }

  if (decision === "reject_locked") {
    // Audit interaction row (the Phase 4 idiom: activity link allowed,
    // all three rating fields NULL — the cta_response trap). Phase 8:
    // COALESCE for link coherence with the live-session stamp above —
    // zero rating risk here since cta_response is NULL regardless.
    let interactionId: number | null = null;
    const { data: inserted, error: insErr } = await db
      .from("sms_interactions")
      .insert({
        worker_id: session.worker_id,
        campaign_id: survey.campaign_id,
        activity_id: firstQuestion.activity_id ?? survey.activity_id,
        direction: "inbound",
        phone_number: phoneE164.slice(0, PHONE_NUMBER_MAX),
        phone_e164: phoneE164,
        body,
        cta_response: null,
        maps_to_rating: null,
        maps_to_binary: null,
        external_message_id: providerMessageId,
        received_at: receivedAt,
        notes: `Ballot #${survey.survey_id} vote rejected (locked)`,
      })
      .select("id")
      .single();
    if (insErr) {
      if (insErr.code !== UNIQUE_VIOLATION) throw insErr;
      const { data: raced } = await db
        .from("sms_interactions")
        .select("id")
        .eq("external_message_id", providerMessageId ?? "")
        .maybeSingle();
      interactionId = (raced?.id as number | undefined) ?? null;
    } else {
      interactionId = inserted.id as number;
    }

    let conversationId = session.conversation_id;
    if (conversationId == null && survey.sender_number_id != null) {
      conversationId = await ensureSurveyConversation(db, {
        ourNumberId: survey.sender_number_id,
        phoneE164,
        workerId: session.worker_id,
        campaignId: survey.campaign_id,
        occurredAt: receivedAt,
      });
      if (conversationId != null) {
        await db
          .from("sms_survey_sessions")
          .update({ conversation_id: conversationId })
          .eq("session_id", session.session_id);
      }
    }
    if (conversationId != null) {
      await appendSurveyMessage(db, {
        conversation_id: conversationId,
        direction: "inbound",
        body,
        phone_e164: phoneE164,
        provider_message_id: providerMessageId,
        interaction_id: interactionId,
        status: "received",
        created_at: receivedAt,
      });
      await touchConversationTimestamps(db, conversationId, receivedAt, "inbound");
    }

    await recordBallotEvents(db, [
      {
        survey_id: survey.survey_id,
        event_type: "vote_rejected_locked",
        worker_id: session.worker_id,
        session_id: session.session_id,
        payload: {
          raw_body: body.slice(0, 200),
          provider_message_id: providerMessageId,
        },
        occurred_at: receivedAt,
      },
    ]);

    const senderDigits = await loadSenderDigits(db, survey.sender_number_id);
    if (senderDigits) {
      const { data: worker } = await db
        .from("workers")
        .select("sms_opt_out")
        .eq("worker_id", session.worker_id)
        .maybeSingle();
      if (!worker?.sms_opt_out) {
        await sendSurveyPrompt(db, provider, {
          session: { ...session, conversation_id: conversationId },
          senderDigits,
          body: BALLOT_LOCKED_REPLY,
          kind: "ballot_locked",
        });
      }
    }
    return {
      handled: true,
      response: {
        ok: true,
        ballot_session_id: session.session_id,
        vote_rejected_locked: true,
      },
    };
  }

  // ── supersede (revote_until_close) ──────────────────────────
  const { data: priorAnswers } = await db
    .from("sms_survey_answers")
    .select("question_id, parsed_value")
    .eq("session_id", session.session_id);

  const { data: reopened, error: reopenErr } = await db
    .from("sms_survey_sessions")
    .update({
      state: "active",
      current_question_id: firstQuestion.question_id,
      retry_count: 0,
      nudged: false,
      completed_at: null,
      invited_at: receivedAt,
      last_activity_at: receivedAt,
    })
    .eq("session_id", session.session_id)
    .eq("state", "completed")
    .select("session_id");
  if (reopenErr) {
    // 23505 = another live session appeared on the phone mid-flight
    // (belt — the live leg runs first): leave the vote as-is and let
    // the message route conversationally.
    if (reopenErr.code === UNIQUE_VIOLATION) return notHandled;
    throw reopenErr;
  }
  if (!reopened || reopened.length === 0) return notHandled;

  // Clear the superseded answers: a revote taking a DIFFERENT branch
  // must not leave stale rows ghosting into the tally view or the new
  // receipt. The prior vote lives on in the vote_superseded payload
  // snapshot (taken above, before the reopen).
  const { error: clearErr } = await db
    .from("sms_survey_answers")
    .delete()
    .eq("session_id", session.session_id);
  if (clearErr) {
    console.error(
      `ballot supersede answer clear failed (session ${session.session_id}):`,
      clearErr,
    );
  }

  await recordBallotEvents(db, [
    {
      survey_id: survey.survey_id,
      event_type: "vote_superseded",
      worker_id: session.worker_id,
      session_id: session.session_id,
      payload: {
        prior_answers: ((priorAnswers ?? []) as Array<{
          question_id: number;
          parsed_value: string | null;
        }>).map((a) => ({
          question_id: a.question_id,
          parsed_value: a.parsed_value,
        })),
        provider_message_id: providerMessageId,
      },
      occurred_at: receivedAt,
    },
  ]);

  const refreshed: SmsSurveySessionRow = {
    ...session,
    state: "active",
    current_question_id: firstQuestion.question_id,
    retry_count: 0,
    nudged: false,
    completed_at: null,
    invited_at: receivedAt,
  };
  return processSurveyInbound(db, provider, {
    session: refreshed,
    phoneE164,
    body,
    providerMessageId,
    receivedAt,
  });
}
