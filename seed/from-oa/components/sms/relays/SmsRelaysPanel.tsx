'use client'

/**
 * Relays tab (brief §6, Phase 6): relay-with-attribution manager.
 *
 * List of relay cards → create wizard (spare-number picker,
 * targets, prefix/suffix templates with a live preview rendered via
 * SAMPLE_DATA, moderation + quiet-hours toggles) → detail sheet
 * (activate/pause/resume/end, per-target activity + toggle,
 * moderation queue with approve/reject, message log with direction
 * badges). A relay is created PAUSED and starts forwarding only on
 * explicit activation; ending it releases the number back to the
 * spare pool.
 */
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  ArrowRightLeft,
  Check,
  Loader2,
  Pause,
  Play,
  Plus,
  ShieldQuestion,
  Square,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { SAMPLE_DATA } from '@/lib/comms/template-variables'
import { composeForwardBody } from '@/lib/sms/relay-engine'
import { toDisplay } from '@/lib/phone/normalise-phone'
import { useSmsSenders } from '@/lib/hooks/useSmsBroadcast'
import {
  useAddSmsRelayTarget,
  useCreateSmsRelay,
  useModerateSmsRelayMessage,
  useSmsRelayAction,
  useSmsRelayDetail,
  useSmsRelays,
  useUpdateSmsRelayTarget,
  type SmsRelayDetail,
  type SmsRelayListRow,
} from '@/lib/hooks/useSmsRelays'
import type { SmsRelayForwardStatus } from '@/types/sms'

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  paused: 'bg-amber-100 text-amber-700',
  ended: 'bg-slate-100 text-slate-500',
}

const FORWARD_STATUS_COLORS: Record<SmsRelayForwardStatus, string> = {
  queued: 'bg-indigo-100 text-indigo-700',
  sending: 'bg-blue-100 text-blue-700',
  sent: 'bg-blue-100 text-blue-700',
  delivered: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  held: 'bg-amber-100 text-amber-800',
  rejected: 'bg-slate-100 text-slate-500',
}

const TIMEZONES = [
  { value: 'Australia/Perth', label: 'Perth (AWST)' },
  { value: 'Australia/Darwin', label: 'Darwin (ACST)' },
  { value: 'Australia/Adelaide', label: 'Adelaide' },
  { value: 'Australia/Brisbane', label: 'Brisbane (AEST)' },
  { value: 'Australia/Sydney', label: 'Sydney / Melbourne' },
]

const SAMPLE_MEMBER_MESSAGE =
  'Please support the crews on the KM8 — we deserve a fair agreement.'

const MERGE_FIELDS = ['first_name', 'last_name', 'employer_name'] as const

interface SmsRelaysPanelProps {
  campaignId?: string | number | null
}

export function SmsRelaysPanel({ campaignId }: SmsRelaysPanelProps) {
  const { data: relays, isLoading } = useSmsRelays(campaignId ?? undefined)
  const [newOpen, setNewOpen] = useState(false)
  const [detailRelayId, setDetailRelayId] = useState<number | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">SMS relays</h3>
          <p className="text-sm text-muted-foreground">
            Members text a dedicated number; messages forward to external
            targets with attribution, and replies bridge back — neither side
            ever sees the other&apos;s number.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          New relay
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : relays && relays.length > 0 ? (
        <div className="space-y-2">
          {relays.map((relay) => (
            <RelayCard
              key={relay.relay_id}
              relay={relay}
              onOpen={() => setDetailRelayId(relay.relay_id)}
            />
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="p-4 text-center">
            <ArrowRightLeft className="h-7 w-7 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground mb-3">
              No relays yet. Set one up to patch members through to an MP,
              employer contact or external ally — without exposing anyone&apos;s
              number.
            </p>
            <Button variant="outline" size="sm" onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              New relay
            </Button>
          </CardContent>
        </Card>
      )}

      <NewRelaySheet
        campaignId={campaignId}
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(relayId) => {
          setNewOpen(false)
          setDetailRelayId(relayId)
        }}
      />

      <RelayDetailSheet
        relayId={detailRelayId}
        onOpenChange={(open) => {
          if (!open) setDetailRelayId(null)
        }}
      />
    </div>
  )
}

