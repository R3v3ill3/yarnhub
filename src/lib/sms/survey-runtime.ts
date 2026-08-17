/**
 * Survey session I/O around the pure engine. Service-role at the
 * webhook/cron; launch uses the member client under RLS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SmsProvider, SendResult } from "@/lib/sms/provider";
import {
  nextStep,
  parseAnswer,
  renderQuestion,
  retryLadder,
} from "@/lib/sms/survey-engine";
import type { SmsSurveyQuestionRow } from "@/types/sms";
import { LIVE_SURVEY_SESSION_STATES } from "@/lib/sms/inbound";
import {
  appendInboundMessage,
  appendOutboundMessage,
  bumpConversationUnread,
  touchConversationTimestamps,
  upsertOutboundThread,
} from "@/lib/sms/thread-write";

const PARSED_MAX = 50;
const REPLAY_WINDOW_MS = 10 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export const LIVE_SESSION_STATES = LIVE_SURVEY_SESSION_STATES;

export interface SurveyRow {
  id: string;
  organisation_id: string;
  title: string;
  status: string;
  pause_mode: string | null;
  retry_limit: number;
  question_timeout_minutes: number;
  session_ttl_hours: number;
  reminder_offsets: number[] | null;
  sender_number_id: string | null;
  timezone: string;
  blackout_override: boolean;
  invitation_body: string | null;
  completion_body: string | null;
}

export interface SurveyQuestionRow {
  id: string;
  organisation_id: string;
  survey_id: string;
  sort_order: number;
  prompt: string;
  qtype: SmsSurveyQuestionRow["qtype"];
  options: SmsSurveyQuestionRow["options"];
  branching: SmsSurveyQuestionRow["branching"];
  invalid_prompt: string | null;
  nudge_text: string | null;
  created_at: string;
}

export interface SurveySessionRow {
  id: string;
  organisation_id: string;
  survey_id: string;
  contact_id: string;
  phone_e164: string;
  conversation_id: string | null;
  state: string;
  current_question_id: string | null;
  retry_count: number;
  nudged: boolean;
  reminders_sent: number;
  last_prompt_at: string | null;
  invited_at: string | null;
  first_answer_at: string | null;
}

export function toEngineQuestion(row: SurveyQuestionRow): SmsSurveyQuestionRow {
  return {
    question_id: row.id,
    survey_id: row.survey_id,
    sort_order: row.sort_order,
    prompt: row.prompt,
    qtype: row.qtype,
    options: row.options,
    branching: row.branching,
    write_rating: false,
    activity_id: null,
    invalid_prompt: row.invalid_prompt,
    nudge_text: row.nudge_text,
    retired_at: null,
    created_at: row.created_at,
    updated_at: row.created_at,
  };
}

export async function loadSurveyBundle(
  db: Db,
  surveyId: string,
): Promise<{ survey: SurveyRow; questions: SurveyQuestionRow[] } | null> {
  const { data: survey, error } = await db
    .from("sms_surveys")
    .select("*")
    .eq("id", surveyId)
    .maybeSingle();
  if (error) throw error;
  if (!survey) return null;
  const { data: questions, error: qErr } = await db
    .from("sms_survey_questions")
    .select("*")
    .eq("survey_id", surveyId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (qErr) throw qErr;
  return {
    survey: survey as SurveyRow,
    questions: (questions ?? []) as SurveyQuestionRow[],
  };
}

export async function findLiveSessionByPhone(
  db: Db,
  orgId: string,
  phoneE164: string,
): Promise<SurveySessionRow | null> {
  const { data, error } = await db
    .from("sms_survey_sessions")
    .select("*")
    .eq("organisation_id", orgId)
    .eq("phone_e164", phoneE164)
    .in("state", [...LIVE_SESSION_STATES])
    .limit(1);
  if (error) throw error;
  return (data?.[0] as SurveySessionRow | undefined) ?? null;
}

export async function terminateSessionsForPhone(
  db: Db,
  orgId: string,
  phoneE164: string,
  occurredAt: string,
): Promise<Array<{ id: string; conversation_id: string | null }>> {
  const { data, error } = await db
    .from("sms_survey_sessions")
    .update({ state: "opted_out", last_activity_at: occurredAt })
    .eq("organisation_id", orgId)
    .eq("phone_e164", phoneE164)
    .in("state", ["queued", ...LIVE_SESSION_STATES])
    .select("id, conversation_id");
  if (error) {
    console.error("terminateSessionsForPhone failed:", error);
    return [];
  }
  return (data ?? []) as Array<{ id: string; conversation_id: string | null }>;
}

export async function ensureSurveyConversation(
  db: Db,
  args: {
    orgId: string;
    ourNumberId: string;
    phoneE164: string;
    contactId: string;
    occurredAt: string;
  },
): Promise<string> {
  return upsertOutboundThread(db, {
    orgId: args.orgId,
    ourNumberId: args.ourNumberId,
    phoneE164: args.phoneE164,
    contactId: args.contactId,
    sentAt: args.occurredAt,
  });
}

export async function loadSenderDigits(
  db: Db,
  orgId: string,
  numberId: string | null,
): Promise<{ id: string; digits: string } | null> {
  if (!numberId) return null;
  const { data } = await db
    .from("sms_numbers")
    .select("id, phone_e164, status")
    .eq("id", numberId)
    .eq("organisation_id", orgId)
    .maybeSingle();
  if (!data || data.status !== "active") return null;
  return { id: data.id as string, digits: (data.phone_e164 as string).replace(/^\+/, "") };
}

export async function loadOrgName(db: Db, orgId: string): Promise<string> {
  const { data } = await db.from("organisations").select("name").eq("id", orgId).maybeSingle();
  return (data?.name as string | undefined)?.trim() || "this organisation";
}

export async function mirrorContactOptOut(
  db: Db,
  orgId: string,
  contactId: string,
  occurredAt: string,
): Promise<void> {
  const { error } = await db
    .from("contacts")
    .update({
      sms_opt_out: true,
      sms_opt_out_at: occurredAt,
      sms_opt_out_source: "inbound_stop",
    })
    .eq("id", contactId)
    .eq("organisation_id", orgId)
    .eq("sms_opt_out", false);
  if (error) console.error("mirrorContactOptOut failed:", error);
}

export type SurveyPromptKind =
  | "invitation"
  | "question"
  | "reprompt"
  | "completion"
  | "nudge"
  | "reminder";

export async function sendSurveyPrompt(
  db: Db,
  provider: SmsProvider,
  args: {
    orgId: string;
    session: Pick<SurveySessionRow, "id" | "phone_e164" | "conversation_id">;
    senderDigits: string;
    body: string;
    kind: SurveyPromptKind;
  },
): Promise<SendResult | null> {
  const { orgId, session, senderDigits, body, kind } = args;
  const sentAt = new Date().toISOString();
  let result: SendResult | null = null;
  try {
    const results = await provider.sendBatch(
      [
        {
          to: session.phone_e164,
          body,
          sender: senderDigits,
          customRef: `survey-${session.id}`,
        },
      ],
      { idempotencyKey: `sms-survey-${session.id}-${kind}-${Date.now()}` },
    );
    result = results[0] ?? null;
  } catch (err) {
    console.error(
      `sendSurveyPrompt: provider send failed (session ${session.id}, ${kind}):`,
      err,
    );
    return null;
  }

  if (session.conversation_id) {
    try {
      await appendOutboundMessage(db, {
        orgId,
        conversationId: session.conversation_id,
        body,
        phoneE164: session.phone_e164,
        senderUserId: null,
        providerMessageId: result?.providerMessageId ?? null,
        status: result?.status === "success" ? "sent" : "failed",
      });
      await touchConversationTimestamps(db, {
        conversationId: session.conversation_id,
        occurredAt: sentAt,
        direction: "outbound",
      });
    } catch (err) {
      console.error(`sendSurveyPrompt: thread mirror failed (session ${session.id}):`, err);
    }
  }
  return result;
}

export interface SurveyInboundResult {
  handled: boolean;
  response: Record<string, unknown>;
}

export async function processSurveyInbound(
  db: Db,
  provider: SmsProvider,
  args: {
    session: SurveySessionRow;
    phoneE164: string;
    body: string;
    providerMessageId: string | null;
    receivedAt: string;
  },
): Promise<SurveyInboundResult> {
  const { session, phoneE164, body, providerMessageId, receivedAt } = args;
  const orgId = session.organisation_id;

  const bundle = await loadSurveyBundle(db, session.survey_id);
  if (!bundle || bundle.questions.length === 0) {
    await db
      .from("sms_survey_sessions")
      .update({ state: "expired", last_activity_at: receivedAt })
      .eq("id", session.id)
      .in("state", [...LIVE_SESSION_STATES]);
    return { handled: false, response: {} };
  }
  const { survey, questions } = bundle;
  const engineQuestions = questions.map(toEngineQuestion);
  const orgName = await loadOrgName(db, orgId);

  if (survey.status === "paused" && survey.pause_mode === "hard") {
    const sender = await loadSenderDigits(db, orgId, survey.sender_number_id);
    if (sender) {
      try {
        await sendSurveyPrompt(db, provider, {
          orgId,
          session,
          senderDigits: sender.digits,
          body: `This survey is paused — please wait for a follow-up message. ${orgName}.`,
          kind: "nudge",
        });
      } catch (err) {
        console.error("hard-pause auto-reply failed:", err);
      }
    }
    return {
      handled: true,
      response: { ok: true, survey_session_id: session.id, paused: true, pause_mode: "hard" },
    };
  }

  if (survey.status !== "open" && survey.status !== "paused") {
    await db
      .from("sms_survey_sessions")
      .update({ state: "expired", last_activity_at: receivedAt })
      .eq("id", session.id)
      .in("state", [...LIVE_SESSION_STATES]);
    return { handled: false, response: {} };
  }
  if (survey.status === "paused" && survey.pause_mode !== "soft") {
    return {
      handled: true,
      response: { ok: true, survey_session_id: session.id, paused: true },
    };
  }

  const currentQuestion =
    questions.find((q) => q.id === session.current_question_id) ?? questions[0];
  const currentEngine =
    engineQuestions.find((q) => String(q.question_id) === currentQuestion.id) ??
    engineQuestions[0];
  const parsed = parseAnswer(currentEngine, body);

  const dedupeResponse: SurveyInboundResult = {
    handled: true,
    response: { ok: true, survey_session_id: session.id, deduplicated: true },
  };

  if (providerMessageId) {
    const { data: existingMsg } = await db
      .from("sms_messages")
      .select("id")
      .eq("organisation_id", orgId)
      .eq("provider_message_id", providerMessageId)
      .maybeSingle();
    if (existingMsg) return dedupeResponse;
  }

  const { data: existingAnswerRows } = await db
    .from("sms_survey_answers")
    .select("parsed_value, invalid_attempts, raw_body, received_at")
    .eq("session_id", session.id)
    .eq("question_id", currentQuestion.id)
    .limit(1);
  const existingAnswer = existingAnswerRows?.[0] as
    | {
        parsed_value: string | null;
        invalid_attempts: number;
        raw_body: string | null;
        received_at: string;
      }
    | undefined;

  if (existingAnswer?.parsed_value != null) return dedupeResponse;
  if (
    !providerMessageId &&
    existingAnswer &&
    existingAnswer.raw_body === body &&
    Math.abs(Date.parse(receivedAt) - Date.parse(existingAnswer.received_at)) <= REPLAY_WINDOW_MS
  ) {
    return dedupeResponse;
  }

  let conversationId = session.conversation_id;
  if (!conversationId && survey.sender_number_id) {
    conversationId = await ensureSurveyConversation(db, {
      orgId,
      ourNumberId: survey.sender_number_id,
      phoneE164,
      contactId: session.contact_id,
      occurredAt: receivedAt,
    });
    await db
      .from("sms_survey_sessions")
      .update({ conversation_id: conversationId })
      .eq("id", session.id);
  }

  if (conversationId) {
    const appendedNew = await appendInboundMessage(db, {
      orgId,
      conversationId,
      body,
      phoneE164,
      providerMessageId,
      createdAt: receivedAt,
    });
    if (!appendedNew) return dedupeResponse;
  }

  const sessionWithConv = { ...session, conversation_id: conversationId };
  const sender = await loadSenderDigits(db, orgId, survey.sender_number_id);

  const upsertAnswer = async (parsedValue: string | null, invalidAttempts: number) => {
    const { error } = await db.from("sms_survey_answers").upsert(
      {
        organisation_id: orgId,
        session_id: session.id,
        question_id: currentQuestion.id,
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

  const updateSession = async (
    patch: Record<string, unknown>,
    opts?: { requireCurrentQuestion?: boolean },
  ): Promise<boolean> => {
    let q = db
      .from("sms_survey_sessions")
      .update({ last_activity_at: receivedAt, ...patch })
      .eq("id", session.id)
      .in("state", [...LIVE_SESSION_STATES]);
    if (opts?.requireCurrentQuestion !== false) {
      q = q.eq("current_question_id", currentQuestion.id);
    }
    const { data, error } = await q.select("id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  };

  const sendReply = async (replyBody: string, kind: SurveyPromptKind): Promise<SendResult | null> => {
    if (!sender) return null;
    const { data: contact } = await db
      .from("contacts")
      .select("sms_opt_out")
      .eq("id", session.contact_id)
      .maybeSingle();
    if (contact?.sms_opt_out) {
      await updateSession({ state: "opted_out" }, { requireCurrentQuestion: false });
      return null;
    }
    const result = await sendSurveyPrompt(db, provider, {
      orgId,
      session: sessionWithConv,
      senderDigits: sender.digits,
      body: replyBody,
      kind,
    });
    if (result?.status === "blocked") {
      await mirrorContactOptOut(db, orgId, session.contact_id, receivedAt);
      await updateSession({ state: "opted_out" }, { requireCurrentQuestion: false });
      return result;
    }
    await db
      .from("sms_survey_sessions")
      .update({ last_prompt_at: new Date().toISOString() })
      .eq("id", session.id);
    return result;
  };

  if (parsed.kind === "parsed") {
    await upsertAnswer(parsed.value.slice(0, PARSED_MAX), existingAnswer?.invalid_attempts ?? 0);
    if (conversationId) {
      await touchConversationTimestamps(db, {
        conversationId,
        occurredAt: receivedAt,
        direction: "inbound",
      });
    }

    const step = nextStep(engineQuestions, currentEngine, parsed.value);
    if (step.kind === "question") {
      const advanced = await updateSession({
        state: "active",
        current_question_id: String(step.question.question_id),
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
          survey_session_id: session.id,
          answered: currentQuestion.id,
          next_question_id: String(step.question.question_id),
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
    if (completedNow && completion) {
      await sendReply(completion, "completion");
    }
    return {
      handled: true,
      response: { ok: true, survey_session_id: session.id, completed: true },
    };
  }

  if (parsed.kind === "freetext_on_choice") {
    await upsertAnswer(existingAnswer?.parsed_value ?? null, existingAnswer?.invalid_attempts ?? 0);
    const stillLive = await updateSession({
      first_answer_at: session.first_answer_at ?? receivedAt,
    });
    if (conversationId) await bumpConversationUnread(db, conversationId, receivedAt);
    const guide = retryLadder(currentEngine, 0, Math.max(survey.retry_limit, 1));
    if (stillLive && guide.kind === "reprompt") {
      await sendReply(guide.body, "reprompt");
    }
    return {
      handled: true,
      response: {
        ok: true,
        survey_session_id: session.id,
        freetext_captured: true,
        reprompted: guide.kind === "reprompt",
      },
    };
  }

  await upsertAnswer(
    existingAnswer?.parsed_value ?? null,
    (existingAnswer?.invalid_attempts ?? 0) + 1,
  );
  const step = retryLadder(currentEngine, session.retry_count, survey.retry_limit);

  if (step.kind === "reprompt") {
    const stillLive = await updateSession({ retry_count: session.retry_count + 1 });
    if (conversationId) {
      await touchConversationTimestamps(db, {
        conversationId,
        occurredAt: receivedAt,
        direction: "inbound",
      });
    }
    if (stillLive) await sendReply(step.body, "reprompt");
    return {
      handled: true,
      response: { ok: true, survey_session_id: session.id, reprompted: session.retry_count + 1 },
    };
  }

  await updateSession({ state: "handed_off" }, { requireCurrentQuestion: false });
  if (conversationId) await bumpConversationUnread(db, conversationId, receivedAt);
  return {
    handled: true,
    response: { ok: true, survey_session_id: session.id, handed_off: true },
  };
}

export async function countQueuedSessions(db: Db, surveyId: string): Promise<number> {
  const { count, error } = await db
    .from("sms_survey_sessions")
    .select("id", { count: "exact", head: true })
    .eq("survey_id", surveyId)
    .eq("state", "queued");
  if (error) {
    console.error("countQueuedSessions failed:", error);
    return 0;
  }
  return count ?? 0;
}
