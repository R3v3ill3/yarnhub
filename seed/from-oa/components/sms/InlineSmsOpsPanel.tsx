'use client'

/**
 * Outreach → SMS sub-tab panel (4th sibling of Comms / Phone Ops / SOC,
 * modelled on InlinePhoneOpsPanel). Two views (Phase 2):
 *
 *   Blasts — overview cards + blast table from vw_sms_campaign_summary,
 *   a "New SMS blast" sheet (audience + composer), and a per-list
 *   detail sheet: draft lists open the composer with Save / Queue;
 *   queued+ lists show the funnel and per-recipient statuses with
 *   failure reasons, plus pause / resume / cancel.
 *
 *   Inbox — the 2-way conversation inbox (SmsInboxPanel, three-pane on
 *   desktop, scoped to this campaign by default).
 *
 *   Surveys — reply-native SMS surveys (Phase 4, SmsSurveysPanel):
 *   builder, open/close with audience selection, funnel report.
 *
 *   Relays — relay-with-attribution "patch-through" (Phase 6,
 *   SmsRelaysPanel): dedicated number ↔ external targets, moderation
 *   queue, pause/end, message log.
 *
 *   Chats — P2P chat boards (SmsP2pPanel): a working list the
 *   organiser messages progressively, a handful at a time. P2P lists
 *   (mode='p2p') are excluded from the Blasts view and totals.
 *
 * Arriving with ?sms_list=<id> (the fire/sms redirect) auto-opens that
 * list's sheet in the Blasts view; ?conversation=<id> auto-opens that
 * thread in the Inbox view.
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api/fetch-api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
// Select components removed — audience selection now uses AudiencePicker
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ArrowRightLeft,
  ClipboardList,
  Download,
  Inbox,
  ListPlus,
  Loader2,
  MessageSquare,
  MessagesSquare,
  Pause,
  Play,
  Plus,
  Send,
  XCircle,
} from 'lucide-react'
import { SmsInboxPanel } from '@/components/sms/inbox/SmsInboxPanel'
import { SmsSurveysPanel } from '@/components/sms/surveys/SmsSurveysPanel'
import { SmsRelaysPanel } from '@/components/sms/relays/SmsRelaysPanel'
import { SmsP2pPanel } from '@/components/sms/p2p/SmsP2pPanel'
import { toast } from 'sonner'
import {
  useAttachSmsAudience,
  useCreateSmsBlast,
  useSmsListAction,
  useSmsListDetail,
  useSmsLists,
  useSmsSenders,
  useUpdateSmsBlast,
  type SmsListDetail,
} from '@/lib/hooks/useSmsBroadcast'
import {
  SmsComposer,
  smsComposerBlockers,
  type SmsComposerValue,
} from '@/components/sms/SmsComposer'
import { SmsOrgNameWarningDialog } from '@/components/sms/SmsOrgNameWarningDialog'
import { validateSmsBody } from '@/lib/sms/compliance'
import type {
  VwSmsCampaignRollupRow,
  VwSmsCampaignSummaryRow,
  VwSmsSenderStatsRow,
} from '@/types/sms'
import { toDisplay } from '@/lib/phone/normalise-phone'
import { AudiencePicker, type AudienceValue } from '@/components/audience/AudiencePicker'
import { toApiAudience, EMPTY_COMPOSED_AUDIENCE, STANDALONE_AUDIENCE_PICKER } from '@/lib/sms/audience-helpers'
import {
  useCreateSmsEpisode,
  useDeleteSmsEpisode,
  useRenameSmsEpisode,
  useSmsEpisodes,
} from '@/lib/hooks/useSmsEpisodes'

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  queued: 'bg-indigo-100 text-indigo-700',
  sending: 'bg-blue-100 text-blue-700',
  sent: 'bg-green-100 text-green-700',
  paused: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-slate-100 text-slate-500',
}

const ITEM_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700',
  queued: 'bg-indigo-100 text-indigo-700',
  sending: 'bg-blue-100 text-blue-700',
  sent: 'bg-blue-100 text-blue-700',
  delivered: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-slate-100 text-slate-500',
  opted_out: 'bg-amber-100 text-amber-800',
  blocked: 'bg-amber-100 text-amber-800',
}

const EMPTY_COMPOSER: SmsComposerValue = {
  body: '',
  sender_number_id: null,
  timezone: 'Australia/Perth',
  blackout_override: false,
  blackout_override_reason: '',
  scheduled_for: null,
}

/** datetime-local string → ISO (browser-local interpretation). */
function localToIso(local: string | null): string | null {
  if (!local) return null
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** ISO → datetime-local string for editing. */
function isoToLocal(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}

interface InlineSmsOpsPanelProps {
  campaignId?: string | number | null
  /** Hidden per-episode campaigns; assessments and whole-campaign audience off. */
  standaloneMode?: boolean
}

export function InlineSmsOpsPanel({
  campaignId,
  standaloneMode = false,
}: InlineSmsOpsPanelProps) {
  const id =
    campaignId != null && String(campaignId) !== ''
      ? String(campaignId)
      : null
  const searchParams = useSearchParams()
  const { data: lists, isLoading: listsLoading } = useSmsLists(
    standaloneMode ? null : id,
  )
  const { data: episodes, isLoading: episodesLoading } = useSmsEpisodes(
    standaloneMode,
  )
  const createEpisode = useCreateSmsEpisode()
  const deleteEpisode = useDeleteSmsEpisode()
  const renameEpisode = useRenameSmsEpisode()
  const [newOpen, setNewOpen] = useState(false)
  const [sheetCampaignId, setSheetCampaignId] = useState<string | null>(null)
  const [sheetSaved, setSheetSaved] = useState(false)
  const [detail, setDetail] = useState<{
    campaignId: string
    listId: number
  } | null>(null)

  // fire/sms redirect lands with ?sms_list=<id>; the header/no-cohort
  // Blast pathway lands with ?new_blast=1 (chain B).
  useEffect(() => {
    const raw = searchParams?.get('sms_list')
    const lid = raw ? parseInt(raw, 10) : NaN
    if (Number.isFinite(lid) && id) {
      setDetail({ campaignId: id, listId: lid })
    }
    if (searchParams?.get('new_blast') === '1' && !standaloneMode) {
      setNewOpen(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ?conversation=<id> deep-link → auto-open the thread in the Inbox
  // (mirrors the ?sms_list= idiom; read once, not reactive).
  const [initialConversationId] = useState<number | null>(() => {
    const raw = searchParams?.get('conversation')
    const cid = raw ? parseInt(raw, 10) : NaN
    return Number.isFinite(cid) ? cid : null
  })

  const SMS_VIEWS = ['blasts', 'inbox', 'surveys', 'relays', 'chats'] as const
  const smsView = searchParams?.get('sms_view')
  const defaultTab = SMS_VIEWS.includes(smsView as (typeof SMS_VIEWS)[number])
    ? (smsView as (typeof SMS_VIEWS)[number])
    : initialConversationId != null
      ? 'inbox'
      : 'blasts'

  // P2P chat boards live in the Chats view — keep them out of the
  // blast overview and totals.
  const blastLists = useMemo(() => {
    if (standaloneMode) {
      return (episodes ?? []).flatMap((e) =>
        (e.lists ?? []).filter((l) => (l.mode ?? 'blast') !== 'p2p'),
      )
    }
    return (lists ?? []).filter((l) => (l.mode ?? 'blast') !== 'p2p')
  }, [standaloneMode, episodes, lists])

  const isLoading = standaloneMode ? episodesLoading : listsLoading
  const canSend = standaloneMode || !!id

  const startNewBlast = async () => {
    if (!standaloneMode) {
      setSheetCampaignId(id)
      setNewOpen(true)
      return
    }
    try {
      const ep = await createEpisode.mutateAsync({ kind: 'blast' })
      setSheetCampaignId(String(ep.campaign_id))
      setSheetSaved(false)
      setNewOpen(true)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not start standalone blast',
      )
    }
  }

  const closeNewBlast = (open: boolean) => {
    setNewOpen(open)
    if (open) return
    const cid = sheetCampaignId
    if (standaloneMode && cid && !sheetSaved) {
      deleteEpisode.mutate(cid)
    }
    setSheetCampaignId(null)
    setSheetSaved(false)
  }

  const totals = useMemo(() => {
    const rows = blastLists
    const sum = (fn: (r: VwSmsCampaignSummaryRow) => number) =>
      rows.reduce((acc, r) => acc + fn(r), 0)
    return {
      blasts: rows.length,
      recipients: sum((r) => Number(r.item_count)),
      sent: sum((r) => Number(r.sent_count) + Number(r.delivered_count) + Number(r.failed_count)),
      delivered: sum((r) => Number(r.delivered_count)),
      failed: sum((r) => Number(r.failed_count)),
      optedOut: sum((r) => Number(r.opted_out_count) + Number(r.blocked_count)),
    }
  }, [blastLists])

  return (
    <Tabs defaultValue={defaultTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="blasts">
          <Send className="h-3.5 w-3.5 mr-1.5" />
          Blasts
        </TabsTrigger>
        <TabsTrigger value="inbox">
          <Inbox className="h-3.5 w-3.5 mr-1.5" />
          Inbox
        </TabsTrigger>
        <TabsTrigger value="surveys">
          <ClipboardList className="h-3.5 w-3.5 mr-1.5" />
          Surveys
        </TabsTrigger>
        <TabsTrigger value="chats">
          <MessagesSquare className="h-3.5 w-3.5 mr-1.5" />
          Chats
        </TabsTrigger>
        <TabsTrigger value="relays">
          <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />
          Relays
        </TabsTrigger>
      </TabsList>

      <TabsContent value="inbox">
        <SmsInboxPanel
          campaignId={id ?? undefined}
          initialConversationId={initialConversationId}
        />
      </TabsContent>

      <TabsContent value="surveys">
        {canSend ? (
          <SmsSurveysPanel campaignId={id} standaloneMode={standaloneMode} />
        ) : (
          <CampaignRequiredEmpty
            title="Surveys need a campaign"
            description="Pick a campaign above, or choose Standalone — not part of a campaign."
          />
        )}
      </TabsContent>

      <TabsContent value="chats">
        {canSend ? (
          <SmsP2pPanel campaignId={id} standaloneMode={standaloneMode} />
        ) : (
          <CampaignRequiredEmpty
            title="Chat boards need a campaign"
            description="Pick a campaign above, or choose Standalone — not part of a campaign."
          />
        )}
      </TabsContent>

      <TabsContent value="relays">
        <SmsRelaysPanel campaignId={id} />
      </TabsContent>

      <TabsContent value="blasts" className="space-y-6">
      {canSend ? (
        <>
      {/* Primary CTA */}
      <div className="flex items-center justify-between gap-3">
        <Button size="lg" onClick={() => void startNewBlast()}>
          <MessageSquare className="h-5 w-5 mr-2" />
          New SMS blast
        </Button>
      </div>

      <div>
        <h3 className="font-semibold">SMS Broadcasts</h3>
        <p className="text-sm text-muted-foreground">
          {standaloneMode
            ? 'Each standalone blast is its own hidden campaign. Replies land in Inbox, scoped to that send.'
            : 'Bulk SMS to campaign cohorts with delivery tracking. Replies land in the Inbox tab.'}
        </p>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Blasts" value={totals.blasts} />
        <StatCard label="Recipients" value={totals.recipients} />
        <StatCard label="Sent" value={totals.sent} />
        <StatCard label="Delivered" value={totals.delivered} />
        <StatCard label="Failed" value={totals.failed} />
        <StatCard label="Opt-outs" value={totals.optedOut} />
      </div>

      {/* Phase 7 reporting: campaign rollup + per-sender stats. */}
      {id && !standaloneMode && <SmsReportingSection campaignId={id} />}

      {/* Blast table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : blastLists.length > 0 ? (
        <div className="space-y-2">
          {blastLists.map((list) => (
            <BlastCard
              key={list.list_id}
              campaignId={String(list.campaign_id)}
              list={list}
              onOpen={() =>
                setDetail({
                  campaignId: String(list.campaign_id),
                  listId: list.list_id,
                })
              }
            />
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="p-4 text-center">
            <MessageSquare className="h-7 w-7 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground mb-3">
              {standaloneMode
                ? 'No standalone blasts yet. Start one here — it will not appear on the campaigns list.'
                : 'No SMS blasts yet. Start one here or fire a saved worker list into SMS from the wall chart.'}
            </p>
            <Button variant="outline" size="sm" onClick={() => void startNewBlast()}>
              <Plus className="h-4 w-4 mr-1" />
              New SMS blast
            </Button>
          </CardContent>
        </Card>
      )}

      {sheetCampaignId && (
      <NewBlastSheet
        campaignId={sheetCampaignId}
        standaloneMode={standaloneMode}
        open={newOpen}
        onOpenChange={closeNewBlast}
        onCreated={(listId, name) => {
          setSheetSaved(true)
          setNewOpen(false)
          if (standaloneMode && name.trim()) {
            renameEpisode.mutate({ campaignId: sheetCampaignId, name: name.trim() })
          }
          setDetail({ campaignId: sheetCampaignId, listId })
          setSheetCampaignId(null)
        }}
      />
      )}

      <ListDetailSheet
        campaignId={detail?.campaignId ?? id ?? ''}
        listId={detail?.listId ?? null}
        standaloneMode={standaloneMode}
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
      />
        </>
      ) : (
        <CampaignRequiredEmpty
          title="Blasts need a campaign"
          description="Pick a campaign above, or choose Standalone — not part of a campaign. You can write the message first and attach a list later, or build the list first."
        />
      )}
      </TabsContent>
    </Tabs>
  )
}

function CampaignRequiredEmpty({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="p-6 text-center">
        <MessageSquare className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold">{value}</p>
      </CardContent>
    </Card>
  )
}

/** "3m 20s" from seconds; em-dash when there are no reply pairs yet. */
function formatLatency(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

interface SmsReportingPayload {
  rollup: VwSmsCampaignRollupRow | null
  senders: Array<VwSmsSenderStatsRow & { sender_name: string }>
}

/**
 * Phase 7 (brief §3.1 item 11): campaign rollup cards (delivered as
 * the response-rate denominator) + per-sender reply stats incl.
 * median reply latency — replying inside ~20 min measurably lifts
 * engagement, so slow medians are highlighted.
 */
function SmsReportingSection({ campaignId }: { campaignId: string }) {
  const { data } = useQuery({
    queryKey: ['sms-reporting', campaignId],
    queryFn: async () => {
      const res = await fetchApi(`/api/campaigns/${campaignId}/sms-reporting`)
      if (!res.ok) throw new Error('Failed to fetch SMS reporting')
      return res.json() as Promise<SmsReportingPayload>
    },
  })

  const rollup = data?.rollup
  const senders = data?.senders ?? []
  const hasActivity =
    !!rollup &&
    (rollup.sends_count > 0 ||
      rollup.conversation_count > 0 ||
      rollup.survey_count > 0)
  if (!hasActivity && senders.length === 0) return null

  return (
    <div className="space-y-3">
      {hasActivity && rollup && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatCardText
            label="Delivery rate"
            value={`${rollup.delivery_rate_pct}%`}
            hint={`${rollup.delivered_count}/${rollup.sends_count} dispatched`}
          />
          <StatCardText
            label="Reply rate"
            value={`${rollup.reply_rate_pct}%`}
            hint={`${rollup.conversations_with_reply} threads replied · of delivered`}
          />
          <StatCard label="Inbound replies" value={rollup.inbound_reply_count} />
          <StatCard
            label="Active conversations"
            value={rollup.active_conversation_count}
          />
          <StatCardText
            label="Surveys completed"
            value={String(rollup.surveys_completed_count)}
            hint={`${rollup.survey_count} survey${rollup.survey_count === 1 ? '' : 's'}`}
          />
          <StatCard label="Opt-outs" value={rollup.opt_outs_count} />
        </div>
      )}

      {senders.length > 0 && (
        <div className="rounded-md border">
          <p className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
            Per-sender conversation stats
          </p>
          <div className="divide-y">
            {senders.map((s) => (
              <div
                key={s.sender_user_id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {s.sender_name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {s.replies_sent} sent · {s.conversations} thread
                  {s.conversations === 1 ? '' : 's'}
                </span>
                <span
                  className={`text-xs ${
                    s.median_reply_latency_seconds != null &&
                    s.median_reply_latency_seconds > 20 * 60
                      ? 'text-amber-700'
                      : 'text-muted-foreground'
                  }`}
                  title="Median inbound → reply latency (replying within ~20 minutes lifts engagement)"
                >
                  median reply {formatLatency(s.median_reply_latency_seconds)}
                </span>
                {s.ai_assisted_count > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {s.ai_assisted_count} AI-assisted
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCardText({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold">{value}</p>
        {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

function BlastCard({
  campaignId,
  list,
  onOpen,
}: {
  campaignId: string
  list: VwSmsCampaignSummaryRow
  onOpen: () => void
}) {
  const action = useSmsListAction(campaignId)
  const dispatched =
    Number(list.sent_count) + Number(list.delivered_count) + Number(list.failed_count)
  const total = Number(list.total_items) || 0
  const progressPct = total > 0 ? Math.round((dispatched / total) * 100) : 0

  const runAction = (a: 'queue' | 'pause' | 'resume' | 'cancel') => {
    action.mutate(
      { listId: list.list_id, action: a },
      {
        onSuccess: (res) => {
          if (a === 'queue') {
            toast.success(`Queued ${res.queued ?? ''} messages for dispatch`)
          } else {
            toast.success(`Blast ${a === 'cancel' ? 'cancelled' : `${a}d`}`)
          }
        },
        onError: (err: Error) => toast.error(err.message),
      },
    )
  }

  return (
    <Card className="hover:bg-muted/30 transition-colors">
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <button type="button" className="flex-1 min-w-0 text-left" onClick={onOpen}>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm font-medium truncate">{list.list_name}</p>
              <Badge
                className={STATUS_COLORS[list.list_status] || ''}
                variant="secondary"
              >
                {list.list_status}
              </Badge>
              {list.blackout_override && (
                <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                  window override
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>
                {dispatched}/{total} sent
              </span>
              <span>{Number(list.delivered_count)} delivered</span>
              {Number(list.failed_count) > 0 && (
                <span className="text-red-600">
                  {Number(list.failed_count)} failed
                </span>
              )}
              {Number(list.opted_out_count) + Number(list.blocked_count) > 0 && (
                <span>
                  {Number(list.opted_out_count) + Number(list.blocked_count)} opted
                  out
                </span>
              )}
              {list.scheduled_for && list.list_status === 'queued' && (
                <span>scheduled {new Date(list.scheduled_for).toLocaleString()}</span>
              )}
            </div>
            {total > 0 && list.list_status !== 'draft' && (
              <Progress value={progressPct} className="h-1 mt-2" />
            )}
          </button>
          <div className="flex items-center gap-1">
            {list.list_status === 'draft' && (
              <Button size="sm" onClick={onOpen}>
                <Send className="h-3 w-3 mr-1" />
                Compose
              </Button>
            )}
            {(list.list_status === 'queued' || list.list_status === 'sending') && (
              <Button
                size="sm"
                variant="ghost"
                title="Pause"
                disabled={action.isPending}
                onClick={() => runAction('pause')}
              >
                <Pause className="h-3 w-3" />
              </Button>
            )}
            {list.list_status === 'paused' && (
              <Button
                size="sm"
                variant="ghost"
                title="Resume"
                disabled={action.isPending}
                onClick={() => runAction('resume')}
              >
                <Play className="h-3 w-3" />
              </Button>
            )}
            {['draft', 'queued', 'sending', 'paused'].includes(list.list_status) && (
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                title="Cancel blast"
                disabled={action.isPending}
                onClick={() => runAction('cancel')}
              >
                <XCircle className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function NewBlastSheet({
  campaignId,
  standaloneMode = false,
  open,
  onOpenChange,
  onCreated,
}: {
  campaignId: string
  standaloneMode?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (listId: number, name: string) => void
}) {
  const [name, setName] = useState('')
  const [deferAudience, setDeferAudience] = useState(false)
  const [audienceValue, setAudienceValue] = useState<AudienceValue>(
    standaloneMode ? EMPTY_COMPOSED_AUDIENCE : { mode: 'campaign' },
  )
  const [composer, setComposer] = useState<SmsComposerValue>(EMPTY_COMPOSER)
  const [submitting, setSubmitting] = useState(false)
  const create = useCreateSmsBlast(campaignId)
  const queryClient = useQueryClient()

  const submit = async () => {
    if (!name.trim()) {
      toast.error('Give the blast a name')
      return
    }
    try {
      setSubmitting(true)
      const skipAudience =
        deferAudience ||
        (standaloneMode &&
          audienceValue.mode === 'composed' &&
          audienceValue.worker_ids.length === 0)
      const audience = skipAudience
        ? undefined
        : await toApiAudience(campaignId, audienceValue)
      if (!deferAudience && audienceValue.mode === 'composed') {
        queryClient.invalidateQueries({
          queryKey: ['worker-lists-for-sms', String(campaignId)],
        })
      }
      create.mutate(
        {
          name,
          body: composer.body,
          sender_number_id: composer.sender_number_id ?? undefined,
          timezone: composer.timezone,
          blackout_override: composer.blackout_override,
          blackout_override_reason: composer.blackout_override_reason,
          scheduled_for: localToIso(composer.scheduled_for),
          audience,
        },
        {
          onSuccess: (res) => {
            const notes: string[] = []
            if (res.opted_out > 0) notes.push(`${res.opted_out} opted out`)
            if (res.skipped_no_phone > 0) notes.push(`${res.skipped_no_phone} without a mobile`)
            toast.success(
              res.total_items > 0
                ? `Blast created — ${res.total_items} recipients${
                    notes.length ? ` (${notes.join(', ')} excluded)` : ''
                  }`
                : 'Draft blast created — attach a list when you are ready',
            )
            setName('')
            setDeferAudience(false)
            setAudienceValue(
              standaloneMode ? EMPTY_COMPOSED_AUDIENCE : { mode: 'campaign' },
            )
            setComposer(EMPTY_COMPOSER)
            onCreated(res.sms_list_id, name)
          },
          onError: (err: Error) => toast.error(err.message),
          onSettled: () => setSubmitting(false),
        },
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to prepare audience')
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>New SMS blast</SheetTitle>
          <SheetDescription>
            Write the message now, pick a list now, or both — you can attach
            an audience later from the draft. Opted-out workers and workers
            without a mobile are excluded automatically.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4 pb-8">
          <div className="space-y-1.5">
            <Label htmlFor="sms-blast-name">Name</Label>
            <Input
              id="sms-blast-name"
              placeholder="e.g. EBA meeting reminder"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="flex items-start gap-2 rounded-md border p-3">
            <Checkbox
              id="sms-blast-defer-audience"
              checked={deferAudience}
              onCheckedChange={(v) => setDeferAudience(v === true)}
              disabled={create.isPending || submitting}
            />
            <Label
              htmlFor="sms-blast-defer-audience"
              className="font-normal leading-snug"
            >
              Attach a list later — create the blast first
            </Label>
          </div>

          {!deferAudience && (
            <AudiencePicker
              channel="sms"
              campaignId={campaignId}
              value={audienceValue}
              onChange={setAudienceValue}
              disabled={create.isPending || submitting}
              {...(standaloneMode ? STANDALONE_AUDIENCE_PICKER : {})}
            />
          )}

          <SmsComposer
            campaignId={campaignId}
            value={composer}
            onChange={setComposer}
          />

          <Button
            className="w-full"
            disabled={create.isPending || submitting || !name.trim()}
            onClick={submit}
          >
            {(create.isPending || submitting) ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Create blast
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function ListDetailSheet({
  campaignId,
  listId,
  standaloneMode = false,
  onOpenChange,
}: {
  campaignId: string
  listId: number | null
  standaloneMode?: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data: detail, isLoading } = useSmsListDetail(campaignId, listId)

  return (
    <Sheet open={listId != null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {isLoading || !detail ? (
          <>
            {/* The loaded branches name the sheet; while the detail is
                in flight it would otherwise be unnamed. */}
            <SheetHeader className="sr-only">
              <SheetTitle>SMS blast</SheetTitle>
              <SheetDescription>Loading blast details.</SheetDescription>
            </SheetHeader>
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          </>
        ) : detail.list.status === 'draft' ? (
          <DraftDetail
            campaignId={campaignId}
            detail={detail}
            standaloneMode={standaloneMode}
          />
        ) : (
          <SentDetail campaignId={campaignId} detail={detail} />
        )}
      </SheetContent>
    </Sheet>
  )
}

function DraftDetail({
  campaignId,
  detail,
  standaloneMode = false,
}: {
  campaignId: string
  detail: SmsListDetail
  standaloneMode?: boolean
}) {
  const update = useUpdateSmsBlast(campaignId)
  const action = useSmsListAction(campaignId)
  const attach = useAttachSmsAudience(campaignId)
  const queryClient = useQueryClient()
  const [audienceValue, setAudienceValue] = useState<AudienceValue>(
    standaloneMode ? EMPTY_COMPOSED_AUDIENCE : { mode: 'campaign' },
  )
  const [attaching, setAttaching] = useState(false)
  const [orgWarnOpen, setOrgWarnOpen] = useState(false)
  const [composer, setComposer] = useState<SmsComposerValue>({
    body: detail.draft?.body ?? '',
    sender_number_id: detail.list.sender_number_id,
    timezone: detail.list.timezone || 'Australia/Perth',
    blackout_override: detail.list.blackout_override,
    blackout_override_reason: detail.list.blackout_override_reason ?? '',
    scheduled_for: isoToLocal(detail.list.scheduled_for),
  })

  const { data: senders } = useSmsSenders()
  const blockers = smsComposerBlockers(composer, senders)
  const pendingCount = detail.items.filter((i) => i.status === 'pending').length

  const save = (then?: () => void) => {
    update.mutate(
      {
        listId: detail.list.list_id,
        body: composer.body,
        sender_number_id: composer.sender_number_id,
        timezone: composer.timezone,
        blackout_override: composer.blackout_override,
        blackout_override_reason: composer.blackout_override_reason || null,
        scheduled_for: localToIso(composer.scheduled_for),
      },
      {
        onSuccess: () => then?.(),
        onError: (err: Error) => toast.error(err.message),
      },
    )
  }

  const queue = () => {
    save(() =>
      action.mutate(
        { listId: detail.list.list_id, action: 'queue' },
        {
          onSuccess: (res) =>
            toast.success(`Queued ${res.queued} messages for dispatch`),
          onError: (err: Error) => toast.error(err.message),
        },
      ),
    )
  }

  const requestQueue = () => {
    if (!validateSmsBody(composer.body).hasOrgName) {
      setOrgWarnOpen(true)
      return
    }
    queue()
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{detail.list.name}</SheetTitle>
        <SheetDescription>
          {detail.items.length === 0
            ? 'Draft blast with no audience yet — attach a list before queueing.'
            : `Draft blast — ${pendingCount} sendable recipient${
                pendingCount === 1 ? '' : 's'
              }${
                detail.items.length !== pendingCount
                  ? ` (${detail.items.length - pendingCount} excluded)`
                  : ''
              }.`}
        </SheetDescription>
      </SheetHeader>
      <div className="mt-4 space-y-4 pb-8">
        {detail.items.length === 0 && (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">Attach an audience</p>
            <AudiencePicker
              channel="sms"
              campaignId={campaignId}
              value={audienceValue}
              onChange={setAudienceValue}
              disabled={attaching || attach.isPending}
              {...(standaloneMode ? STANDALONE_AUDIENCE_PICKER : {})}
            />
            <Button
              className="w-full"
              disabled={attaching || attach.isPending}
              onClick={async () => {
                try {
                  setAttaching(true)
                  const audience = await toApiAudience(campaignId, audienceValue)
                  if (audienceValue.mode === 'composed') {
                    queryClient.invalidateQueries({
                      queryKey: ['worker-lists-for-sms', String(campaignId)],
                    })
                  }
                  attach.mutate(
                    { listId: detail.list.list_id, audience },
                    {
                      onSuccess: (res) => {
                        const notes: string[] = []
                        if (res.opted_out > 0) notes.push(`${res.opted_out} opted out`)
                        if (res.skipped_no_phone > 0) {
                          notes.push(`${res.skipped_no_phone} without a mobile`)
                        }
                        toast.success(
                          `Audience attached — ${res.total_items} sendable${
                            notes.length ? ` (${notes.join(', ')} excluded)` : ''
                          }`,
                        )
                      },
                      onError: (err: Error) => toast.error(err.message),
                    },
                  )
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : 'Failed to prepare audience',
                  )
                } finally {
                  setAttaching(false)
                }
              }}
            >
              {(attaching || attach.isPending) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Attach list
            </Button>
          </div>
        )}

        <SmsComposer
          campaignId={campaignId}
          value={composer}
          onChange={setComposer}
          disabled={update.isPending || action.isPending}
        />

        {blockers.length > 0 && (
          <ul className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={update.isPending}
            onClick={() => save(() => toast.success('Draft saved'))}
          >
            {update.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save draft
          </Button>
          <Button
            className="flex-1"
            disabled={
              update.isPending ||
              action.isPending ||
              blockers.length > 0 ||
              pendingCount === 0
            }
            onClick={requestQueue}
          >
            {action.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Queue for sending
          </Button>
        </div>

        <ItemsTable detail={detail} />
      </div>
      <SmsOrgNameWarningDialog
        open={orgWarnOpen}
        onOpenChange={setOrgWarnOpen}
        onConfirm={() => {
          setOrgWarnOpen(false)
          queue()
        }}
        confirmLabel="Queue without it"
      />
    </>
  )
}

function SentDetail({
  campaignId,
  detail,
}: {
  campaignId: string
  detail: SmsListDetail
}) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const it of detail.items) c[it.status] = (c[it.status] ?? 0) + 1
    return c
  }, [detail.items])

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          {detail.list.name}
          <Badge
            className={STATUS_COLORS[detail.list.status] || ''}
            variant="secondary"
          >
            {detail.list.status}
          </Badge>
        </SheetTitle>
        <SheetDescription>
          {detail.items.length} recipients
          {detail.list.blackout_override &&
            ` — send-window override recorded: ${
              detail.list.blackout_override_reason ?? 'no reason given'
            }`}
        </SheetDescription>
      </SheetHeader>
      <div className="mt-4 space-y-4 pb-8">
        {detail.draft?.body && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
            {detail.draft.body}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(counts).map(([status, n]) => (
            <Badge
              key={status}
              variant="secondary"
              className={ITEM_STATUS_COLORS[status] || ''}
            >
              {status.replace('_', ' ')}: {n}
            </Badge>
          ))}
        </div>

        {/* Phase 7: exports + "create list from responders" (§3.1
            item 11) — cohort lists are channel-agnostic drafts. */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button asChild variant="outline" size="sm">
              <a
                href={`/api/campaigns/${campaignId}/sms-lists/${detail.list.list_id}/export`}
                download
              >
                <Download className="h-3 w-3 mr-1" />
                Export CSV
              </a>
            </Button>
          </div>
          <BlastCohortButtons campaignId={campaignId} listId={detail.list.list_id} />
        </div>

        <ItemsTable detail={detail} />
      </div>
    </>
  )
}

const BLAST_COHORT_OPTIONS = [
  { value: 'replied', label: 'Replied' },
  { value: 'delivered_not_replied', label: 'Delivered, no reply' },
  { value: 'failed', label: 'Failed' },
] as const

function BlastCohortButtons({
  campaignId,
  listId,
}: {
  campaignId: string
  listId: number
}) {
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: async (cohort: string) => {
      const res = await fetchApi(
        `/api/campaigns/${campaignId}/sms-lists/${listId}/worker-list`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cohort }),
        },
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create worker list')
      return data as { list_id: number; name: string; items: number }
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['worker-lists-for-sms', campaignId] })
      toast.success(
        `Worker list "${res.name}" created with ${res.items} worker${res.items === 1 ? '' : 's'} — fire it into any channel from the wall chart or a new blast.`,
      )
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Create list from:</span>
      {BLAST_COHORT_OPTIONS.map((o) => (
        <Button
          key={o.value}
          variant="outline"
          size="sm"
          disabled={create.isPending}
          onClick={() => create.mutate(o.value)}
        >
          <ListPlus className="h-3 w-3 mr-1" />
          {o.label}
        </Button>
      ))}
    </div>
  )
}

function ItemsTable({ detail }: { detail: SmsListDetail }) {
  return (
    <div className="rounded-md border divide-y max-h-96 overflow-y-auto">
      {detail.items.map((it) => (
        <div key={it.item_id} className="flex items-center gap-2 px-3 py-2 text-sm">
          <div className="flex-1 min-w-0">
            <p className="truncate font-medium">{it.worker_name}</p>
            <p className="text-xs text-muted-foreground">
              {it.phone_e164 ? toDisplay(it.phone_e164) : 'no mobile'}
              {it.failure_reason && (
                <span className="text-red-600"> — {it.failure_reason}</span>
              )}
            </p>
          </div>
          <Badge
            variant="secondary"
            className={ITEM_STATUS_COLORS[it.status] || ''}
          >
            {it.status.replace('_', ' ')}
          </Badge>
        </div>
      ))}
      {detail.items.length === 0 && (
        <p className="p-3 text-sm text-muted-foreground">No recipients.</p>
      )}
    </div>
  )
}
