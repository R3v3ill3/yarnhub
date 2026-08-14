/**
 * Invitation dispatch for SMS surveys — shared by the timers cron and
 * the survey `open` action (immediate send on launch).
 *
 * Queued → invited claim, blackout / compliance / busy-phone /
 * opt-out gates, and provider send+revert behaviour match the
 * previous cron-only implementation.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SmsProvider } from "@/lib/sms/provider";
import {
  DEFAULT_SMS_TIMEZONE,
  isWithinSendWindow,
} from "@/lib/sms/blackout";
import { validateSmsBody } from "@/lib/sms/compliance";
import { invitationMentionsIndicative } from "@/lib/sms/survey-validation";
import { renderInvitation } from "@/lib/sms/survey-engine";
import {
  LIVE_SESSION_STATES,
  ensureSurveyConversation,
  mirrorWorkerOptOut,
  recordBallotEvents,
  sendSurveyPrompt,
  type BallotEventInsert,
} from "@/lib/sms/survey-runtime";
import type {
  SmsSurveyQuestionRow,
  SmsSurveyRow,
  SmsSurveySessionRow,
} from "@/types/sms";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

const UNIQUE_VIOLATION = "23505";

export interface InvitationDispatchSummary {
  invited: number;
  deferred_live_phone: number;
  deferred_blackout: boolean;
  noncompliant: boolean;
  opted_out: number;
  undeliverable: number;
  /** Sessions that claimed a send slot (success, blocked, error, or transient throw). */
  budget_used: number;
  remaining_queued: number;
  errors: string[];
}

/**
 * Drain up to `limit` queued sessions for one survey into invitations.
 * Outside the send window (and without blackout override) this is a
 * no-op that reports `deferred_blackout` — cron will retry later.
 */
