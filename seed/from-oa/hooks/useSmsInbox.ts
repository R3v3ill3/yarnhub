'use client'

/**
 * TanStack Query hooks + realtime presence for the SMS inbox (Phase 2).
 *
 * Data access goes through the /api/sms/conversations* routes — the
 * Phase 2 tables are not in the generated Database types yet (migration
 * pending apply). Presence/typing and live thread updates use the
 * browser client's channel API directly (no table typing involved):
 * presence is advisory — warn, don't block (brief §3.1 item 6).
 */
import { useEffect, useRef, useState } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { fetchApi, API_FETCH_TIMEOUT_LLM_MS } from '@/lib/api/fetch-api'
import type {
  SmsCannedReplyRow,
  SmsConversationNoteRow,
  SmsConversationRow,
  SmsMessageRow,
  SmsThreadScope,
} from '@/types/sms'

// ─── DTO shapes (route payloads) ────────────────────────────────────

export interface SmsConversationWorkerSummary {
  worker_id: number
  first_name: string
  last_name: string
  preferred_name: string | null
  phone?: string | null
  phone_e164?: string | null
  occupation?: string | null
  sms_opt_out?: boolean
  sms_opt_out_at?: string | null
  sms_opt_out_source?: string | null
  employer?: { employer_id: number; employer_name: string } | null
}

export interface SmsConversationListItem extends SmsConversationRow {
  worker: SmsConversationWorkerSummary | null
  our_number: {
    number_id: number
    phone_e164: string
    label: string | null
    organiser_id: number | null
  } | null
  campaign: { campaign_id: number; name: string } | null
}

export interface SmsConversationDetail {
  conversation: SmsConversationListItem
  scope?: SmsThreadScope
  messages: SmsMessageRow[]
  has_more_messages: boolean
  /** Merged scopes only: conversation_id → provenance label. */
  conversation_labels?: Record<number, string>
  notes: SmsConversationNoteRow[]
  user_names: Record<string, string>
}

export type SmsInboxTab =
  | 'mine'
  | 'needs_response'
  | 'unassigned'
  | 'triage'
  | 'escalated'
  | 'all'

export interface SmsConversationFilters {
  inbox: SmsInboxTab
  campaignId?: number | null
  search?: string
  workerId?: number
}

async function toError(res: Response, fallback: string): Promise<Error> {
  const err = await res.json().catch(() => ({ error: fallback }))
  return new Error(err.error || fallback)
}

// ─── Queries ────────────────────────────────────────────────────────

export function useSmsConversations(filters: SmsConversationFilters) {
  return useQuery({
    queryKey: [
      'sms-conversations',
      filters.inbox,
      filters.campaignId ?? null,
      filters.search ?? '',
      filters.workerId ?? null,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ inbox: filters.inbox })
      if (filters.campaignId != null) {
        params.set('campaign_id', String(filters.campaignId))
      }
      if (filters.search) params.set('search', filters.search)
      if (filters.workerId != null) {
        params.set('worker_id', String(filters.workerId))
      }
      const res = await fetchApi(`/api/sms/conversations?${params}`)
      if (!res.ok) throw await toError(res, 'Failed to fetch conversations')
      return res.json() as Promise<SmsConversationListItem[]>
    },
    refetchInterval: 30_000,
  })
}

export function useSmsConversationDetail(conversationId: number | null) {
  return useQuery({
    queryKey: ['sms-conversation', conversationId],
    queryFn: async () => {
      const res = await fetchApi(`/api/sms/conversations/${conversationId}`)
      if (!res.ok) throw await toError(res, 'Failed to fetch conversation')
      return res.json() as Promise<SmsConversationDetail>
    },
    enabled: conversationId != null,
  })
}

/**
 * Non-native thread scopes (brief §7.3): 'activity' filters the native
 * thread to activity-linked traffic; 'campaign' / 'all' merge every
 * conversation for the worker. Read-only — the composer still posts to
 * the current conversation.
 */
export function useSmsScopedMessages(
  conversationId: number | null,
  scope: SmsThreadScope,
) {
  return useQuery({
    queryKey: ['sms-conversation-scope', conversationId, scope],
    queryFn: async () => {
      const res = await fetchApi(
        `/api/sms/conversations/${conversationId}?scope=${scope}`,
      )
      if (!res.ok) throw await toError(res, 'Failed to fetch scoped messages')
      return res.json() as Promise<SmsConversationDetail>
    },
    enabled: conversationId != null && scope !== 'conversation',
  })
}

export function useSmsCannedReplies(campaignId?: number | null) {
  return useQuery({
    queryKey: ['sms-canned-replies', campaignId ?? null],
    queryFn: async () => {
      const params =
        campaignId != null ? `?campaign_id=${campaignId}` : ''
      const res = await fetchApi(`/api/sms/canned-replies${params}`)
      if (!res.ok) throw await toError(res, 'Failed to fetch canned replies')
      return res.json() as Promise<SmsCannedReplyRow[]>
    },
  })
}

// ─── Mutations ──────────────────────────────────────────────────────

