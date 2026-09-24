"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { destructiveRoleError } from "@/lib/auth/roles";
import { blackoutOverrideError } from "@/lib/sms/blast-body";
import { archiveBlockReason } from "@/lib/sms/archive-policy";
import { loadAudienceContacts, uniqueEligibleContacts } from "@/lib/sms/audience";
import { insertContactList } from "@/lib/sms/contact-lists";
import {
  SURVEY_COHORT_LABELS,
  computeSurveyCohortContactIds,
  type SurveyCohort,
} from "@/lib/sms/reporting-cohorts";
import {
  TEST_AUDIENCE_CAP,
  resolveTestAudienceContactIds,
} from "@/lib/sms/survey-test-audience";
import { getSmsProviderForOrg } from "@/lib/sms/provider";
import { providerAccountLookup } from "@/lib/sms/provider-lookup";
import { wrapSmsProviderForOrg } from "@/lib/sms/send-guard";
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
    yesGoto: string;
    noGoto: string;
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
    questions.push({
      prompt,
      qtype,
      options,
      yesGoto: String(formData.get(`q_${i}_yes_goto`) ?? "next"),
      noGoto: String(formData.get(`q_${i}_no_goto`) ?? "next"),
    });
  }
  return questions;
}

function branchTarget(
  raw: string,
  idByIndex: Map<number, string>,
): string | null {
  if (!raw || raw === "next") return null;
  if (raw === "end") return "end";
  const index = Number(raw);
  if (!Number.isInteger(index)) return null;
  return idByIndex.get(index) ?? null;
}

