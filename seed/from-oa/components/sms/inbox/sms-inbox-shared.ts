import { toDisplay } from '@/lib/phone/normalise-phone'
import type { SmsConversationListItem } from '@/lib/hooks/useSmsInbox'

/** Badge colours per conversation state (Spoke machine + triage). */
export const CONVERSATION_STATE_COLORS: Record<string, string> = {
  needs_message: 'bg-slate-100 text-slate-700',
  messaged: 'bg-blue-100 text-blue-700',
  needs_response: 'bg-amber-100 text-amber-800',
  convo: 'bg-green-100 text-green-700',
  closed: 'bg-slate-100 text-slate-500',
  triage: 'bg-purple-100 text-purple-700',
}

/** Worker name when matched, else the member phone (triage rows). */
export function conversationTitle(conv: SmsConversationListItem): string {
  if (conv.worker) {
    const preferred = conv.worker.preferred_name
    return `${preferred || conv.worker.first_name} ${conv.worker.last_name}`.trim()
  }
  return toDisplay(conv.phone_e164)
}
