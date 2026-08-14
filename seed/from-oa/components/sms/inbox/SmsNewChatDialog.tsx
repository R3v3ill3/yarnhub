'use client'

/**
 * "New chat" / "Message this member" dialog (Feature 1 UI): pick a
 * member (search over workers with a mobile on file — skipped when the
 * caller already knows the worker), pick a sender number (defaults to
 * the signed-in organiser's own number server-side), optionally attach
 * to a campaign activity, then create-or-attach the thread via
 * POST /api/sms/conversations.
 *
 * Campaign scope comes from the surface that opens the dialog: the
 * campaign SMS inbox passes its campaign (campaign-scoped thread), the
 * worker page passes none (org-wide thread).
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, MessageSquarePlus, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toDisplay } from '@/lib/phone/normalise-phone'
import { fetchApi } from '@/lib/api/fetch-api'
import { useSmsSenders } from '@/lib/hooks/useSmsBroadcast'
import { useStartSmsConversation } from '@/lib/hooks/useSmsP2p'
import type { SmsConversationListItem } from '@/lib/hooks/useSmsInbox'
import { CONVERSATION_STATE_COLORS } from './sms-inbox-shared'
import { Badge } from '@/components/ui/badge'

const NO_ACTIVITY = '__none__'

interface WorkerOption {
  worker_id: number
  first_name: string
  last_name: string
  preferred_name: string | null
  phone_e164: string | null
  sms_opt_out: boolean
  employer: { employer_name: string } | null
}

interface SmsNewChatDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Campaign scope for the new thread; omit for an org-wide thread. */
  campaignId?: number | null
  /** Pre-selected member (worker page) — hides the search step. */
  workerId?: number
  workerName?: string
  onCreated: (conversationId: number, existing: boolean) => void
}

