'use client'

/**
 * Plain-text SMS composer (brief §7.3 — deliberately NOT TipTap: SMS
 * bodies are plain text with `{{merge_field}}` tokens).
 *
 * Guardrails (brief §3.1 item 9):
 *   - live GSM-7/UCS-2 segment counter with worst-case merge-field
 *     expansion and a UCS-2 warning on emoji/smart quotes,
 *   - org-name ("Offshore Alliance") is a warning, not a hard block —
 *     confirm before queueing when missing (opt-out instruction is
 *     recommended for cold/non-member audiences but optional — STOP
 *     still works provider-side),
 *   - test-send-to-self,
 *   - sender number select defaulting to the signed-in organiser's
 *     assigned number,
 *   - blackout override toggle with a required, recorded reason,
 *   - optional schedule datetime,
 *   - "tap-to-text" link helper (brief §6 complementary pattern):
 *     inserts an sms:+61…?body=… link so contact genuinely
 *     originates from the member's own phone and number — e.g.
 *     inviting members to text a relay number, or an MP directly.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AlertTriangle, CheckCircle2, Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import {
  ALL_TEMPLATE_VARIABLES,
} from '@/lib/comms/template-variables'
import { countSegments, countSegmentsWorstCase } from '@/lib/sms/segments'
import { validateSmsBody } from '@/lib/sms/compliance'
import { useTemplateLibrary } from '@/lib/hooks/useTemplateLibrary'
import {
  useSmsSenders,
  useSmsTestSend,
  type SmsSenderOption,
} from '@/lib/hooks/useSmsBroadcast'
import { toDisplay, toE164 } from '@/lib/phone/normalise-phone'
import {
  filterInboxSafeSenders,
  INBOX_UNSAFE_SENDER_MESSAGE,
  isInboxUnsafePurpose,
} from '@/lib/sms/sender-purpose'
import { inboundUnsafeClientMessage } from '@/lib/sms/sender-inbound'

export interface SmsComposerValue {
  body: string
  sender_number_id: number | null
  timezone: string
  blackout_override: boolean
  blackout_override_reason: string
  scheduled_for: string | null
}

interface SmsComposerProps {
  campaignId: string | number
  value: SmsComposerValue
  onChange: (value: SmsComposerValue) => void
  disabled?: boolean
  /**
   * 'blast' (default) shows timezone / schedule / blackout-override
   * controls for the cron-drained queue. 'p2p' hides them — chat-board
   * initials are sent live per organiser selection (soft blackout
   * warning on the board instead of a queue-time hard block).
   */
  variant?: 'blast' | 'p2p'
}

const TIMEZONES = [
  { value: 'Australia/Perth', label: 'Perth (AWST)' },
  { value: 'Australia/Darwin', label: 'Darwin (ACST)' },
  { value: 'Australia/Adelaide', label: 'Adelaide' },
  { value: 'Australia/Brisbane', label: 'Brisbane (AEST)' },
  { value: 'Australia/Sydney', label: 'Sydney / Melbourne' },
]

function senderLabel(s: SmsSenderOption, opts?: { requireInbound?: boolean }): string {
  const num = toDisplay(s.phone_e164)
  const base = s.organiser_name
    ? `${num} — ${s.organiser_name}`
    : s.label
      ? `${num} — ${s.label}`
      : `${num} (${s.purpose})`
  if (opts?.requireInbound && s.supports_inbound === false) {
    return `${base} (handset — replies go to the phone)`
  }
  return base
}

