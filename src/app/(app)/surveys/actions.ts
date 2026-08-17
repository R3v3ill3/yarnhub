"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { blackoutOverrideError } from "@/lib/sms/blast-body";
import { loadAudienceContacts, uniqueEligibleContacts } from "@/lib/sms/audience";
import { getSmsProviderForOrg } from "@/lib/sms/provider";
import { providerAccountLookup } from "@/lib/sms/provider-lookup";
import { loadSurveyLaunchConcurrency } from "@/lib/sms/survey-concurrency";
import { dispatchSurveyInvitations } from "@/lib/sms/survey-invitation-dispatch";
import { filterSurveySenders, surveySenderPurposeWarning } from "@/lib/sms/sender-purpose";
import type { SurveyRow } from "@/lib/sms/survey-runtime";
import type { SmsSurveyQuestionType } from "@/types/sms";

const QTYPES: SmsSurveyQuestionType[] = ["yes_no", "choice", "scale", "open_text"];

function parseQuestions(formData: FormData) {
  const count = Number(formData.get("questionCount") ?? 0);
  const questions: Array<{
    prompt: string;
    qtype: SmsSurveyQuestionType;
    options: unknown;
  }> = [];
  for (let i = 0; i < count; i += 1) {
    const prompt = String(formData.get(`q_${i}_prompt`) ?? "").trim();
    const qtype = String(formData.get(`q_${i}_qtype`) ?? "yes_no") as SmsSurveyQuestionType;
    if (!prompt) continue;
    if (!QTYPES.includes(qtype)) continue;
    let options: unknown = null;
    if (qtype === "choice") {
      const raw = String(formData.get(`q_${i}_options`) ?? "");
      const parts = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      options = parts.map((label, idx) => ({
        value: label.toLowerCase().replace(/\s+/g, "_") || `opt_${idx + 1}`,
        label,
      }));
    } else if (qtype === "scale") {
      options = { min: 1, max: 5 };
    }
    questions.push({ prompt, qtype, options });
  }
  return questions;
}