function RelayCard({
  relay,
  onOpen,
}: {
  relay: SmsRelayListRow
  onOpen: () => void
}) {
  return (
    <Card className="hover:bg-muted/30 transition-colors">
      <CardContent className="p-3">
        <button type="button" className="w-full text-left" onClick={onOpen}>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-medium truncate">{relay.name}</p>
            <Badge className={STATUS_COLORS[relay.status] || ''} variant="secondary">
              {relay.status}
            </Badge>
            {relay.campaign_id == null && (
              <Badge variant="secondary">org-wide</Badge>
            )}
            {relay.moderation_required && (
              <Badge variant="secondary" className="bg-purple-100 text-purple-700">
                moderated
              </Badge>
            )}
            {relay.pending_moderation_count > 0 && (
              <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                {relay.pending_moderation_count} awaiting review
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>
              {relay.number ? toDisplay(relay.number.phone_e164) : 'no number'}
            </span>
            <span>
              {relay.active_target_count}/{relay.target_count} target
              {relay.target_count === 1 ? '' : 's'} active
            </span>
            {relay.quiet_hours_respected && <span>9am–8pm window</span>}
          </div>
        </button>
      </CardContent>
    </Card>
  )
}

interface DraftTarget {
  phone: string
  display_name: string
}

function TemplatePreview({
  prefix,
  suffix,
}: {
  prefix: string
  suffix: string
}) {
  const preview = useMemo(
    () =>
      composeForwardBody({
        prefixTemplate: prefix || null,
        suffixTemplate: suffix || null,
        memberBody: SAMPLE_MEMBER_MESSAGE,
        context: {
          first_name: SAMPLE_DATA.first_name,
          last_name: SAMPLE_DATA.last_name,
          employer_name: SAMPLE_DATA.employer_name,
        },
      }),
    [prefix, suffix],
  )
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground mb-1">
        Preview (what the target receives):
      </p>
      <p className="text-sm whitespace-pre-wrap">{preview}</p>
    </div>
  )
}

function NewRelaySheet({
  campaignId,
  open,
  onOpenChange,
  onCreated,
}: {
  campaignId?: string | number | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (relayId: number) => void
}) {
  const create = useCreateSmsRelay()
  const { data: senders, isLoading: sendersLoading } = useSmsSenders()
  const [name, setName] = useState('')
  const [numberId, setNumberId] = useState<number | null>(null)
  const [orgWide, setOrgWide] = useState(campaignId == null)
  const [targets, setTargets] = useState<DraftTarget[]>([
    { phone: '', display_name: '' },
  ])
  const [prefix, setPrefix] = useState(
    'Message from {{first_name}} {{last_name}} ({{employer_name}}), via Offshore Alliance:',
  )
  const [suffix, setSuffix] = useState('')
  const [moderation, setModeration] = useState(false)
  const [quietHours, setQuietHours] = useState(true)
  const [timezone, setTimezone] = useState('Australia/Perth')

  // Relays draw numbers from the spare pool (§7.0).
  const spareNumbers = useMemo(
    () => (senders ?? []).filter((s) => s.purpose === 'spare'),
    [senders],
  )

  const submit = () => {
    if (!name.trim()) {
      toast.error('Give the relay a name')
      return
    }
    if (numberId == null) {
      toast.error('Pick a spare number for the relay')
      return
    }
    const cleanTargets = targets
      .filter((t) => t.phone.trim())
      .map((t) => ({
        phone_e164: t.phone.trim(),
        display_name: t.display_name.trim() || null,
      }))
    create.mutate(
      {
        name: name.trim(),
        campaign_id: orgWide || campaignId == null ? null : Number(campaignId),
        number_id: numberId,
        prefix_template: prefix.trim() || null,
        suffix_template: suffix.trim() || null,
        moderation_required: moderation,
        quiet_hours_respected: quietHours,
        timezone,
        targets: cleanTargets,
      },
      {
        onSuccess: (res) => {
          toast.success('Relay created (paused) — activate it when ready')
          setName('')
          setNumberId(null)
          setTargets([{ phone: '', display_name: '' }])
          onCreated(res.relay_id)
        },
        onError: (err: Error) => toast.error(err.message),
      },
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>New SMS relay</SheetTitle>
          <SheetDescription>
            Members text the relay number; messages forward to the targets with
            the prefix/suffix below. The relay starts PAUSED — activate it from
            its card when ready.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4 pb-8">
          <div className="space-y-1.5">
            <Label htmlFor="relay-name">Name</Label>
            <Input
              id="relay-name"
              placeholder="e.g. Message the member for Fremantle"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Relay number (from the spare pool)</Label>
            <Select
              disabled={sendersLoading}
              value={numberId != null ? String(numberId) : ''}
              onValueChange={(v) => setNumberId(v ? Number(v) : null)}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={sendersLoading ? 'Loading…' : 'Choose a spare number…'}
                />
              </SelectTrigger>
              <SelectContent>
                {spareNumbers.map((s) => (
                  <SelectItem key={s.number_id} value={String(s.number_id)}>
                    {toDisplay(s.phone_e164)}
                    {s.label ? ` — ${s.label}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!sendersLoading && spareNumbers.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No spare numbers available — add or free up a dedicated number
                in Administration → SMS (each active relay claims one).
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Targets (external mobiles — never shown to members)</Label>
            {targets.map((t, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  placeholder="04xx xxx xxx"
                  value={t.phone}
                  onChange={(e) =>
                    setTargets((prev) =>
                      prev.map((p, j) => (j === i ? { ...p, phone: e.target.value } : p)),
                    )
                  }
                />
                <Input
                  placeholder="Label, e.g. MP's office"
                  value={t.display_name}
                  onChange={(e) =>
                    setTargets((prev) =>
                      prev.map((p, j) =>
                        j === i ? { ...p, display_name: e.target.value } : p,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={targets.length === 1}
                  onClick={() =>
                    setTargets((prev) => prev.filter((_, j) => j !== i))
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setTargets((prev) => [...prev, { phone: '', display_name: '' }])
              }
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add target
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="relay-prefix">Prefix (before the member&apos;s message)</Label>
            <Textarea
              id="relay-prefix"
              rows={2}
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
            />
            <div className="flex flex-wrap gap-1">
              {MERGE_FIELDS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className="rounded-full border bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/70"
                  onClick={() => setPrefix((p) => `${p}{{${f}}}`)}
                >
                  {f.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="relay-suffix">Suffix (after the member&apos;s message)</Label>
            <Textarea
              id="relay-suffix"
              rows={2}
              placeholder="Optional, e.g. Reply to this number to respond."
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
            />
          </div>

          <TemplatePreview prefix={prefix} suffix={suffix} />

          <div className="rounded-md border p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="relay-moderation">Moderation queue</Label>
                <p className="text-xs text-muted-foreground">
                  Hold every member message for staff approval before it
                  forwards.
                </p>
              </div>
              <Switch
                id="relay-moderation"
                checked={moderation}
                onCheckedChange={setModeration}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="relay-quiet">Respect quiet hours (9am–8pm)</Label>
                <p className="text-xs text-muted-foreground">
                  Member messages arriving outside the window queue and forward
                  when it opens.
                </p>
              </div>
              <Switch
                id="relay-quiet"
                checked={quietHours}
                onCheckedChange={setQuietHours}
              />
            </div>
            {quietHours && (
              <div className="space-y-1.5">
                <Label>Quiet-hours timezone</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz.value} value={tz.value}>
                        {tz.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {campaignId != null && (
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="relay-orgwide">Org-wide relay</Label>
                <p className="text-xs text-muted-foreground">
                  Not tied to this campaign (visible on every campaign&apos;s
                  Relays tab).
                </p>
              </div>
              <Switch
                id="relay-orgwide"
                checked={orgWide}
                onCheckedChange={setOrgWide}
              />
            </div>
            )}
          </div>

          <Button
            className="w-full"
            disabled={create.isPending || !name.trim() || numberId == null}
            onClick={submit}
          >
            {create.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Create relay (paused)
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function RelayDetailSheet({
  relayId,
  onOpenChange,
}: {
  relayId: number | null
  onOpenChange: (open: boolean) => void
}) {
  const { data: detail, isLoading } = useSmsRelayDetail(relayId)

  return (
    <Sheet open={relayId != null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {isLoading || !detail ? (
          <>
            {/* RelayDetail names the sheet; while it is in flight the
                sheet would otherwise be unnamed. */}
            <SheetHeader className="sr-only">
              <SheetTitle>SMS relay</SheetTitle>
              <SheetDescription>Loading relay details.</SheetDescription>
            </SheetHeader>
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          </>
        ) : (
          <RelayDetail detail={detail} />
        )}
      </SheetContent>
    </Sheet>
  )
}

function RelayDetail({ detail }: { detail: SmsRelayDetail }) {
  const { relay, number, targets, messages, pending } = detail
  const action = useSmsRelayAction(relay.relay_id)
  const moderate = useModerateSmsRelayMessage(relay.relay_id)
  const addTarget = useAddSmsRelayTarget(relay.relay_id)
  const updateTarget = useUpdateSmsRelayTarget(relay.relay_id)
  const [newTargetPhone, setNewTargetPhone] = useState('')
  const [newTargetName, setNewTargetName] = useState('')

  const forwardsByTarget = useMemo(() => {
    const counts = new Map<number, number>()
    for (const m of messages) {
      if (m.target_id != null && m.direction === 'target_to_member') {
        counts.set(m.target_id, (counts.get(m.target_id) ?? 0) + 1)
      }
    }
    return counts
  }, [messages])

  const runAction = (a: 'activate' | 'pause' | 'end') => {
    if (a === 'end' && !window.confirm('End this relay and release its number back to the spare pool? This cannot be undone.')) {
      return
    }
    action.mutate(a, {
      onSuccess: (res) => {
        if (a === 'end' && res.number_released === false) {
          toast.warning(
            'Relay ended, but the number could not be returned to the spare pool (admin required)',
          )
        } else {
          toast.success(`Relay ${a === 'end' ? 'ended' : `${a}d`}`)
        }
      },
      onError: (err: Error) => toast.error(err.message),
    })
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          {relay.name}
          <Badge className={STATUS_COLORS[relay.status] || ''} variant="secondary">
            {relay.status}
          </Badge>
        </SheetTitle>
        <SheetDescription>
          {number ? `Relay number ${toDisplay(number.phone_e164)}` : 'No number'}
          {relay.quiet_hours_respected && ' — forwards 9am–8pm'}
          {relay.moderation_required && ' — moderated'}
        </SheetDescription>
      </SheetHeader>
      <div className="mt-4 space-y-5 pb-8">
        {/* Lifecycle controls */}
        {relay.status !== 'ended' && (
          <div className="flex gap-2">
            {relay.status === 'paused' && (
              <Button
                size="sm"
                disabled={action.isPending}
                onClick={() => runAction('activate')}
              >
                <Play className="h-3.5 w-3.5 mr-1" />
                {messages.length > 0 ? 'Resume' : 'Activate'}
              </Button>
            )}
            {relay.status === 'active' && (
              <Button
                size="sm"
                variant="outline"
                disabled={action.isPending}
                onClick={() => runAction('pause')}
              >
                <Pause className="h-3.5 w-3.5 mr-1" />
                Pause
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              disabled={action.isPending}
              onClick={() => runAction('end')}
            >
              <Square className="h-3.5 w-3.5 mr-1" />
              End relay
            </Button>
          </div>
        )}

        {/* Moderation queue */}
        {pending.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-1.5">
              <ShieldQuestion className="h-4 w-4" />
              Awaiting review ({pending.length})
            </h4>
            <div className="rounded-md border divide-y">
              {pending.map((m) => (
                <div key={m.relay_message_id} className="p-3 space-y-2">
                  <p className="text-sm whitespace-pre-wrap">{m.body}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.member_phone_e164 ? toDisplay(m.member_phone_e164) : 'unknown'}
                    {' · '}
                    {new Date(m.created_at).toLocaleString()}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={moderate.isPending}
                      onClick={() =>
                        moderate.mutate(
                          {
                            relay_message_id: m.relay_message_id,
                            action: 'approve',
                          },
                          {
                            onSuccess: (res) =>
                              toast.success(
                                res.forwarded
                                  ? 'Approved and forwarded'
                                  : 'Approved — will forward when the window opens',
                              ),
                            onError: (err: Error) => toast.error(err.message),
                          },
                        )
                      }
                    >
                      <Check className="h-3.5 w-3.5 mr-1" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={moderate.isPending}
                      onClick={() =>
                        moderate.mutate(
                          {
                            relay_message_id: m.relay_message_id,
                            action: 'reject',
                          },
                          {
                            onSuccess: () => toast.success('Rejected'),
                            onError: (err: Error) => toast.error(err.message),
                          },
                        )
                      }
                    >
                      <X className="h-3.5 w-3.5 mr-1" />
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Targets */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Targets</h4>
          <div className="rounded-md border divide-y">
            {targets.map((t) => (
              <div key={t.target_id} className="flex items-center gap-2 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {t.display_name || toDisplay(t.phone_e164)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {toDisplay(t.phone_e164)}
                    {' · '}
                    {forwardsByTarget.get(t.target_id) ?? 0} repl
                    {(forwardsByTarget.get(t.target_id) ?? 0) === 1 ? 'y' : 'ies'}
                  </p>
                </div>
                {!t.is_active && (
                  <Badge variant="secondary" className="bg-slate-100 text-slate-500">
                    inactive
                  </Badge>
                )}
                {relay.status !== 'ended' && (
                  <Switch
                    checked={t.is_active}
                    disabled={updateTarget.isPending}
                    onCheckedChange={(checked) =>
                      updateTarget.mutate(
                        { target_id: t.target_id, is_active: checked },
                        { onError: (err: Error) => toast.error(err.message) },
                      )
                    }
                  />
                )}
              </div>
            ))}
            {targets.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">No targets yet.</p>
            )}
          </div>
          {relay.status !== 'ended' && (
            <div className="flex gap-2">
              <Input
                placeholder="04xx xxx xxx"
                value={newTargetPhone}
                onChange={(e) => setNewTargetPhone(e.target.value)}
              />
              <Input
                placeholder="Label (optional)"
                value={newTargetName}
                onChange={(e) => setNewTargetName(e.target.value)}
              />
              <Button
                variant="outline"
                disabled={addTarget.isPending || !newTargetPhone.trim()}
                onClick={() =>
                  addTarget.mutate(
                    {
                      phone_e164: newTargetPhone.trim(),
                      display_name: newTargetName.trim() || null,
                    },
                    {
                      onSuccess: () => {
                        setNewTargetPhone('')
                        setNewTargetName('')
                        toast.success('Target added')
                      },
                      onError: (err: Error) => toast.error(err.message),
                    },
                  )
                }
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>

        {/* Message log */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Message log</h4>
          <p className="text-xs text-muted-foreground">
            Replies from targets are routed to the most recently forwarded
            member.
          </p>
          <div className="rounded-md border divide-y max-h-96 overflow-y-auto">
            {messages.map((m) => (
              <div key={m.relay_message_id} className="p-3 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant="secondary"
                    className={
                      m.direction === 'member_to_target'
                        ? 'bg-sky-100 text-sky-700'
                        : 'bg-violet-100 text-violet-700'
                    }
                  >
                    {m.direction === 'member_to_target'
                      ? 'member → target'
                      : 'target → member'}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className={FORWARD_STATUS_COLORS[m.forward_status] || ''}
                  >
                    {m.forward_status}
                  </Badge>
                  {m.moderation_status === 'pending' && (
                    <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                      awaiting review
                    </Badge>
                  )}
                  {m.moderation_status === 'rejected' && (
                    <Badge variant="secondary" className="bg-red-100 text-red-700">
                      rejected
                    </Badge>
                  )}
                </div>
                <p className="text-sm whitespace-pre-wrap">{m.body}</p>
                <p className="text-xs text-muted-foreground">
                  {m.member_name ||
                    (m.member_phone_e164
                      ? toDisplay(m.member_phone_e164)
                      : 'unknown member')}
                  {' · '}
                  {new Date(m.created_at).toLocaleString()}
                </p>
              </div>
            ))}
            {messages.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">
                No traffic yet. Invite members to text{' '}
                {number ? toDisplay(number.phone_e164) : 'the relay number'} —
                e.g. via a blast with a tap-to-text link.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