function useInvalidateConversation(conversationId: number | null) {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['sms-conversation', conversationId] })
    queryClient.invalidateQueries({ queryKey: ['sms-conversations'] })
  }
}

export interface SendSmsReplyInput {
  body: string
  /** Phase 7 (§8.2): true when the text originated from a "Draft reply" candidate. */
  ai_assisted?: boolean
}

export function useSendSmsReply(conversationId: number | null) {
  const invalidate = useInvalidateConversation(conversationId)
  return useMutation({
    mutationFn: async (input: SendSmsReplyInput) => {
      const res = await fetchApi(
        `/api/sms/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body: input.body,
            ai_assisted: input.ai_assisted ?? false,
          }),
        },
      )
      if (!res.ok) throw await toError(res, 'Failed to send reply')
      return res.json() as Promise<{ ok: true; message: SmsMessageRow }>
    },
    onSuccess: invalidate,
  })
}

export interface SmsDraftReplyCandidate {
  kind: 'reply' | 'reply_and_advance' | 'escalate_tone'
  label: string
  body: string
  segments: number
}

/**
 * Phase 7 (§8.2) AI reply drafting. Server-side context assembly; the
 * candidates are only ever loaded into the composer — never auto-sent.
 */
export function useDraftSmsReply(conversationId: number | null) {
  return useMutation({
    mutationFn: async () => {
      const res = await fetchApi(
        `/api/sms/conversations/${conversationId}/draft-reply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          timeoutMs: API_FETCH_TIMEOUT_LLM_MS,
        },
      )
      if (!res.ok) throw await toError(res, 'Failed to draft a reply')
      return res.json() as Promise<{ candidates: SmsDraftReplyCandidate[] }>
    },
  })
}

export type SmsConversationAction =
  | { action: 'assign'; user_id: string | null }
  | { action: 'escalate'; user_id?: string }
  | { action: 'de_escalate' }
  | { action: 'close' }
  | { action: 'reopen' }
  | { action: 'attach'; campaign_id?: number | null; activity_id?: number | null }

export function useSmsConversationAction(conversationId: number | null) {
  const invalidate = useInvalidateConversation(conversationId)
  return useMutation({
    mutationFn: async (action: SmsConversationAction) => {
      const res = await fetchApi(`/api/sms/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      })
      if (!res.ok) throw await toError(res, 'Failed to update conversation')
      return res.json() as Promise<Partial<SmsConversationRow>>
    },
    onSuccess: invalidate,
  })
}

export function useAddSmsNote(conversationId: number | null) {
  const invalidate = useInvalidateConversation(conversationId)
  return useMutation({
    mutationFn: async (body: string) => {
      const res = await fetchApi(
        `/api/sms/conversations/${conversationId}/notes`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        },
      )
      if (!res.ok) throw await toError(res, 'Failed to add note')
      return res.json() as Promise<{ ok: true; note: SmsConversationNoteRow }>
    },
    onSuccess: invalidate,
  })
}

export interface SaveSmsAssessmentInput {
  activity_id: number
  /** 1..5, or null. Both null = explicit "Unassessed" (clears the row). */
  rating: number | null
  binary_value: string | null
  notes?: string | null
}

/**
 * Phase 3 sidebar assessment save. Server side this funnels through
 * record_assessment_event (source 'sms') into campaign_activity_ratings
 * — see POST /api/sms/conversations/[id]/assessments. Invalidations
 * mirror useSaveActivityRating so the wall chart / worker drawer pick
 * the write up immediately.
 */
export function useSaveSmsAssessment(
  conversationId: number | null,
  campaignId: number | null,
  workerId: number | null,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: SaveSmsAssessmentInput) => {
      const res = await fetchApi(
        `/api/sms/conversations/${conversationId}/assessments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      )
      if (!res.ok) throw await toError(res, 'Failed to record assessment')
      return res.json() as Promise<{
        ok: true
        rating_id?: number
        cleared?: boolean
      }>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['sms-worker-assessment-ratings', campaignId, workerId],
      })
      // Prefix-only invalidation: wall-chart keys carry the campaign id
      // as a string (page param) while the conversation holds a number —
      // matching the prefix sidesteps the type mismatch.
      queryClient.invalidateQueries({ queryKey: ['campaign-rating-summary'] })
      queryClient.invalidateQueries({ queryKey: ['campaign-activity-ratings'] })
      queryClient.invalidateQueries({
        queryKey: ['campaign-activity-ratings-dist'],
      })
      queryClient.invalidateQueries({ queryKey: ['worker-activity-ratings'] })
    },
  })
}

export function useCreateCannedReply() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      title: string
      body: string
      campaign_id?: number | null
      outcome_value?: string | null
    }) => {
      const res = await fetchApi('/api/sms/canned-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw await toError(res, 'Failed to save canned reply')
      return res.json() as Promise<{ ok: true; reply: SmsCannedReplyRow }>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sms-canned-replies'] })
    },
  })
}

// ─── Soft claim lifecycle ───────────────────────────────────────────

const CLAIM_TTL_MINUTES = 5
const CLAIM_RENEW_MS = 2 * 60 * 1000

