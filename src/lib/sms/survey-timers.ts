import type { SupabaseClient } from "@supabase/supabase-js";
import type { SmsProvider } from "@/lib/sms/provider";
import { DEFAULT_SMS_TIMEZONE, isWithinSendWindow } from "@/lib/sms/blackout";
import { renderNudge, renderReminder } from "@/lib/sms/survey-engine";
import { dispatchSurveyInvitations } from "@/lib/sms/survey-invitation-dispatch";
import {
  LIVE_SESSION_STATES,
  loadSenderDigits,
  mirrorContactOptOut,
  sendSurveyPrompt,
  toEngineQuestion,
  type SurveyQuestionRow,
  type SurveyRow,
  type SurveySessionRow,
} from "@/lib/sms/survey-runtime";
import {
  processQueuedRelayForwards,
  type RelayForwardsSummary,
} from "@/lib/sms/relay-runtime";
import { gatedProviderFactory } from "@/lib/sms/send-guard";

const RUN_SEND_CAP = 200;
const PROMPT_SPACING_MINUTES = 60;

function minutesAgo(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * 60 * 1000).toISOString();
}

function reminderOffsets(survey: SurveyRow): number[] {
  const raw = survey.reminder_offsets;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0)
    .slice(0, 2);
}

export interface SurveyTimersSummary {
  surveys_seen: number;
  surveys_blocked_by_window: string[];
  surveys_noncompliant_invitation: string[];
  invited: number;
  deferred_live_phone: number;
  nudged: number;
  reminded: number;
  expired: number;
  opted_out: number;
  undeliverable: number;
  closed_survey_sessions_expired: number;
  errors: Array<{ survey_id: string; error: string }>;
  relay_forwards: RelayForwardsSummary | null;
}

