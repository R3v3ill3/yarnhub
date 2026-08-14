/**
 * Survey definition version snapshots — sessions pin survey_version;
 * runtime loads questions from the matching snapshot when present.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SmsSurveyQuestionRow } from '@/types/sms'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export async function loadLiveQuestions(
  db: Db,
  surveyId: number,
  opts?: { includeRetired?: boolean },
): Promise<SmsSurveyQuestionRow[]> {
  let query = db
    .from('sms_survey_questions')
    .select('*')
    .eq('survey_id', surveyId)
    .order('sort_order', { ascending: true })
    .order('question_id', { ascending: true })
  if (!opts?.includeRetired) {
    query = query.is('retired_at', null)
  }
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as SmsSurveyQuestionRow[]
}

export async function snapshotSurveyVersion(
  db: Db,
  surveyId: number,
  version: number,
  questions?: SmsSurveyQuestionRow[],
): Promise<void> {
  const rows = questions ?? (await loadLiveQuestions(db, surveyId))
  const { error } = await db.from('sms_survey_definition_versions').upsert(
    {
      survey_id: surveyId,
      version,
      questions: rows,
    },
    { onConflict: 'survey_id,version' },
  )
  if (error) throw error
}

export async function loadQuestionsForVersion(
  db: Db,
  surveyId: number,
  version: number,
): Promise<SmsSurveyQuestionRow[]> {
  const { data, error } = await db
    .from('sms_survey_definition_versions')
    .select('questions')
    .eq('survey_id', surveyId)
    .eq('version', version)
    .maybeSingle()
  if (error) throw error
  if (data?.questions && Array.isArray(data.questions)) {
    return data.questions as SmsSurveyQuestionRow[]
  }
  // Fallback for pre-lifecycle surveys / missing snapshot.
  return loadLiveQuestions(db, surveyId)
}
