/**
 * Dedicated-number purposes from Administration → SMS.
 *
 * Relay and survey purposes have webhook precedence over inbox
 * routing. Blast and chat must not send from them or replies never
 * land as conversations. Survey senders may use a survey-purpose
 * number (preferred) or an organiser number (with a warning).
 */

export const INBOX_UNSAFE_PURPOSES = ['relay', 'survey'] as const

export type InboxUnsafePurpose = (typeof INBOX_UNSAFE_PURPOSES)[number]

export function isInboxUnsafePurpose(
  purpose: string | null | undefined,
): purpose is InboxUnsafePurpose {
  return purpose === 'relay' || purpose === 'survey'
}

export const INBOX_UNSAFE_SENDER_MESSAGE =
  'This number is reserved for surveys or relays — pick an organiser number so replies land in Inbox.'

export function inboxUnsafePurposeError(
  purpose: string | null | undefined,
): string | null {
  return isInboxUnsafePurpose(purpose) ? INBOX_UNSAFE_SENDER_MESSAGE : null
}

type PurposeLookup = {
  from: (table: "sms_numbers") => {
    select: (columns: "purpose") => {
      eq: (
        column: "id",
        value: string,
      ) => {
        maybeSingle: () => Promise<{
          data: { purpose: string | null } | null
          error: { message: string } | null
        }>
      }
    }
  }
}

/** Returns the shared 409 copy if this number is reserved for surveys/relays. */
export async function inboxUnsafeSenderMessage(
  db: PurposeLookup,
  numberId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('sms_numbers')
    .select('purpose')
    .eq('id', numberId)
    .maybeSingle()
  if (error) throw error
  return inboxUnsafePurposeError(data?.purpose as string | null)
}

export function filterInboxSafeSenders<T extends { purpose: string }>(
  senders: T[],
): T[] {
  return senders.filter((s) => !isInboxUnsafePurpose(s.purpose))
}

/** Survey picker: relay numbers are claimed by live relays. */
export function filterSurveySenders<T extends { purpose: string }>(
  senders: T[],
): T[] {
  return senders.filter((s) => s.purpose !== 'relay')
}

export function surveySenderSortKey(s: {
  purpose: string
  is_mine?: boolean
}): number {
  if (s.purpose === 'survey') return 0
  if (s.is_mine) return 1
  if (s.purpose === 'organiser') return 2
  if (s.purpose === 'spare') return 3
  return 4
}

export function surveySenderPurposeHint(purpose: string): string {
  if (purpose === 'survey') return ' (survey)'
  if (purpose === 'organiser') return ' (organiser inbox)'
  if (purpose === 'spare') return ' (spare)'
  return ` (${purpose})`
}

/** Warn-only: surveys may send from organiser/spare numbers. */
export function surveySenderPurposeWarning(
  purpose: string | null | undefined,
): string | null {
  if (purpose === 'relay') {
    return 'Relay numbers are reserved for live relays — pick a survey or organiser number so replies stay in the survey session.'
  }
  if (purpose === 'organiser') {
    return 'Replies to this inbox number are treated as survey answers while a session is live — they will not appear as ordinary inbox messages until the session ends.'
  }
  if (purpose === 'spare') {
    return 'This spare number is not reserved for surveys. Prefer a survey-purpose number so inbox routing stays clear.'
  }
  return null
}