export function SmsNewChatDialog({
  open,
  onOpenChange,
  campaignId,
  workerId,
  workerName,
  onCreated,
}: SmsNewChatDialogProps) {
  const [search, setSearch] = useState('')
  const [selectedWorker, setSelectedWorker] = useState<WorkerOption | null>(null)
  const [senderNumberId, setSenderNumberId] = useState<number | null>(null)
  const [activityId, setActivityId] = useState<string>(NO_ACTIVITY)
  const { data: senders } = useSmsSenders()
  const start = useStartSmsConversation()

  const effectiveWorkerId = workerId ?? selectedWorker?.worker_id ?? null

  const { data: candidates, isFetching } = useQuery({
    queryKey: ['sms-new-chat-workers', search.trim()],
    queryFn: async () => {
      const supabase = createClient()
      const term = `%${search.trim().replace(/[,()]/g, ' ')}%`
      const { data, error } = await supabase
        .from('workers')
        .select(
          'worker_id, first_name, last_name, preferred_name, phone_e164, sms_opt_out, employer:employers(employer_name)',
        )
        .or(
          `first_name.ilike.${term},last_name.ilike.${term},preferred_name.ilike.${term}`,
        )
        .not('phone_e164', 'is', null)
        .order('last_name', { ascending: true })
        .limit(20)
      if (error) throw error
      return data as unknown as WorkerOption[]
    },
    enabled: open && workerId == null && search.trim().length >= 2,
  })

  // Preset-worker mode (worker page): load name/phone/opt-out so the
  // dialog can show who it is and block an unusable target up front.
  const { data: presetWorker } = useQuery({
    queryKey: ['sms-new-chat-worker', workerId ?? null],
    queryFn: async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('workers')
        .select('worker_id, first_name, last_name, phone_e164, sms_opt_out')
        .eq('worker_id', workerId as number)
        .maybeSingle()
      if (error) throw error
      return data
    },
    enabled: open && workerId != null,
  })

  const { data: activities } = useQuery({
    queryKey: ['sms-campaign-activity-options', campaignId ?? null],
    queryFn: async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('campaign_activities')
        .select('activity_id, title')
        .eq('campaign_id', campaignId as number)
        .order('title', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    enabled: open && campaignId != null,
  })

  // Sibling-thread trap guard: surface the member's existing OPEN
  // conversations (any scope) before creating — an accidental org-wide
  // sibling of a campaign thread makes inbound routing ping-pong by
  // recency. Creating anyway stays available.
  const { data: openThreads } = useQuery({
    queryKey: ['sms-new-chat-open-threads', effectiveWorkerId],
    queryFn: async () => {
      const res = await fetchApi(
        `/api/sms/conversations?inbox=all&worker_id=${effectiveWorkerId}`,
      )
      if (!res.ok) throw new Error('Failed to check existing threads')
      const rows = (await res.json()) as SmsConversationListItem[]
      return rows.filter((c) => c.state !== 'closed')
    },
    enabled: open && effectiveWorkerId != null,
  })

  // Chats never use relay/survey-purpose numbers — replies on those
  // numbers are consumed by their webhooks before conversation routing
  // and would orphan the thread (the POST route also rejects them).
  const chatSenders = (senders ?? []).filter(
    (s) => s.purpose !== 'relay' && s.purpose !== 'survey',
  )
  // Default the sender to the signed-in organiser's own number.
  const mine = chatSenders.find((s) => s.is_mine)
  const effectiveSender = senderNumberId ?? mine?.number_id ?? null

  const reset = () => {
    setSearch('')
    setSelectedWorker(null)
    setSenderNumberId(null)
    setActivityId(NO_ACTIVITY)
  }

  const submit = () => {
    if (effectiveWorkerId == null) return
    start.mutate(
      {
        worker_id: effectiveWorkerId,
        campaign_id: campaignId ?? null,
        activity_id:
          campaignId != null && activityId !== NO_ACTIVITY
            ? Number(activityId)
            : null,
        sender_number_id: effectiveSender,
      },
      {
        onSuccess: (res) => {
          toast.success(
            res.existing
              ? 'Opened the existing thread with this member'
              : 'Chat started — send the first message',
          )
          reset()
          onOpenChange(false)
          onCreated(res.conversation_id, res.existing)
        },
        onError: (err: Error) => toast.error(err.message),
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New chat</DialogTitle>
          <DialogDescription>
            {campaignId != null
              ? 'Starts (or reopens) a 1:1 thread scoped to this campaign.'
              : 'Starts (or reopens) an org-wide 1:1 thread with this member.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {workerId == null ? (
            <div className="space-y-1.5">
              <Label className="text-xs">Member</Label>
              {selectedWorker ? (
                <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {selectedWorker.first_name} {selectedWorker.last_name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {selectedWorker.phone_e164
                        ? toDisplay(selectedWorker.phone_e164)
                        : 'no mobile'}
                      {selectedWorker.employer
                        ? ` · ${selectedWorker.employer.employer_name}`
                        : ''}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setSelectedWorker(null)}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      className="pl-7"
                      placeholder="Search members with a mobile…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  {search.trim().length >= 2 && (
                    <div className="max-h-48 overflow-y-auto rounded-md border">
                      {isFetching && (
                        <div className="flex justify-center py-3">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      )}
                      {!isFetching && (candidates ?? []).length === 0 && (
                        <p className="p-3 text-xs text-muted-foreground">
                          No members with a mobile match that search.
                        </p>
                      )}
                      {(candidates ?? []).map((w) => (
                        <button
                          key={w.worker_id}
                          type="button"
                          disabled={w.sms_opt_out}
                          className="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/50 disabled:opacity-50"
                          onClick={() => setSelectedWorker(w)}
                        >
                          <span className="font-medium">
                            {w.first_name} {w.last_name}
                          </span>
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {w.phone_e164 ? toDisplay(w.phone_e164) : ''}
                            {w.employer ? ` · ${w.employer.employer_name}` : ''}
                            {w.sms_opt_out ? ' · opted out' : ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="rounded-md border px-3 py-2 text-sm">
              To:{' '}
              <span className="font-medium">
                {presetWorker
                  ? `${presetWorker.first_name} ${presetWorker.last_name}`
                  : workerName || `Worker #${workerId}`}
              </span>
              {presetWorker?.phone_e164 && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {toDisplay(presetWorker.phone_e164)}
                </span>
              )}
              {presetWorker && !presetWorker.phone_e164 && (
                <p className="mt-1 text-xs text-destructive">
                  No mobile number on file — add one before messaging.
                </p>
              )}
              {presetWorker?.sms_opt_out && (
                <p className="mt-1 text-xs text-destructive">
                  This member has opted out of SMS.
                </p>
              )}
            </div>
          )}

          {effectiveWorkerId != null && (openThreads ?? []).length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">
                This member already has open chats
              </Label>
              <div className="max-h-32 space-y-1 overflow-y-auto">
                {(openThreads ?? []).map((c) => (
                  <div
                    key={c.conversation_id}
                    className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {c.campaign?.name ?? 'Org-wide'}
                      {c.our_number
                        ? ` · via ${c.our_number.label || toDisplay(c.our_number.phone_e164)}`
                        : ''}
                    </span>
                    <Badge
                      variant="secondary"
                      className={`text-[10px] ${CONVERSATION_STATE_COLORS[c.state] || ''}`}
                    >
                      {c.state.replace('_', ' ')}
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => {
                        reset()
                        onOpenChange(false)
                        onCreated(c.conversation_id, true)
                      }}
                    >
                      Open existing chat
                    </Button>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Prefer an existing thread — a second thread on another number
                or scope makes the member&apos;s replies land unpredictably.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Sender number</Label>
            <Select
              value={effectiveSender != null ? String(effectiveSender) : ''}
              onValueChange={(v) => setSenderNumberId(v ? Number(v) : null)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a number…" />
              </SelectTrigger>
              <SelectContent>
                {chatSenders.map((s) => (
                  <SelectItem key={s.number_id} value={String(s.number_id)}>
                    {toDisplay(s.phone_e164)}
                    {s.organiser_name ? ` — ${s.organiser_name}` : s.label ? ` — ${s.label}` : ''}
                    {s.is_mine ? ' (you)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {campaignId != null && (activities ?? []).length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Attach to activity (optional)</Label>
              <Select value={activityId} onValueChange={setActivityId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ACTIVITY}>No activity</SelectItem>
                  {(activities ?? []).map((a) => (
                    <SelectItem key={a.activity_id} value={String(a.activity_id)}>
                      {a.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            disabled={
              effectiveWorkerId == null ||
              start.isPending ||
              (presetWorker != null &&
                (!presetWorker.phone_e164 || presetWorker.sms_opt_out))
            }
            onClick={submit}
          >
            {start.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <MessageSquarePlus className="mr-1.5 h-4 w-4" />
            )}
            {(openThreads ?? []).length > 0 ? 'Start new chat anyway' : 'Start chat'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