export async function dispatchSurveyInvitations(
  db: Db,
  provider: SmsProvider,
  args: {
    survey: SmsSurveyRow;
    limit: number;
    now?: Date;
  },
): Promise<InvitationDispatchSummary> {
  const survey = args.survey;
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();
  const summary: InvitationDispatchSummary = {
    invited: 0,
    deferred_live_phone: 0,
    deferred_blackout: false,
    noncompliant: false,
    opted_out: 0,
    undeliverable: 0,
    budget_used: 0,
    remaining_queued: 0,
    errors: [],
  };

  if (args.limit <= 0) {
    summary.remaining_queued = await countQueued(db, survey.survey_id);
    return summary;
  }

  const tz = survey.timezone || DEFAULT_SMS_TIMEZONE;
  if (!survey.blackout_override && !isWithinSendWindow(now, tz)) {
    summary.deferred_blackout = true;
    summary.remaining_queued = await countQueued(db, survey.survey_id);
    return summary;
  }

  const { data: questionsRaw, error: qErr } = await db
    .from("sms_survey_questions")
    .select("*")
    .eq("survey_id", survey.survey_id)
    .order("sort_order", { ascending: true })
    .order("question_id", { ascending: true });
  if (qErr) throw qErr;
  const questions = (questionsRaw ?? []) as SmsSurveyQuestionRow[];
  if (questions.length === 0) {
    summary.errors.push("Survey has no questions — invitations not sent");
    summary.remaining_queued = await countQueued(db, survey.survey_id);
    return summary;
  }
  const firstQuestion = questions[0];

  const { data: senderRow } = await db
    .from("sms_numbers")
    .select("number_id, phone_e164, status")
    .eq("number_id", survey.sender_number_id ?? -1)
    .maybeSingle();
  if (!senderRow || senderRow.status !== "active") {
    throw new Error("Survey sender number missing or retired");
  }
  const senderDigits = (senderRow.phone_e164 as string).replace(/^\+/, "");

  const compliance = validateSmsBody(survey.invitation_body ?? "");
  const indicativeOk =
    survey.purpose !== "indicative_ballot" ||
    invitationMentionsIndicative(survey.invitation_body);
  // Org name is a client warning, not a hold. Indicative-ballot
  // framing remains a hard requirement.
  if (!compliance.ok || !indicativeOk) {
    summary.noncompliant = true;
    summary.errors.push(
      !compliance.ok
        ? `Invitations held — non-compliant invitation body: ${compliance.errors.join(" ")}`
        : 'Invitations held — ballot invitation must describe the poll as "indicative" (brief §4.2/§8.1)',
    );
    summary.remaining_queued = await countQueued(db, survey.survey_id);
    return summary;
  }

  let sendBudget = args.limit;
  const { data: queuedRaw } = await db
    .from("sms_survey_sessions")
    .select("*")
    .eq("survey_id", survey.survey_id)
    .eq("state", "queued")
    .order("session_id", { ascending: true })
    .limit(sendBudget);
  const queued = (queuedRaw ?? []) as SmsSurveySessionRow[];

  const busyPhones = new Set<string>();
  const phones = [...new Set(queued.map((s) => s.phone_e164))];
  for (let i = 0; i < phones.length; i += 500) {
    const { data: live } = await db
      .from("sms_survey_sessions")
      .select("phone_e164")
      .in("phone_e164", phones.slice(i, i + 500))
      .in("state", [...LIVE_SESSION_STATES]);
    for (const row of live ?? []) busyPhones.add(row.phone_e164 as string);
  }

  const workerIds = queued.map((s) => s.worker_id);
  const optedOut = new Set<number>();
  for (let i = 0; i < workerIds.length; i += 500) {
    const { data: ws } = await db
      .from("workers")
      .select("worker_id, sms_opt_out")
      .in("worker_id", workerIds.slice(i, i + 500));
    for (const w of ws ?? []) {
      if (w.sms_opt_out) optedOut.add(w.worker_id as number);
    }
  }

  const ballotInvitationEvents: BallotEventInsert[] = [];

  for (const session of queued) {
    if (sendBudget <= 0) break;
    if (busyPhones.has(session.phone_e164)) {
      summary.deferred_live_phone += 1;
      continue;
    }
    if (optedOut.has(session.worker_id)) {
      await db
        .from("sms_survey_sessions")
        .update({ state: "opted_out", last_activity_at: nowIso })
        .eq("session_id", session.session_id)
        .eq("state", "queued");
      summary.opted_out += 1;
      continue;
    }

    const conversationId = await ensureSurveyConversation(db, {
      ourNumberId: senderRow.number_id as number,
      phoneE164: session.phone_e164,
      workerId: session.worker_id,
      campaignId: survey.campaign_id,
      occurredAt: nowIso,
    });

    const { data: claimed, error: claimErr } = await db
      .from("sms_survey_sessions")
      .update({
        state: "invited",
        invited_at: nowIso,
        current_question_id: firstQuestion.question_id,
        last_prompt_at: nowIso,
        survey_version: survey.version,
        conversation_id: conversationId,
      })
      .eq("session_id", session.session_id)
      .eq("state", "queued")
      .select("session_id");
    if (claimErr) {
      if (claimErr.code === UNIQUE_VIOLATION) {
        summary.deferred_live_phone += 1;
        continue;
      }
      throw claimErr;
    }
    if (!claimed || claimed.length === 0) continue;

    busyPhones.add(session.phone_e164);
    sendBudget -= 1;
    summary.budget_used += 1;
    const result = await sendSurveyPrompt(db, provider, {
      session: {
        session_id: session.session_id,
        phone_e164: session.phone_e164,
        conversation_id: conversationId,
      },
      senderDigits,
      body: renderInvitation(survey.invitation_body, firstQuestion),
      kind: "invitation",
    });

    if (result?.status === "success") {
      summary.invited += 1;
      if (survey.purpose === "indicative_ballot") {
        ballotInvitationEvents.push({
          survey_id: survey.survey_id,
          event_type: "invitation_sent",
          worker_id: session.worker_id,
          session_id: session.session_id,
          payload: { provider_message_id: result.providerMessageId ?? null },
          occurred_at: nowIso,
        });
      }
    } else if (result?.status === "blocked") {
      await mirrorWorkerOptOut(db, session.worker_id, nowIso);
      await db
        .from("sms_survey_sessions")
        .update({ state: "opted_out", last_activity_at: nowIso })
        .eq("session_id", session.session_id)
        .eq("state", "invited");
      summary.opted_out += 1;
    } else if (result?.status === "error") {
      await db
        .from("sms_survey_sessions")
        .update({ state: "undeliverable", last_activity_at: nowIso })
        .eq("session_id", session.session_id)
        .eq("state", "invited");
      summary.undeliverable += 1;
      summary.errors.push(
        `Invitation send failed for session ${session.session_id}: ${
          result.error ?? "provider error"
        }`,
      );
    } else {
      // Provider call threw (null result): transient — revert for retry.
      await db
        .from("sms_survey_sessions")
        .update({
          state: "queued",
          invited_at: null,
          current_question_id: null,
          last_prompt_at: null,
        })
        .eq("session_id", session.session_id)
        .eq("state", "invited");
      busyPhones.delete(session.phone_e164);
    }
  }

  await recordBallotEvents(db, ballotInvitationEvents);
  summary.remaining_queued = await countQueued(db, survey.survey_id);
  return summary;
}

async function countQueued(db: Db, surveyId: number): Promise<number> {
  const { count, error } = await db
    .from("sms_survey_sessions")
    .select("session_id", { count: "exact", head: true })
    .eq("survey_id", surveyId)
    .eq("state", "queued");
  if (error) {
    console.error("countQueued failed:", error);
    return 0;
  }
  return count ?? 0;
}
