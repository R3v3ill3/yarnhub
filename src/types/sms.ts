/**
 * Survey engine row types. Kept so the copied survey-engine unit tests
 * typecheck. Yarnhub survey tables (Phase C) will use organisation/contact
 * keys instead of campaign/worker — do not treat these IDs as schema.
 */

export type SmsSurveyQuestionType = "choice" | "yes_no" | "scale" | "open_text";

export interface SmsSurveyChoiceOption {
  value: string;
  label: string;
  synonyms?: string[];
  maps_to_rating?: number | null;
  maps_to_binary?: string | null;
}

export interface SmsSurveyScaleRange {
  min: number;
  max: number;
}

export type SmsSurveyBranching = Record<string, number | "end">;

export interface SmsSurveyQuestionRow {
  question_id: number;
  survey_id: number;
  sort_order: number;
  prompt: string;
  qtype: SmsSurveyQuestionType;
  options: SmsSurveyChoiceOption[] | SmsSurveyScaleRange | null;
  branching: SmsSurveyBranching | null;
  write_rating: boolean;
  activity_id: number | null;
  invalid_prompt: string | null;
  nudge_text: string | null;
  retired_at: string | null;
  created_at: string;
  updated_at: string;
}