export async function createSurvey(
  formData: FormData,
): Promise<{ error?: string; surveyId?: string }> {
  const { org, user, supabase } = await requireOrgMember();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Title is required" };
  const questions = parseQuestions(formData);
  if (questions.length === 0) return { error: "Add at least one question" };

  const { data: survey, error } = await supabase
    .from("sms_surveys")
    .insert({
      organisation_id: org.id,
      title,
      invitation_body: String(formData.get("invitation_body") ?? "").trim() || null,
      completion_body: String(formData.get("completion_body") ?? "").trim() || null,
      created_by: user.id,
      timezone: org.timezone,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const { error: qErr } = await supabase.from("sms_survey_questions").insert(
    questions.map((q, index) => ({
      organisation_id: org.id,
      survey_id: survey.id,
      sort_order: index,
      prompt: q.prompt,
      qtype: q.qtype,
      options: q.options,
    })),
  );
  if (qErr) {
    await supabase.from("sms_surveys").delete().eq("id", survey.id);
    return { error: qErr.message };
  }

  revalidatePath("/surveys");
  return { surveyId: survey.id };
}

export async function launchSurvey(
  formData: FormData,
): Promise<{ error?: string; warning?: string; overlap?: string; invited?: number }> {
  const { org, supabase } = await requireOrgMember();
  const surveyId = String(formData.get("surveyId") ?? "");
  const numberId = String(formData.get("numberId") ?? "");
  const audience = String(formData.get("audience") ?? "all") === "list" ? "list" : "all";
  const listId = String(formData.get("listId") ?? "");
  const confirmOverlap = String(formData.get("confirmOverlap") ?? "") === "1";
  const blackoutOverride = String(formData.get("blackout_override") ?? "") === "on";
  const blackoutReason = String(formData.get("blackout_override_reason") ?? "");

  if (!surveyId) return { error: "Missing survey" };
  if (!numberId) return { error: "Pick a survey sender number" };

  const overrideErr = blackoutOverrideError(blackoutOverride, blackoutReason);
  if (overrideErr) return { error: overrideErr };

  const { data: survey, error: surveyError } = await supabase
    .from("sms_surveys")
    .select("*")
    .eq("id", surveyId)
    .eq("organisation_id", org.id)
    .maybeSingle();
  if (surveyError) return { error: surveyError.message };
  if (!survey) return { error: "Survey not found" };
  if (survey.status !== "draft" && survey.status !== "paused") {
    return { error: "Only draft or paused surveys can be launched" };
  }

  const { data: number } = await supabase
    .from("sms_numbers")
    .select("id, purpose, status")
    .eq("id", numberId)
    .eq("organisation_id", org.id)
    .maybeSingle();
  if (!number || number.status !== "active") return { error: "Unknown or retired number" };
  const allowed = filterSurveySenders([number]);
  if (!allowed.length) return { error: "Relay numbers cannot send surveys" };
  const purposeWarn = surveySenderPurposeWarning(number.purpose);

  const { data: questions } = await supabase
    .from("sms_survey_questions")
    .select("id")
    .eq("survey_id", surveyId)
    .order("sort_order", { ascending: true });
  if (!questions?.length) return { error: "Survey has no questions" };

  const loaded = await loadAudienceContacts(supabase, {
    orgId: org.id,
    audience,
    listId,
  });
  if (loaded.error) return { error: loaded.error };
  const eligible = uniqueEligibleContacts(loaded.contacts);
  if (eligible.length === 0) {
    return { error: "No eligible contacts (everyone is opted out or missing a phone)" };
  }

  const concurrency = await loadSurveyLaunchConcurrency(supabase, {
    orgId: org.id,
    excludeSurveyId: surveyId,
    audiencePhones: eligible.map((c) => c.phone_e164),
  });
  if ((concurrency.audience_overlap_count > 0 || concurrency.other_open_surveys.length > 0) && !confirmOverlap) {
    const other = concurrency.other_open_surveys.map((s) => s.title).join(", ");
    return {
      overlap: [
        concurrency.audience_overlap_count
          ? `${concurrency.audience_overlap_count} people already have a live survey session.`
          : null,
        other ? `Other open/paused surveys: ${other}.` : null,
        purposeWarn,
        "Submit again to queue the rest (busy phones stay queued until free).",
      ]
        .filter(Boolean)
        .join(" "),
    };
  }

  const now = new Date().toISOString();
  const { data: existingSessions } = await supabase
    .from("sms_survey_sessions")
    .select("contact_id")
    .eq("survey_id", surveyId)
    .eq("organisation_id", org.id);
  const already = new Set((existingSessions ?? []).map((s) => s.contact_id as string));
  const toInsert = eligible.filter((c) => !already.has(c.id));

  const { error: updateErr } = await supabase
    .from("sms_surveys")
    .update({
      status: "open",
      sender_number_id: numberId,
      blackout_override: blackoutOverride,
      blackout_override_reason: blackoutOverride ? blackoutReason.trim() : null,
      opened_at: survey.opened_at ?? now,
      paused_at: null,
      pause_mode: null,
    })
    .eq("id", surveyId);
  if (updateErr) return { error: updateErr.message };

  if (toInsert.length > 0) {
    const { error: sessionErr } = await supabase.from("sms_survey_sessions").insert(
      toInsert.map((c) => ({
        organisation_id: org.id,
        survey_id: surveyId,
        contact_id: c.id,
        phone_e164: c.phone_e164,
        state: "queued",
      })),
    );
    if (sessionErr) return { error: sessionErr.message };
  }

  const admin = createAdminClient();
  const { data: opened } = await admin.from("sms_surveys").select("*").eq("id", surveyId).single();
  if (!opened) return { error: "Survey could not be reloaded after launch" };
  const provider = await getSmsProviderForOrg(org.id, providerAccountLookup(admin));
  const summary = await dispatchSurveyInvitations(admin, provider, {
    survey: opened as SurveyRow,
    limit: 200,
  });

  revalidatePath("/surveys");
  revalidatePath(`/surveys/${surveyId}`);
  return {
    invited: summary.invited,
    warning:
      summary.deferred_live_phone > 0
        ? `${summary.deferred_live_phone} invitations deferred because those phones already have a live session.`
        : purposeWarn ?? undefined,
  };
}

export async function pauseSurvey(formData: FormData): Promise<{ error?: string }> {
  const { org, supabase } = await requireOrgMember();
  const surveyId = String(formData.get("surveyId") ?? "");
  const mode = String(formData.get("pause_mode") ?? "soft") === "hard" ? "hard" : "soft";
  const { error } = await supabase
    .from("sms_surveys")
    .update({
      status: "paused",
      pause_mode: mode,
      paused_at: new Date().toISOString(),
    })
    .eq("id", surveyId)
    .eq("organisation_id", org.id)
    .eq("status", "open");
  if (error) return { error: error.message };
  revalidatePath("/surveys");
  revalidatePath(`/surveys/${surveyId}`);
  return {};
}

export async function closeSurvey(formData: FormData): Promise<{ error?: string }> {
  const { org, supabase } = await requireOrgMember();
  const surveyId = String(formData.get("surveyId") ?? "");
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("sms_surveys")
    .update({ status: "closed", closed_at: now })
    .eq("id", surveyId)
    .eq("organisation_id", org.id);
  if (error) return { error: error.message };
  await supabase
    .from("sms_survey_sessions")
    .update({ state: "expired", last_activity_at: now })
    .eq("survey_id", surveyId)
    .eq("organisation_id", org.id)
    .in("state", ["queued", "invited", "active"]);
  revalidatePath("/surveys");
  revalidatePath(`/surveys/${surveyId}`);
  return {};
}
