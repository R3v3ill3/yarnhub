/**
 * Launch-time concurrency: other open/paused surveys and how many
 * people in this audience already have a live session (org-wide,
 * one invited/active session per phone).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { LIVE_SESSION_STATES } from '@/lib/sms/survey-runtime'

export interface OtherOpenSurvey {
  survey_id: number
  title: string
  status: string
}

export interface SurveyLaunchConcurrency {
  other_open_surveys: OtherOpenSurvey[]
  audience_overlap_count: number
}

export async function loadSurveyLaunchConcurrency(
  db: SupabaseClient,
  args: { excludeSurveyId: number; audiencePhones: string[] },
): Promise<SurveyLaunchConcurrency> {
  const { data: others, error: othersErr } = await db
    .from('sms_surveys')
    .select('survey_id, title, status')
    .in('status', ['open', 'paused'])
    .neq('survey_id', args.excludeSurveyId)
    .order('opened_at', { ascending: false })
    .limit(20)
  if (othersErr) throw othersErr

  const phones = [...new Set(args.audiencePhones.filter(Boolean))]
  const busy = new Set<string>()
  for (let i = 0; i < phones.length; i += 500) {
    const chunk = phones.slice(i, i + 500)
    const { data: live, error } = await db
      .from('sms_survey_sessions')
      .select('phone_e164')
      .in('phone_e164', chunk)
      .in('state', [...LIVE_SESSION_STATES])
    if (error) throw error
    for (const row of live ?? []) {
      if (row.phone_e164) busy.add(row.phone_e164 as string)
    }
  }

  return {
    other_open_surveys: ((others ?? []) as OtherOpenSurvey[]).map((s) => ({
      survey_id: s.survey_id,
      title: s.title,
      status: s.status,
    })),
    audience_overlap_count: busy.size,
  }
}