export async function createSurvey(
  formData: FormData,
): Promise<{ error?: string; surveyId?: string }> {
  const { org, user, supabase } = await requireOrgMember();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Title is required" };
  const questions = parseQuestions(formData);
  if (questions.length === 0) return { error: "Add at least one question" };

  const retryLimit = Math.min(5, Math.max(0, Number(formData.get("retry_limit") ?? 2) || 0));
  const questionTimeout = Math.max(1, Number(formData.get("question_timeout_minutes") ?? 120) || 120);
  const sessionTtl = Math.max(1, Number(formData.get("session_ttl_hours") ?? 72) || 72);
  const { data: survey, error } = await supabase
    .from("sms_surveys")
    .insert({
      organisation_id: org.id,
      title,
      invitation_body: String(formData.get("invitation_body") ?? "").trim() || null,
      completion_body: String(formData.get("completion_body") ?? "").trim() || null,
      created_by: user.id,
      timezone: org.timezone,
      is_test: String(formData.get("is_test") ?? "") === "on",
      retry_limit: retryLimit,
      question_timeout_minutes: questionTimeout,
      session_ttl_hours: sessionTtl,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const { data: inserted, error: qErr } = await supabase
    .from("sms_survey_questions")
    .insert(
      questions.map((q, index) => ({
        organisation_id: org.id,
        survey_id: survey.id,
        sort_order: index,
        prompt: q.prompt,
        qtype: q.qtype,
        options: q.options,
      })),
    )
    .select("id, sort_order");
  if (qErr || !inserted) {
    await supabase.from("sms_surveys").delete().eq("id", survey.id);
    return { error: qErr?.message ?? "Could not save questions" };
  }
  const idByIndex = new Map(inserted.map((row) => [row.sort_order as number, row.id as string]));
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    if (question.qtype !== "yes_no") continue;
    const yes = branchTarget(question.yesGoto, idByIndex);
    const no = branchTarget(question.noGoto, idByIndex);
    if (!yes && !no) continue;
    const branching: Record<string, string> = {};
    if (yes) branching.yes = yes;
    if (no) branching.no = no;
    const questionId = idByIndex.get(index);
    if (!questionId) continue;
    await supabase
      .from("sms_survey_questions")
      .update({ branching })
      .eq("id", questionId)
      .eq("organisation_id", org.id);
  }

  revalidatePath("/surveys");
  return { surveyId: survey.id };
}

export async function launchSurvey(
  formData: FormData,
): Promise<{ error?: string; warning?: string; overlap?: string; invited?: number }> {
  const { org, supabase, role } = await requireOrgMember();
  const blocked = destructiveRoleError(role);
  if (blocked) return { error: blocked };
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

  let eligible: ReturnType<typeof uniqueEligibleContacts>;
  if (survey.is_test) {
    const { data: roster, error: rosterError } = await supabase
      .from("sms_test_recipients")
      .select("contact_id, contacts ( id, first_name, last_name, phone_e164, sms_opt_out )")
      .eq("organisation_id", org.id);
    if (rosterError) return { error: rosterError.message };
    const contacts = (roster ?? [])
      .map((row) => {
        const contact = row.contacts as
          | {
              id: string;
              first_name: string | null;
              last_name: string | null;
              phone_e164: string;
              sms_opt_out: boolean;
            }
          | Array<{
              id: string;
              first_name: string | null;
              last_name: string | null;
              phone_e164: string;
              sms_opt_out: boolean;
            }>
          | null;
        if (Array.isArray(contact)) return contact[0] ?? null;
        return contact;
      })
      .filter((contact): contact is NonNullable<typeof contact> => Boolean(contact));
    const resolved = resolveTestAudienceContactIds(contacts.map((contact) => contact.id));
    if (resolved.error) return { error: resolved.error };
    eligible = uniqueEligibleContacts(contacts);
    if (eligible.length === 0) return { error: "Test recipients are opted out or missing a phone" };
  } else {
    const loaded = await loadAudienceContacts(supabase, {
      orgId: org.id,
      audience,
      listId,
    });
    if (loaded.error) return { error: loaded.error };
    eligible = uniqueEligibleContacts(loaded.contacts);
  }
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
  const provider = wrapSmsProviderForOrg(
    admin,
    org.id,
    await getSmsProviderForOrg(org.id, providerAccountLookup(admin)),
  );
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
  const { org, supabase, role } = await requireOrgMember();
  const blocked = destructiveRoleError(role);
  if (blocked) return { error: blocked };
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
  const { org, supabase, role } = await requireOrgMember();
  const blocked = destructiveRoleError(role);
  if (blocked) return { error: blocked };
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

export async function archiveSurvey(formData: FormData): Promise<{ error?: string }> {
  const { org, supabase, role } = await requireOrgMember();
  const blocked = destructiveRoleError(role);
  if (blocked) return { error: blocked };
  const surveyId = String(formData.get("surveyId") ?? "");
  const { data: survey } = await supabase
    .from("sms_surveys")
    .select("status")
    .eq("id", surveyId)
    .eq("organisation_id", org.id)
    .maybeSingle();
  if (!survey) return { error: "Survey not found" };
  const reason = archiveBlockReason("survey", survey.status);
  if (reason) return { error: reason };
  const { error } = await supabase
    .from("sms_surveys")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", surveyId);
  if (error) return { error: error.message };
  revalidatePath("/surveys");
  revalidatePath(`/surveys/${surveyId}`);
  return {};
}

const SURVEY_COHORTS: SurveyCohort[] = ["completed", "started_not_completed", "non_responders"];

export async function createSurveyCohortList(formData: FormData): Promise<{ error?: string }> {
  const { org, supabase, role } = await requireOrgMember();
  const blocked = destructiveRoleError(role);
  if (blocked) return { error: blocked };
  const surveyId = String(formData.get("surveyId") ?? "");
  const cohort = String(formData.get("cohort") ?? "") as SurveyCohort;
  const name = String(formData.get("list_name") ?? "").trim();
  if (!SURVEY_COHORTS.includes(cohort)) return { error: "Pick a cohort" };
  const { data: sessions } = await supabase
    .from("sms_survey_sessions")
    .select("contact_id, state, first_answer_at")
    .eq("survey_id", surveyId)
    .eq("organisation_id", org.id);
  const ids = computeSurveyCohortContactIds(
    (sessions ?? []).map((session) => ({
      contact_id: session.contact_id as string,
      state: session.state as string,
      first_answer_at: (session.first_answer_at as string | null) ?? null,
    })),
    cohort,
  );
  const created = await insertContactList(supabase, {
    orgId: org.id,
    name: name || `${SURVEY_COHORT_LABELS[cohort]} from survey`,
    contactIds: ids,
  });
  if (created.error) return { error: created.error };
  revalidatePath("/contacts");
  revalidatePath(`/surveys/${surveyId}`);
  return {};
}

export async function addTestRecipient(formData: FormData): Promise<{ error?: string }> {
  const { org, supabase } = await requireOrgMember();
  const contactId = String(formData.get("contactId") ?? "");
  if (!contactId) return { error: "Pick a contact" };
  const { data: contact } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", contactId)
    .eq("organisation_id", org.id)
    .maybeSingle();
  if (!contact) return { error: "That contact is not in this organisation" };
  const { count } = await supabase
    .from("sms_test_recipients")
    .select("contact_id", { count: "exact", head: true })
    .eq("organisation_id", org.id);
  if ((count ?? 0) >= TEST_AUDIENCE_CAP) {
    return { error: `Test roster is capped at ${TEST_AUDIENCE_CAP} people` };
  }
  const { error } = await supabase.from("sms_test_recipients").insert({
    organisation_id: org.id,
    contact_id: contactId,
  });
  if (error) return { error: error.message };
  revalidatePath("/surveys");
  return {};
}

export async function removeTestRecipient(formData: FormData): Promise<{ error?: string }> {
  const { org, supabase } = await requireOrgMember();
  const contactId = String(formData.get("contactId") ?? "");
  const { error } = await supabase
    .from("sms_test_recipients")
    .delete()
    .eq("organisation_id", org.id)
    .eq("contact_id", contactId);
  if (error) return { error: error.message };
  revalidatePath("/surveys");
  return {};
}
