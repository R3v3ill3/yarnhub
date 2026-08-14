'use client'

/**
 * TanStack Query hooks for the SMS relay module (Phase 6). All data
 * access goes through /api/sms/relays* — the relay tables are not in
 * the generated Database types yet (migration pending apply).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api/fetch-api'
import type {
  SmsRelayMessageRow,
  SmsRelayRow,
  SmsRelayTargetRow,
} from '@/types/sms'

export interface SmsRelayListRow extends SmsRelayRow {
  number: { number_id: number; phone_e164: string; label: string | null } | null
  target_count: number
  active_target_count: number
  pending_moderation_count: number
}

export interface SmsRelayLogMessage extends SmsRelayMessageRow {
  member_name: string | null
}

export interface SmsRelayDetail {
  relay: SmsRelayRow
  number: {
    number_id: number
    phone_e164: string
    label: string | null
    purpose: string
    status: string
  } | null
  targets: SmsRelayTargetRow[]
  messages: SmsRelayLogMessage[]
  pending: SmsRelayMessageRow[]
}

async function toError(res: Response, fallback: string): Promise<Error> {
  const err = await res.json().catch(() => ({ error: fallback }))
  return new Error(err.error || fallback)
}

export function useSmsRelays(campaignId?: number | string) {
  return useQuery({
    queryKey: ['sms-relays', campaignId != null ? String(campaignId) : 'all'],
    queryFn: async () => {
      const qs = campaignId != null ? `?campaign_id=${campaignId}` : ''
      const res = await fetchApi(`/api/sms/relays${qs}`)
      if (!res.ok) throw await toError(res, 'Failed to fetch relays')
      return res.json() as Promise<SmsRelayListRow[]>
    },
  })
}

export function useSmsRelayDetail(relayId: number | null) {
  return useQuery({
    queryKey: ['sms-relay', relayId],
    queryFn: async () => {
      const res = await fetchApi(`/api/sms/relays/${relayId}`)
      if (!res.ok) throw await toError(res, 'Failed to fetch relay')
      return res.json() as Promise<SmsRelayDetail>
    },
    enabled: relayId != null,
  })
}

export interface CreateSmsRelayInput {
  name: string
  campaign_id?: number | null
  number_id: number
  prefix_template?: string | null
  suffix_template?: string | null
  moderation_required?: boolean
  quiet_hours_respected?: boolean
  timezone?: string
  targets?: Array<{ phone_e164: string; display_name?: string | null }>
}

function useInvalidateRelays() {
  const queryClient = useQueryClient()
  return (relayId?: number) => {
    queryClient.invalidateQueries({ queryKey: ['sms-relays'] })
    if (relayId != null) {
      queryClient.invalidateQueries({ queryKey: ['sms-relay', relayId] })
    }
  }
}

export function useCreateSmsRelay() {
  const invalidate = useInvalidateRelays()
  return useMutation({
    mutationFn: async (input: CreateSmsRelayInput) => {
      const res = await fetchApi('/api/sms/relays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw await toError(res, 'Failed to create relay')
      return res.json() as Promise<{ relay_id: number }>
    },
    onSuccess: () => invalidate(),
  })
}

export function useUpdateSmsRelay(relayId: number) {
  const invalidate = useInvalidateRelays()
  return useMutation({
    mutationFn: async (input: {
      name?: string
      prefix_template?: string | null
      suffix_template?: string | null
      moderation_required?: boolean
      quiet_hours_respected?: boolean
      timezone?: string
    }) => {
      const res = await fetchApi(`/api/sms/relays/${relayId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw await toError(res, 'Failed to update relay')
      return res.json() as Promise<{ ok: true }>
    },
    onSuccess: () => invalidate(relayId),
  })
}

export function useSmsRelayAction(relayId: number) {
  const invalidate = useInvalidateRelays()
  return useMutation({
    mutationFn: async (action: 'activate' | 'pause' | 'end') => {
      const res = await fetchApi(`/api/sms/relays/${relayId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw await toError(res, 'Failed to update relay status')
      return res.json() as Promise<{
        ok: true
        status?: string
        number_released?: boolean
      }>
    },
    onSuccess: () => invalidate(relayId),
  })
}

export function useAddSmsRelayTarget(relayId: number) {
  const invalidate = useInvalidateRelays()
  return useMutation({
    mutationFn: async (input: {
      phone_e164: string
      display_name?: string | null
    }) => {
      const res = await fetchApi(`/api/sms/relays/${relayId}/targets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw await toError(res, 'Failed to add target')
      return res.json() as Promise<{ target_id: number }>
    },
    onSuccess: () => invalidate(relayId),
  })
}

export function useUpdateSmsRelayTarget(relayId: number) {
  const invalidate = useInvalidateRelays()
  return useMutation({
    mutationFn: async (input: {
      target_id: number
      is_active?: boolean
      display_name?: string | null
    }) => {
      const res = await fetchApi(`/api/sms/relays/${relayId}/targets`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw await toError(res, 'Failed to update target')
      return res.json() as Promise<{ ok: true }>
    },
    onSuccess: () => invalidate(relayId),
  })
}

export function useModerateSmsRelayMessage(relayId: number) {
  const invalidate = useInvalidateRelays()
  return useMutation({
    mutationFn: async (input: {
      relay_message_id: number
      action: 'approve' | 'reject'
    }) => {
      const res = await fetchApi(`/api/sms/relays/${relayId}/moderation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw await toError(res, 'Failed to moderate message')
      return res.json() as Promise<{
        ok: true
        moderation: 'approved' | 'rejected'
        forwarded?: boolean
        deferred?: string
      }>
    },
    onSuccess: () => invalidate(relayId),
  })
}