export async function processSurveyTimers(
  admin: SupabaseClient,
  now: Date = new Date(),
  getProvider: (orgId: string) => Promise<SmsProvider> = gatedProviderFactory(admin),
): Promise<SurveyTimersSummary> {
  const nowIso = now.toISOString();
  const summary: SurveyTimersSummary = {
    surveys_seen: 0,
    surveys_blocked_by_window: [],
    surveys_noncompliant_invitation: [],
    invited: 0,
    deferred_live_phone: 0,
    nudged: 0,
    reminded: 0,
    expired: 0,
    opted_out: 0,
    undeliverable: 0,
    closed_survey_sessions_expired: 0,
    errors: [],
    relay_forwards: null,
  };
  let sendBudget = RUN_SEND_CAP;
  const providers = new Map<string, SmsProvider>();
  const resolveProvider = async (orgId: string) => {
    let provider = providers.get(orgId);
    if (!provider) {
      provider = await getProvider(orgId);
      providers.set(orgId, provider);
    }
    return provider;
  };

  try {
    const { data: strays } = await admin
      .from("sms_survey_sessions")
      .select("id, sms_surveys!inner(status)")
      .in("state", [...LIVE_SESSION_STATES])
      .eq("sms_surveys.status", "closed");
    const strayIds = (strays ?? []).map((s) => s.id as string);
    if (strayIds.length > 0) {
      await admin
        .from("sms_survey_sessions")
        .update({ state: "expired" })
        .in("id", strayIds)
        .in("state", [...LIVE_SESSION_STATES]);
      summary.closed_survey_sessions_expired = strayIds.length;
    }
  } catch (err) {
    console.error("sms-survey-timers: closed-survey sweep failed:", err);
  }

  const { data: surveysRaw, error: surveyErr } = await admin
    .from("sms_surveys")
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: true });
  if (surveyErr) throw surveyErr;
  const surveys = (surveysRaw ?? []) as SurveyRow[];
  summary.surveys_seen = surveys.length;

  for (const survey of surveys) {
    try {
      const tz = survey.timezone || DEFAULT_SMS_TIMEZONE;
      const ttlCutoff = minutesAgo(now, survey.session_ttl_hours * 60);
      const { data: expired } = await admin
        .from("sms_survey_sessions")
        .update({ state: "expired" })
        .eq("survey_id", survey.id)
        .in("state", [...LIVE_SESSION_STATES])
        .lt("invited_at", ttlCutoff)
        .select("id");
      summary.expired += expired?.length ?? 0;

      if (!survey.blackout_override && !isWithinSendWindow(now, tz)) {
        summary.surveys_blocked_by_window.push(survey.id);
        continue;
      }
      if (sendBudget <= 0) continue;

      const { data: questionsRaw, error: qErr } = await admin
        .from("sms_survey_questions")
        .select("*")
        .eq("survey_id", survey.id)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });
      if (qErr) throw qErr;
      const questions = (questionsRaw ?? []) as SurveyQuestionRow[];
      if (questions.length === 0) continue;

      const sender = await loadSenderDigits(
        admin,
        survey.organisation_id,
        survey.sender_number_id,
      );
      if (!sender) throw new Error("Survey sender number missing or retired");

      const inviteSummary = await dispatchSurveyInvitations(
        admin,
        await resolveProvider(survey.organisation_id),
        { survey, limit: sendBudget, now },
      );
      sendBudget = Math.max(0, sendBudget - inviteSummary.budget_used);
      summary.invited += inviteSummary.invited;
      summary.deferred_live_phone += inviteSummary.deferred_live_phone;
      summary.opted_out += inviteSummary.opted_out;
      summary.undeliverable += inviteSummary.undeliverable;
      if (inviteSummary.noncompliant) {
        summary.surveys_noncompliant_invitation.push(survey.id);
      }
      for (const error of inviteSummary.errors) {
        summary.errors.push({ survey_id: survey.id, error });
      }

      if (sendBudget > 0) {
        const nudgeCutoff = minutesAgo(now, survey.question_timeout_minutes);
        const { data: stalledRaw } = await admin
          .from("sms_survey_sessions")
          .select("*")
          .eq("survey_id", survey.id)
          .in("state", [...LIVE_SESSION_STATES])
          .eq("nudged", false)
          .lt("last_prompt_at", nudgeCutoff)
          .order("created_at", { ascending: true })
          .limit(sendBudget);
        for (const session of (stalledRaw ?? []) as SurveySessionRow[]) {
          if (sendBudget <= 0) break;
          const question = questions.find((q) => q.id === session.current_question_id);
          if (!question) continue;
          const { data: claimed } = await admin
            .from("sms_survey_sessions")
            .update({ nudged: true, last_prompt_at: nowIso })
            .eq("id", session.id)
            .eq("nudged", false)
            .in("state", [...LIVE_SESSION_STATES])
            .select("id");
          if (!claimed || claimed.length === 0) continue;

          sendBudget -= 1;
          const result = await sendSurveyPrompt(
            admin,
            await resolveProvider(survey.organisation_id),
            {
              orgId: survey.organisation_id,
              session,
              senderDigits: sender.digits,
              body: renderNudge(toEngineQuestion(question)),
              kind: "nudge",
            },
          );
          if (result?.status === "success") {
            summary.nudged += 1;
          } else if (result?.status === "blocked") {
            await mirrorContactOptOut(
              admin,
              survey.organisation_id,
              session.contact_id,
              nowIso,
            );
            await admin
              .from("sms_survey_sessions")
              .update({ state: "opted_out", last_activity_at: nowIso })
              .eq("id", session.id)
              .in("state", [...LIVE_SESSION_STATES]);
            summary.opted_out += 1;
          } else {
            await admin
              .from("sms_survey_sessions")
              .update({ nudged: false })
              .eq("id", session.id)
              .eq("nudged", true);
          }
        }
      }

      const offsets = reminderOffsets(survey);
      if (sendBudget > 0 && offsets.length > 0) {
        const spacingCutoff = minutesAgo(now, PROMPT_SPACING_MINUTES);
        const { data: candidatesRaw } = await admin
          .from("sms_survey_sessions")
          .select("*")
          .eq("survey_id", survey.id)
          .in("state", [...LIVE_SESSION_STATES])
          .lt("reminders_sent", offsets.length)
          .lt("last_prompt_at", spacingCutoff)
          .order("created_at", { ascending: true })
          .limit(sendBudget * 2);
        for (const session of (candidatesRaw ?? []) as SurveySessionRow[]) {
          if (sendBudget <= 0) break;
          if (!session.invited_at) continue;
          const offset = offsets[session.reminders_sent];
          if (offset == null) continue;
          const due =
            Date.parse(session.invited_at) + offset * 60 * 1000 <= now.getTime();
          if (!due) continue;
          const question = questions.find((q) => q.id === session.current_question_id);
          if (!question) continue;

          const { data: claimed } = await admin
            .from("sms_survey_sessions")
            .update({
              reminders_sent: session.reminders_sent + 1,
              last_prompt_at: nowIso,
            })
            .eq("id", session.id)
            .eq("reminders_sent", session.reminders_sent)
            .in("state", [...LIVE_SESSION_STATES])
            .select("id");
          if (!claimed || claimed.length === 0) continue;

          sendBudget -= 1;
          const result = await sendSurveyPrompt(
            admin,
            await resolveProvider(survey.organisation_id),
            {
              orgId: survey.organisation_id,
              session,
              senderDigits: sender.digits,
              body: renderReminder(toEngineQuestion(question)),
              kind: "reminder",
            },
          );
          if (result?.status === "success") {
            summary.reminded += 1;
          } else if (result?.status === "blocked") {
            await mirrorContactOptOut(
              admin,
              survey.organisation_id,
              session.contact_id,
              nowIso,
            );
            await admin
              .from("sms_survey_sessions")
              .update({ state: "opted_out", last_activity_at: nowIso })
              .eq("id", session.id)
              .in("state", [...LIVE_SESSION_STATES]);
            summary.opted_out += 1;
          } else {
            await admin
              .from("sms_survey_sessions")
              .update({ reminders_sent: session.reminders_sent })
              .eq("id", session.id)
              .eq("reminders_sent", session.reminders_sent + 1);
          }
        }
      }
    } catch (err) {
      summary.errors.push({
        survey_id: survey.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  try {
    summary.relay_forwards = await processQueuedRelayForwards(admin, now, getProvider);
  } catch (err) {
    console.error("sms-survey-timers: relay forwards failed:", err);
  }

  return summary;
}
