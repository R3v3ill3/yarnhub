export const TEST_AUDIENCE_CAP = 25;

export const EMPTY_TEST_ROSTER_MESSAGE =
  "No test recipients yet. Add people under Test recipients, then launch. Test mode never sends to the full contact list.";

export function resolveTestAudienceContactIds(contactIds: string[]): {
  ids: string[];
  error?: string;
} {
  const unique = [...new Set(contactIds.filter(Boolean))];
  if (unique.length === 0) return { ids: [], error: EMPTY_TEST_ROSTER_MESSAGE };
  if (unique.length > TEST_AUDIENCE_CAP) {
    return {
      ids: [],
      error: `Test roster has ${unique.length} people. Keep it at ${TEST_AUDIENCE_CAP} or fewer.`,
    };
  }
  return { ids: unique };
}
