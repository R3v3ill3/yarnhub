import type { SupabaseClient } from "@supabase/supabase-js";
import { LIVE_SESSION_STATES } from "@/lib/sms/survey-runtime";

export interface OtherOpenSurvey {
  id: string;
  title: string;
  status: string;
}

export interface SurveyLaunchConcurrency {
  other_open_surveys: OtherOpenSurvey[];
  audience_overlap_count: number;
}

export async function loadSurveyLaunchConcurrency(
  db: SupabaseClient,
  args: {
    orgId: string;
    excludeSurveyId: string;
    audiencePhones: string[];
  },
): Promise<SurveyLaunchConcurrency> {
  const { data: others, error: othersErr } = await db
    .from("sms_surveys")
    .select("id, title, status")
    .eq("organisation_id", args.orgId)
    .in("status", ["open", "paused"])
    .neq("id", args.excludeSurveyId)
    .order("opened_at", { ascending: false })
    .limit(20);
  if (othersErr) throw othersErr;

  const phones = [...new Set(args.audiencePhones.filter(Boolean))];
  const busy = new Set<string>();
  for (let i = 0; i < phones.length; i += 500) {
    const chunk = phones.slice(i, i + 500);
    const { data: live, error } = await db
      .from("sms_survey_sessions")
      .select("phone_e164")
      .eq("organisation_id", args.orgId)
      .in("phone_e164", chunk)
      .in("state", [...LIVE_SESSION_STATES]);
    if (error) throw error;
    for (const row of live ?? []) {
      if (row.phone_e164) busy.add(row.phone_e164 as string);
    }
  }

  return {
    other_open_surveys: ((others ?? []) as OtherOpenSurvey[]).map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
    })),
    audience_overlap_count: busy.size,
  };
}
