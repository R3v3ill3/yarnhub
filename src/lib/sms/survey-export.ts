export interface SurveyExportQuestion {
  id: string;
  prompt: string;
  sort_order: number;
}

export interface SurveyExportAnswer {
  parsed_value: string | null;
  raw_body: string | null;
}

export interface SurveyExportRespondent {
  name: string;
  phone: string;
  state: string;
  answers: Record<string, SurveyExportAnswer | undefined>;
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function line(cells: string[]): string {
  return cells.map(csvCell).join(",");
}

/**
 * One row per respondent. Each question has the engine's parsed value
 * and the verbatim reply. Open-text parsed values are truncated by the
 * runtime, so the raw column is the one to read.
 */
export function surveyAnswersToWideCsv(args: {
  questions: SurveyExportQuestion[];
  respondents: SurveyExportRespondent[];
}): string {
  const questions = [...args.questions].sort((a, b) => a.sort_order - b.sort_order);
  const header = ["name", "phone", "state"];
  for (const question of questions) {
    const label = question.prompt.replace(/\s+/g, " ").trim() || question.id;
    header.push(`${label} (parsed)`, `${label} (verbatim)`);
  }
  const rows = args.respondents.map((person) => {
    const cells = [person.name, person.phone, person.state];
    for (const question of questions) {
      const answer = person.answers[question.id];
      cells.push(answer?.parsed_value ?? "", answer?.raw_body ?? "");
    }
    return line(cells);
  });
  return [line(header), ...rows].join("\n");
}
