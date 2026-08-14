/**
 * Server-side survey authoring helper shared by the create (POST) and
 * edit (PATCH) routes: inserts the question list and rewrites the
 * payload's INDEX-based branch targets to real question_ids.
 * Runs on the RLS-checked user client (draft) or admin client (paused).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SurveyQuestionInput } from "@/lib/sms/survey-validation";
import type { SmsSurveyQuestionRow } from "@/types/sms";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

async function rewriteBranching(
  supabase: Db,
  questions: SurveyQuestionInput[],
  idByIndex: Map<number, number>,
): Promise<void> {
  for (let i = 0; i < questions.length; i++) {
    const branching = questions[i].branching;
    const questionId = idByIndex.get(i);
    if (!questionId) continue;
    if (!branching || Object.keys(branching).length === 0) {
      const { error } = await supabase
        .from("sms_survey_questions")
        .update({ branching: null })
        .eq("question_id", questionId);
      if (error) throw error;
      continue;
    }
    const mapped: Record<string, number | "end"> = {};
    for (const [value, target] of Object.entries(branching)) {
      mapped[value] =
        target === "end" ? "end" : (idByIndex.get(target as number) ?? "end");
    }
    const { error: brErr } = await supabase
      .from("sms_survey_questions")
      .update({ branching: mapped })
      .eq("question_id", questionId);
    if (brErr) throw brErr;
  }
}

export async function insertSurveyQuestions(
  supabase: Db,
  surveyId: number,
  questions: SurveyQuestionInput[],
): Promise<void> {
  const { data: inserted, error } = await supabase
    .from("sms_survey_questions")
    .insert(
      questions.map((q, i) => ({
        survey_id: surveyId,
        sort_order: i,
        prompt: q.prompt!.trim(),
        qtype: q.qtype,
        options: q.options ?? null,
        branching: null, // rewritten below once ids exist
        write_rating: !!q.write_rating,
        activity_id: q.activity_id ?? null,
        invalid_prompt: q.invalid_prompt?.trim() || null,
        nudge_text: q.nudge_text?.trim() || null,
      })),
    )
    .select("question_id, sort_order");
  if (error) throw error;
  const idByIndex = new Map<number, number>(
    (inserted ?? []).map((r) => [r.sort_order as number, r.question_id as number]),
  );
  await rewriteBranching(supabase, questions, idByIndex);
}

/**
 * Post-open (paused) question replace that preserves answer FKs:
 * update existing rows in order, insert extras, retire/delete removed.
 */
export async function replaceSurveyQuestionsPreservingAnswers(
  supabase: Db,
  surveyId: number,
  questions: SurveyQuestionInput[],
  existing: SmsSurveyQuestionRow[],
): Promise<void> {
  const ordered = [...existing]
    .filter((q) => !q.retired_at)
    .sort((a, b) => a.sort_order - b.sort_order || a.question_id - b.question_id);

  const idByIndex = new Map<number, number>();
  const nowIso = new Date().toISOString();

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const prev = ordered[i];
    if (prev) {
      const { error } = await supabase
        .from("sms_survey_questions")
        .update({
          sort_order: i,
          prompt: q.prompt!.trim(),
          qtype: q.qtype,
          options: q.options ?? null,
          write_rating: !!q.write_rating,
          activity_id: q.activity_id ?? null,
          invalid_prompt: q.invalid_prompt?.trim() || null,
          nudge_text: q.nudge_text?.trim() || null,
          retired_at: null,
        })
        .eq("question_id", prev.question_id);
      if (error) throw error;
      idByIndex.set(i, prev.question_id);
    } else {
      const { data: inserted, error } = await supabase
        .from("sms_survey_questions")
        .insert({
          survey_id: surveyId,
          sort_order: i,
          prompt: q.prompt!.trim(),
          qtype: q.qtype,
          options: q.options ?? null,
          branching: null,
          write_rating: !!q.write_rating,
          activity_id: q.activity_id ?? null,
          invalid_prompt: q.invalid_prompt?.trim() || null,
          nudge_text: q.nudge_text?.trim() || null,
        })
        .select("question_id")
        .single();
      if (error) throw error;
      idByIndex.set(i, inserted.question_id as number);
    }
  }

  for (let i = questions.length; i < ordered.length; i++) {
    const prev = ordered[i];
    const { count, error: cErr } = await supabase
      .from("sms_survey_answers")
      .select("answer_id", { count: "exact", head: true })
      .eq("question_id", prev.question_id);
    if (cErr) throw cErr;
    if ((count ?? 0) > 0) {
      const { error } = await supabase
        .from("sms_survey_questions")
        .update({ retired_at: nowIso, sort_order: 10000 + i })
        .eq("question_id", prev.question_id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("sms_survey_questions")
        .delete()
        .eq("question_id", prev.question_id);
      if (error) throw error;
    }
  }

  await rewriteBranching(supabase, questions, idByIndex);
}