export function SmsComposer({
  campaignId,
  value,
  onChange,
  disabled,
  variant = 'blast',
}: SmsComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { data: senders, isLoading: sendersLoading } = useSmsSenders()
  const { data: templates } = useTemplateLibrary({ platform: 'sms' })
  const testSend = useSmsTestSend(campaignId)
  const [testNumber, setTestNumber] = useState('')
  const [tapOpen, setTapOpen] = useState(false)
  const [tapNumber, setTapNumber] = useState('')
  const [tapMessage, setTapMessage] = useState('')

  // Blast and chat never use relay/survey-purpose numbers — those
  // webhooks consume replies before conversation routing. The senders
  // route stays generic for surfaces that need those numbers (surveys).
  const inboxSafeSenders = useMemo(
    () => filterInboxSafeSenders(senders ?? []),
    [senders],
  )
  const selectedSender = (senders ?? []).find(
    (s) => s.number_id === value.sender_number_id,
  )
  const senderIsUnsafe = isInboxUnsafePurpose(selectedSender?.purpose)
  const senderInboundError =
    variant === 'p2p' ? inboundUnsafeClientMessage(selectedSender) : null
  const selectableSenders = useMemo(() => {
    if (
      selectedSender &&
      senderIsUnsafe &&
      !inboxSafeSenders.some((s) => s.number_id === selectedSender.number_id)
    ) {
      return [selectedSender, ...inboxSafeSenders]
    }
    return inboxSafeSenders
  }, [inboxSafeSenders, selectedSender, senderIsUnsafe])

  // Default the sender to the signed-in organiser's number once loaded.
  const defaultedRef = useRef(false)
  useEffect(() => {
    if (defaultedRef.current || value.sender_number_id != null || !senders) return
    const mine = selectableSenders.find((s) => {
      if (!s.is_mine) return false
      if (variant === 'p2p' && s.supports_inbound === false) return false
      return true
    })
    if (mine) {
      defaultedRef.current = true
      onChange({ ...value, sender_number_id: mine.number_id })
      return
    }
    if (variant === 'p2p') {
      const dedicated = selectableSenders.find((s) => s.supports_inbound !== false)
      if (dedicated) {
        defaultedRef.current = true
        onChange({ ...value, sender_number_id: dedicated.number_id })
      }
    }
  }, [senders, selectableSenders, value, onChange, variant])

  const literal = useMemo(() => countSegments(value.body), [value.body])
  const worstCase = useMemo(
    () => countSegmentsWorstCase(value.body),
    [value.body],
  )
  const compliance = useMemo(() => validateSmsBody(value.body), [value.body])

  const insertAtCursor = (insert: string) => {
    const el = textareaRef.current
    if (!el) {
      onChange({ ...value, body: value.body + insert })
      return
    }
    const start = el.selectionStart ?? value.body.length
    const end = el.selectionEnd ?? start
    const next = value.body.slice(0, start) + insert + value.body.slice(end)
    onChange({ ...value, body: next })
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + insert.length, start + insert.length)
    })
  }

  const insertToken = (token: string) => insertAtCursor(`{{${token}}}`)

  const insertTapToText = () => {
    const e164 = toE164(tapNumber)
    if (!e164) {
      toast.error('Enter a valid mobile for the tap-to-text link')
      return
    }
    const link = tapMessage.trim()
      ? `sms:${e164}?body=${encodeURIComponent(tapMessage.trim())}`
      : `sms:${e164}`
    insertAtCursor(link)
    setTapOpen(false)
  }

  return (
    <div className="space-y-4">
      {/* Template picker */}
      {templates && templates.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Start from a template</Label>
          <Select
            disabled={disabled}
            onValueChange={(id) => {
              const t = templates.find((x) => String(x.template_id) === id)
              if (t) onChange({ ...value, body: t.body_text })
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose an SMS template…" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.template_id} value={String(t.template_id)}>
                  {t.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Body */}
      <div className="space-y-1.5">
        <Label htmlFor="sms-body">Message</Label>
        <Textarea
          id="sms-body"
          ref={textareaRef}
          value={value.body}
          disabled={disabled}
          rows={6}
          placeholder={
            'Hi {{first_name}}, … — Offshore Alliance. Reply STOP to opt out'
          }
          onChange={(e) => onChange({ ...value, body: e.target.value })}
        />
        <div className="flex flex-wrap gap-1">
          {ALL_TEMPLATE_VARIABLES.map((v) => (
            <button
              key={v.key}
              type="button"
              disabled={disabled}
              title={v.description}
              className="rounded-full border bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/70 disabled:opacity-50"
              onClick={() => insertToken(v.key)}
            >
              {v.label}
            </button>
          ))}
          <button
            type="button"
            disabled={disabled}
            title="Insert a tappable sms: link so members text a number (e.g. a relay or an MP) from their OWN phone — the only way the recipient sees authentic member identity"
            className="rounded-full border border-dashed bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/70 disabled:opacity-50"
            onClick={() => setTapOpen((o) => !o)}
          >
            + Tap-to-text link
          </button>
        </div>
        {tapOpen && (
          <div className="rounded-md border p-3 space-y-2">
            <Label className="text-xs text-muted-foreground">
              Tap-to-text link — opens the member&apos;s SMS app addressed to
              this number, with an optional prefilled message.
            </Label>
            <div className="flex gap-2">
              <Input
                placeholder="04xx xxx xxx (e.g. the relay number)"
                disabled={disabled}
                value={tapNumber}
                onChange={(e) => setTapNumber(e.target.value)}
              />
              <Input
                placeholder="Prefilled message (optional)"
                disabled={disabled}
                value={tapMessage}
                onChange={(e) => setTapMessage(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || !tapNumber.trim()}
                onClick={insertTapToText}
              >
                Insert
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Segment counter */}
      <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            <span className="font-medium">{literal.length}</span> chars
          </span>
          <span>
            Encoding:{' '}
            <Badge
              variant="secondary"
              className={
                literal.encoding === 'UCS-2'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-emerald-100 text-emerald-800'
              }
            >
              {literal.encoding}
            </Badge>
          </span>
          <span>
            <span className="font-medium">{literal.segments}</span>{' '}
            {literal.segments === 1 ? 'part' : 'parts'}
            {worstCase.segments !== literal.segments && (
              <span className="text-muted-foreground">
                {' '}
                (up to {worstCase.segments} after merge fields)
              </span>
            )}
          </span>
          <span className="text-muted-foreground">
            {literal.remaining} left in this part
          </span>
        </div>
        {literal.encoding === 'UCS-2' && (
          <p className="flex items-start gap-1 text-amber-700">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            Emoji or smart punctuation ({literal.nonGsmChars.slice(0, 6).join(' ')})
            drop the per-part limit from 160 to 70 characters — each part costs a
            credit.
          </p>
        )}
      </div>

      {/* Compliance checklist */}
      <div className="space-y-1 text-xs">
        <p
          className={
            compliance.hasOrgName
              ? 'flex items-center gap-1 text-emerald-700'
              : 'flex items-center gap-1 text-amber-700'
          }
        >
          {compliance.hasOrgName ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : (
            <AlertTriangle className="h-3 w-3" />
          )}
          {compliance.hasOrgName
            ? 'Identifies the organisation ("Offshore Alliance")'
            : 'Organisation name optional for known contacts — include "Offshore Alliance" for first-contact or cold outreach'}
        </p>
        <p
          className={
            compliance.hasOptOut
              ? 'flex items-center gap-1 text-emerald-700'
              : 'flex items-center gap-1 text-muted-foreground'
          }
        >
          {compliance.hasOptOut ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : (
            <AlertTriangle className="h-3 w-3" />
          )}
          Opt-out instruction optional (e.g. &quot;Reply STOP to opt out&quot;) —
          useful for non-members; not required for existing members
        </p>
      </div>

      {/* Sender */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Sender number</Label>
          <Select
            disabled={disabled || sendersLoading}
            value={value.sender_number_id != null ? String(value.sender_number_id) : ''}
            onValueChange={(v) =>
              onChange({ ...value, sender_number_id: v ? Number(v) : null })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={sendersLoading ? 'Loading…' : 'Choose a number…'}
              />
            </SelectTrigger>
            <SelectContent>
              {selectableSenders.map((s) => (
                <SelectItem key={s.number_id} value={String(s.number_id)}>
                  {senderLabel(s, { requireInbound: variant === 'p2p' })}
                  {s.is_mine ? ' (you)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {senderIsUnsafe && (
            <p className="flex items-start gap-1 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {INBOX_UNSAFE_SENDER_MESSAGE}
            </p>
          )}
          {senderInboundError && (
            <p className="flex items-start gap-1 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {senderInboundError}
            </p>
          )}
          {variant === 'p2p' && (
            <p className="text-xs text-muted-foreground">
              Chat needs a dedicated Mobile Message number so replies land in
              the board — not an organiser&apos;s personal handset.
            </p>
          )}
          {senders && inboxSafeSenders.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {senders.length === 0
                ? 'No active numbers — add dedicated numbers in Administration → SMS.'
                : 'No organiser numbers available — survey and relay numbers cannot send blasts or chats.'}
            </p>
          )}
        </div>

        {variant !== 'p2p' && (
          <div className="space-y-1.5">
            <Label>Recipient timezone</Label>
            <Select
              disabled={disabled}
              value={value.timezone}
              onValueChange={(tz) => onChange({ ...value, timezone: tz })}
            >
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
      </div>

      {/* Schedule */}
      {variant !== 'p2p' && (
      <div className="space-y-1.5">
        <Label htmlFor="sms-schedule">Schedule (optional)</Label>
        <Input
          id="sms-schedule"
          type="datetime-local"
          disabled={disabled}
          value={value.scheduled_for ?? ''}
          onChange={(e) =>
            onChange({ ...value, scheduled_for: e.target.value || null })
          }
        />
        <p className="text-xs text-muted-foreground">
          Interpreted in YOUR local timezone (the recipient timezone above only
          controls the 9am–8pm send window). Leave empty to send at the next
          dispatch run after queueing.
        </p>
      </div>
      )}

      {/* Blackout override */}
      {variant !== 'p2p' && (
      <div className="rounded-md border p-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label htmlFor="sms-blackout">Override the 9am–8pm send window</Label>
            <p className="text-xs text-muted-foreground">
              Bulk sends normally hold outside 09:00–20:00 recipient time.
              Override only with cause (e.g. offshore swing rosters) — the
              reason is recorded on the send.
            </p>
          </div>
          <Switch
            id="sms-blackout"
            disabled={disabled}
            checked={value.blackout_override}
            onCheckedChange={(checked) =>
              onChange({
                ...value,
                blackout_override: checked,
                blackout_override_reason: checked
                  ? value.blackout_override_reason
                  : '',
              })
            }
          />
        </div>
        {value.blackout_override && (
          <div className="space-y-1.5">
            <Input
              placeholder="Reason for overriding the send window (required)"
              disabled={disabled}
              value={value.blackout_override_reason}
              onChange={(e) =>
                onChange({ ...value, blackout_override_reason: e.target.value })
              }
            />
            <p className="flex items-start gap-1 text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              Messages will send around the clock. Make sure this cohort expects
              contact outside normal hours.
            </p>
          </div>
        )}
      </div>
      )}

      {/* Test send */}
      <div className="rounded-md border p-3 space-y-2">
        <Label htmlFor="sms-test-number">Send a test to yourself</Label>
        <div className="flex gap-2">
          <Input
            id="sms-test-number"
            placeholder="04xx xxx xxx"
            disabled={disabled || testSend.isPending}
            value={testNumber}
            onChange={(e) => setTestNumber(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={
              disabled ||
              testSend.isPending ||
              !testNumber.trim() ||
              !value.body.trim() ||
              value.sender_number_id == null
            }
            onClick={() => {
              testSend.mutate(
                {
                  to: testNumber,
                  body: value.body,
                  sender_number_id: value.sender_number_id as number,
                },
                {
                  onSuccess: (res) => {
                    toast.success(
                      `Test sent via ${res.provider} (${res.segments} part${
                        res.segments === 1 ? '' : 's'
                      }, ${res.encoding})`,
                    )
                  },
                  onError: (err: Error) => toast.error(err.message),
                },
              )
            }}
          >
            {testSend.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            <span className="ml-1">Test</span>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Merge fields resolve with sample data. Uses the configured provider —
          safe against the sandbox in dev.
        </p>
      </div>
    </div>
  )
}

/**
 * Shared queue-readiness check for the panel's queue buttons: empty
 * body, sender, override-reason. Org-name is a warning (confirmed in
 * the UI), not a blocker. Mirrors the server-side validation in the
 * actions route.
 */
export function smsComposerBlockers(
  value: SmsComposerValue,
  senders?: Array<{
    number_id: number
    purpose: string
    supports_inbound?: boolean | null
    provider_type?: string | null
    phone_e164?: string
  }>,
  opts?: { requireInbound?: boolean },
): string[] {
  const blockers: string[] = []
  if (!value.body.trim()) blockers.push('Message body is empty.')
  else blockers.push(...validateSmsBody(value.body).errors)
  if (value.sender_number_id == null) blockers.push('Choose a sender number.')
  else if (senders) {
    const sender = senders.find((s) => s.number_id === value.sender_number_id)
    if (isInboxUnsafePurpose(sender?.purpose)) {
      blockers.push(INBOX_UNSAFE_SENDER_MESSAGE)
    }
    if (opts?.requireInbound) {
      const inbound = inboundUnsafeClientMessage(sender)
      if (inbound) blockers.push(inbound)
    }
  }
  if (value.blackout_override && !value.blackout_override_reason.trim()) {
    blockers.push('Blackout override requires a reason.')
  }
  return blockers
}
