import type { SupabaseClient } from "@supabase/supabase-js";
import type { SmsProvider } from "@/lib/sms/provider";
import { DEFAULT_SMS_TIMEZONE, isWithinSendWindow } from "@/lib/sms/blackout";
import { validateSmsBody } from "@/lib/sms/compliance";
import { renderInvitation } from "@/lib/sms/survey-engine";
import {
  LIVE_SESSION_STATES,
  countQueuedSessions,
  ensureSurveyConversation,
  loadOrgName,
  mirrorContactOptOut,
  sendSurveyPrompt,
  toEngineQuestion,
  type SurveyQuestionRow,
  type SurveyRow,
  type SurveySessionRow,
} from "@/lib/sms/survey-runtime";

const UNIQUE_VIOLATION = "23505";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export interface InvitationDispatchSummary {
  invited: number;
  deferred_live_phone: number;
  deferred_blackout: boolean;
  noncompliant: boolean;
  opted_out: number;
  undeliverable: number;
  budget_used: number;
  remaining_queued: number;
  errors: string[];
}

export async function dispatchSurveyInvitations(
  db: Db,
  provider: SmsProvider,
  args: {
    survey: SurveyRow;
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
    summary.remaining_queued = await countQueuedSessions(db, survey.id);
    return summary;
  }

  const tz = survey.timezone || DEFAULT_SMS_TIMEZONE;
  if (!survey.blackout_override && !isWithinSendWindow(now, tz)) {
    summary.deferred_blackout = true;
    summary.remaining_queued = await countQueuedSessions(db, survey.id);
    return summary;
  }

  const { data: questionsRaw, error: qErr } = await db
    .from("sms_survey_questions")
    .select("*")
    .eq("survey_id", survey.id)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (qErr) throw qErr;
  const questions = (questionsRaw ?? []) as SurveyQuestionRow[];
  if (questions.length === 0) {
    summary.errors.push("Survey has no questions — invitations not sent");
    summary.remaining_queued = await countQueuedSessions(db, survey.id);
    return summary;
  }
  const firstQuestion = questions[0];
  const firstEngine = toEngineQuestion(firstQuestion);

  const { data: senderRow } = await db
    .from("sms_numbers")
    .select("id, phone_e164, status")
    .eq("id", survey.sender_number_id ?? "")
    .eq("organisation_id", survey.organisation_id)
    .maybeSingle();
  if (!senderRow || senderRow.status !== "active") {
    throw new Error("Survey sender number missing or retired");
  }
  const senderDigits = (senderRow.phone_e164 as string).replace(/^\+/, "");

  const orgName = await loadOrgName(db, survey.organisation_id);
  const compliance = validateSmsBody(survey.invitation_body ?? "", orgName);
  if (!compliance.ok) {
    summary.noncompliant = true;
    summary.errors.push(
      `Invitations held — non-compliant invitation body: ${compliance.errors.join(" ")}`,
    );
    summary.remaining_queued = await countQueuedSessions(db, survey.id);
    return summary;
  }

  let sendBudget = args.limit;
  const { data: queuedRaw } = await db
    .from("sms_survey_sessions")
    .select("*")
    .eq("survey_id", survey.id)
    .eq("state", "queued")
    .order("created_at", { ascending: true })
    .limit(sendBudget);
  const queued = (queuedRaw ?? []) as SurveySessionRow[];

  const busyPhones = new Set<string>();
  const phones = [...new Set(queued.map((s) => s.phone_e164))];
  for (let i = 0; i < phones.length; i += 500) {
    const { data: live } = await db
      .from("sms_survey_sessions")
      .select("phone_e164")
      .eq("organisation_id", survey.organisation_id)
      .in("phone_e164", phones.slice(i, i + 500))
      .in("state", [...LIVE_SESSION_STATES]);
    for (const row of live ?? []) busyPhones.add(row.phone_e164 as string);
  }

  const contactIds = queued.map((s) => s.contact_id);
  const optedOut = new Set<string>();
  for (let i = 0; i < contactIds.length; i += 500) {
    const { data: cs } = await db
      .from("contacts")
      .select("id, sms_opt_out")
      .eq("organisation_id", survey.organisation_id)
      .in("id", contactIds.slice(i, i + 500));
    for (const c of cs ?? []) {
      if (c.sms_opt_out) optedOut.add(c.id as string);
    }
  }

  for (const session of queued) {
    if (sendBudget <= 0) break;
    if (busyPhones.has(session.phone_e164)) {
      summary.deferred_live_phone += 1;
      continue;
    }
    if (optedOut.has(session.contact_id)) {
      await db
        .from("sms_survey_sessions")
        .update({ state: "opted_out", last_activity_at: nowIso })
        .eq("id", session.id)
        .eq("state", "queued");
      summary.opted_out += 1;
      continue;
    }

    const conversationId = await ensureSurveyConversation(db, {
      orgId: survey.organisation_id,
      ourNumberId: senderRow.id as string,
      phoneE164: session.phone_e164,
      contactId: session.contact_id,
      occurredAt: nowIso,
    });

    const { data: claimed, error: claimErr } = await db
      .from("sms_survey_sessions")
      .update({
        state: "invited",
        invited_at: nowIso,
        current_question_id: firstQuestion.id,
        last_prompt_at: nowIso,
        conversation_id: conversationId,
      })
      .eq("id", session.id)
      .eq("state", "queued")
      .select("id");
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
      orgId: survey.organisation_id,
      session: {
        id: session.id,
        phone_e164: session.phone_e164,
        conversation_id: conversationId,
      },
      senderDigits,
      body: renderInvitation(survey.invitation_body, firstEngine),
      kind: "invitation",
    });

    if (result?.status === "success") {
      summary.invited += 1;
    } else if (result?.status === "blocked") {
      await mirrorContactOptOut(db, survey.organisation_id, session.contact_id, nowIso);
      await db
        .from("sms_survey_sessions")
        .update({ state: "opted_out", last_activity_at: nowIso })
        .eq("id", session.id)
        .eq("state", "invited");
      summary.opted_out += 1;
    } else if (result?.status === "error") {
      await db
        .from("sms_survey_sessions")
        .update({ state: "undeliverable", last_activity_at: nowIso })
        .eq("id", session.id)
        .eq("state", "invited");
      summary.undeliverable += 1;
      summary.errors.push(
        `Invitation send failed for session ${session.id}: ${result.error ?? "provider error"}`,
      );
    } else {
      await db
        .from("sms_survey_sessions")
        .update({
          state: "queued",
          invited_at: null,
          current_question_id: null,
          last_prompt_at: null,
        })
        .eq("id", session.id)
        .eq("state", "invited");
      busyPhones.delete(session.phone_e164);
    }
  }

  summary.remaining_queued = await countQueuedSessions(db, survey.id);
  return summary;
}