export interface SmsClaimState {
  claimed: boolean
  holderName: string | null
}

/**
 * Claims the conversation while the thread is open, renews inside the
 * TTL, and releases on unmount/switch. A failed claim only warns —
 * concurrent viewing is allowed (presence covers the rest).
 */
export function useSmsConversationClaim(
  conversationId: number | null,
): SmsClaimState {
  const [state, setState] = useState<SmsClaimState>({
    claimed: false,
    holderName: null,
  })

  useEffect(() => {
    if (conversationId == null) return
    let cancelled = false

    const claim = async () => {
      try {
        const res = await fetchApi(
          `/api/sms/conversations/${conversationId}/claim`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ttl_minutes: CLAIM_TTL_MINUTES }),
          },
        )
        if (!res.ok) return
        const data = (await res.json()) as {
          claimed: boolean
          holder_name?: string | null
        }
        if (!cancelled) {
          setState({
            claimed: data.claimed,
            holderName: data.claimed ? null : (data.holder_name ?? null),
          })
        }
      } catch {
        // Claiming is advisory — never surface an error for it.
      }
    }

    void claim()
    const timer = setInterval(() => void claim(), CLAIM_RENEW_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
      void fetchApi(`/api/sms/conversations/${conversationId}/claim`, {
        method: 'DELETE',
      }).catch(() => undefined)
    }
  }, [conversationId])

  return state
}

// ─── Realtime: presence + live thread updates ───────────────────────

export interface SmsPresencePeer {
  userId: string
  name: string
  typing: boolean
}

export interface SmsRealtimeState {
  /** Other people currently viewing this thread. */
  viewers: SmsPresencePeer[]
  /** True when another viewer is composing (warn, don't block). */
  someoneElseTyping: boolean
  /** Broadcast own typing state (debounce upstream). */
  setTyping: (typing: boolean) => void
}

/**
 * Per-conversation Realtime channel:
 *   - presence (key = user id, meta {name, typing}) for "X is viewing"
 *     pills and compose-collision warnings;
 *   - postgres_changes INSERT/UPDATE on sms_messages for the
 *     conversation → invalidate the thread query. Requires the
 *     migration's `ALTER PUBLICATION supabase_realtime ADD TABLE
 *     sms_messages`; without it the subscription is a silent no-op and
 *     the 30 s poll still keeps things fresh.
 */
export function useSmsConversationRealtime(
  conversationId: number | null,
): SmsRealtimeState {
  const queryClient = useQueryClient()
  const [viewers, setViewers] = useState<SmsPresencePeer[]>([])
  const trackRef = useRef<((typing: boolean) => void) | null>(null)

  useEffect(() => {
    if (conversationId == null) return
    const supabase = createClient()
    let disposed = false
    let debounce: ReturnType<typeof setTimeout> | null = null
    let channel: ReturnType<typeof supabase.channel> | null = null

    const scheduleThreadReload = () => {
      if (debounce) return
      debounce = setTimeout(() => {
        debounce = null
        queryClient.invalidateQueries({
          queryKey: ['sms-conversation', conversationId],
        })
        queryClient.invalidateQueries({ queryKey: ['sms-conversations'] })
      }, 400)
    }

    const start = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || disposed) return
      const selfId = user.id
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('display_name')
        .eq('user_id', user.id)
        .maybeSingle()
      const selfName = profile?.display_name || user.email || 'Someone'
      if (disposed) return

      // Presence key = user id: one presence entry per person.
      channel = supabase.channel(`sms-conv-${conversationId}`, {
        config: { presence: { key: selfId } },
      })

      const syncViewers = () => {
        if (!channel) return
        const presenceState = channel.presenceState<{
          user_id: string
          name: string
          typing: boolean
        }>()
        const peers: SmsPresencePeer[] = []
        for (const metas of Object.values(presenceState)) {
          for (const meta of metas) {
            if (!meta.user_id || meta.user_id === selfId) continue
            peers.push({
              userId: meta.user_id,
              name: meta.name || 'Someone',
              typing: !!meta.typing,
            })
          }
        }
        if (!disposed) setViewers(peers)
      }

      channel
        .on('presence', { event: 'sync' }, syncViewers)
        .on('presence', { event: 'join' }, syncViewers)
        .on('presence', { event: 'leave' }, syncViewers)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'sms_messages',
            filter: `conversation_id=eq.${conversationId}`,
          },
          scheduleThreadReload,
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            void channel?.track({
              user_id: selfId,
              name: selfName,
              typing: false,
            })
          }
        })

      trackRef.current = (typing: boolean) => {
        void channel?.track({ user_id: selfId, name: selfName, typing })
      }
    }
    void start()

    return () => {
      disposed = true
      trackRef.current = null
      if (debounce) clearTimeout(debounce)
      if (channel) void supabase.removeChannel(channel)
      setViewers([])
    }
  }, [conversationId, queryClient])

  return {
    viewers,
    someoneElseTyping: viewers.some((v) => v.typing),
    setTyping: (typing: boolean) => trackRef.current?.(typing),
  }
}
