'use client'

/**
 * Member sidebar (brief §7.3): profile summary, rating/assessment
 * capture through the existing record_assessment_event pipeline
 * (Phase 3 — SmsAssessmentPanel), opt-out status with a one-click
 * staff opt-out, canned-reply picker (+ minimal create, optionally
 * tagged with an outcome_value for the Spoke scripted-answer gesture),
 * notes composer, assign / escalate / close / attach controls
 * (campaign and, once campaign-scoped, activity).
 *
 * Rendered inline on xl+ desktops and inside a bottom Sheet on smaller
 * screens (the parent decides).
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowUpRight,
  Ban,
  CheckCircle2,
  Loader2,
  MessageSquarePlus,
  ShieldAlert,
  Undo2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { excludeSmsEpisodes } from '@/lib/campaign/visible-campaigns'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toDisplay } from '@/lib/phone/normalise-phone'
import { VOTE_SUPPORTER_OPTIONS } from '@/lib/campaign/constants'
import {
  useAddSmsNote,
  useCreateCannedReply,
  useSmsCannedReplies,
  useSmsConversationAction,
  type SmsConversationDetail,
} from '@/lib/hooks/useSmsInbox'
import {
  confirmSmsDoNotContact,
  useStaffSmsOptOut,
} from '@/lib/hooks/useSmsOptOut'
import { SmsAssessmentPanel } from './SmsAssessmentPanel'
import { conversationTitle } from './sms-inbox-shared'

const UNASSIGNED = '__unassigned__'
const NO_ACTIVITY = '__none__'
const NO_OUTCOME = '__none__'

interface SmsMemberSidebarProps {
  detail: SmsConversationDetail
  draft: string
  onInsertCanned: (body: string) => void
}

export function SmsMemberSidebar({
  detail,
  draft,
  onInsertCanned,
}: SmsMemberSidebarProps) {
  const { conversation, user_names } = detail
  const conversationId = conversation.conversation_id
  const worker = conversation.worker
  const queryClient = useQueryClient()
  const action = useSmsConversationAction(conversationId)
  const addNote = useAddSmsNote(conversationId)
  const createCanned = useCreateCannedReply()
  const { data: cannedReplies } = useSmsCannedReplies(conversation.campaign_id)
  const [noteBody, setNoteBody] = useState('')
  const [cannedTitle, setCannedTitle] = useState('')
  const [cannedOutcome, setCannedOutcome] = useState<string>(NO_OUTCOME)
  const staffOptOut = useStaffSmsOptOut()

  const { data: staff } = useQuery({
    queryKey: ['sms-inbox-staff'],
    queryFn: async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('user_profiles')
        .select('user_id, display_name')
        .order('display_name', { ascending: true })
      if (error) throw error
      return data ?? []
    },
  })

  const { data: campaigns } = useQuery({
    queryKey: ['sms-inbox-campaigns'],
    queryFn: async () => {
      const supabase = createClient()
      const { data, error } = await excludeSmsEpisodes(
        supabase
          .from('campaigns')
          .select('campaign_id, name')
          .order('name', { ascending: true }),
      )
      if (error) throw error
      return data ?? []
    },
    enabled: conversation.campaign_id == null,
  })

  // Campaign activities for the attach-to-activity select (Phase 3)
  // and the canned-reply outcome options.
  const { data: campaignActivities } = useQuery({
    queryKey: ['sms-campaign-activity-options', conversation.campaign_id],
    queryFn: async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('campaign_activities')
        .select('activity_id, title, activity_kind, is_binary')
        .eq('campaign_id', conversation.campaign_id as number)
        .order('title', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    enabled: conversation.campaign_id != null,
  })

  const attachedActivity =
    (campaignActivities ?? []).find(
      (a) => a.activity_id === conversation.activity_id,
    ) ?? null
  // Outcome tags a canned reply can carry (Spoke scripted answers):
  // binary options for binary assessments, '1'..'5' otherwise.
  const outcomeOptions =
    conversation.activity_id == null
      ? []
      : attachedActivity?.is_binary
        ? VOTE_SUPPORTER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))
        : ['1', '2', '3', '4', '5'].map((v) => ({
            value: v,
            label: `Rating ${v}`,
          }))

  const runAction = (
    input: Parameters<typeof action.mutate>[0],
    success: string,
  ) => {
    action.mutate(input, {
      onSuccess: () => toast.success(success),
      onError: (err: Error) => toast.error(err.message),
    })
  }

  const setStaffOptOut = (optOut: boolean) => {
    if (!worker) return
    if (optOut && !confirmSmsDoNotContact(conversationTitle(conversation))) {
      return
    }
    staffOptOut.mutate(
      { workerId: worker.worker_id, optOut },
      {
        onSuccess: () => {
          toast.success(
            optOut
              ? 'Member marked Do not contact (SMS)'
              : 'SMS opt-out lifted',
          )
          queryClient.invalidateQueries({
            queryKey: ['sms-conversation', conversationId],
          })
        },
        onError: (err: Error) =>
          toast.error(err.message || 'Failed to update opt-out'),
      },
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3 text-sm">
      {/* Profile */}
      <div>
        <p className="font-semibold">{conversationTitle(conversation)}</p>
        <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          <p>{toDisplay(conversation.phone_e164)}</p>
          {worker?.employer && <p>{worker.employer.employer_name}</p>}
          {worker?.occupation && <p>{worker.occupation}</p>}
          {!worker && (
            <p className="text-purple-700">
              Not matched to a worker — triage conversation.
            </p>
          )}
        </div>
      </div>

      {/* Rating / assessment capture (Phase 3) — writes through
          record_assessment_event(source 'sms'). */}
      {worker && conversation.campaign_id != null ? (
        <SmsAssessmentPanel
          conversation={conversation}
          cannedReplies={cannedReplies ?? []}
          onInsertCanned={onInsertCanned}
        />
      ) : (
        <div className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
          {worker
            ? 'Attach this conversation to a campaign to record ratings & assessments.'
            : 'Match this conversation to a worker to record ratings & assessments.'}
        </div>
      )}

      {/* Opt-out */}
      {worker && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            {worker.sms_opt_out ? (
              <Badge variant="secondary" className="bg-red-100 text-red-700">
                <ShieldAlert className="mr-1 h-3 w-3" />
                Opted out of SMS
              </Badge>
            ) : (
              <Badge variant="secondary" className="bg-green-100 text-green-700">
                <CheckCircle2 className="mr-1 h-3 w-3" />
                SMS OK
              </Badge>
            )}
          </div>
          {worker.sms_opt_out ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={staffOptOut.isPending}
              onClick={() => setStaffOptOut(false)}
            >
              {staffOptOut.isPending ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Undo2 className="mr-1 h-3 w-3" />
              )}
              Lift opt-out (member asked)
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-red-700 hover:text-red-800"
              disabled={staffOptOut.isPending}
              title="Opts this member out of ALL SMS — blasts, surveys, chats and 1:1 replies"
              onClick={() => setStaffOptOut(true)}
            >
              {staffOptOut.isPending ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Ban className="mr-1 h-3 w-3" />
              )}
              Do not contact (SMS)
            </Button>
          )}
        </div>
      )}

      <Separator />

      {/* Assignment / escalation / lifecycle */}
      <div className="space-y-2">
        <div className="space-y-1">
          <Label className="text-xs">Assigned to</Label>
          <Select
            value={conversation.assignee_user_id ?? UNASSIGNED}
            onValueChange={(v) =>
              runAction(
                { action: 'assign', user_id: v === UNASSIGNED ? null : v },
                'Assignment updated',
              )
            }
          >
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
              {(staff ?? []).map((s) => (
                <SelectItem key={s.user_id} value={s.user_id}>
                  {s.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Escalation</Label>
          {conversation.escalated_to_user_id ? (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-orange-100 text-orange-800">
                <ArrowUpRight className="mr-1 h-3 w-3" />
                {user_names[conversation.escalated_to_user_id] ?? 'Escalated'}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => runAction({ action: 'de_escalate' }, 'De-escalated')}
              >
                De-escalate
              </Button>
            </div>
          ) : (
            <Select
              value=""
              onValueChange={(v) =>
                runAction(
                  { action: 'escalate', user_id: v },
                  'Escalated — replies keep routing here until de-escalated',
                )
              }
            >
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue placeholder="Escalate to…" />
              </SelectTrigger>
              <SelectContent>
                {(staff ?? []).map((s) => (
                  <SelectItem key={s.user_id} value={s.user_id}>
                    {s.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {conversation.campaign_id == null && (
          <div className="space-y-1">
            <Label className="text-xs">Attach to campaign</Label>
            <Select
              value=""
              onValueChange={(v) =>
                runAction(
                  { action: 'attach', campaign_id: Number(v) },
                  'Conversation attached to campaign',
                )
              }
            >
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue placeholder="Pick a campaign…" />
              </SelectTrigger>
              <SelectContent>
                {(campaigns ?? []).map((c) => (
                  <SelectItem key={c.campaign_id} value={String(c.campaign_id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {conversation.campaign_id != null && (
          <div className="space-y-1">
            <Label className="text-xs">Attached activity</Label>
            <Select
              value={
                conversation.activity_id != null
                  ? String(conversation.activity_id)
                  : NO_ACTIVITY
              }
              onValueChange={(v) =>
                runAction(
                  {
                    action: 'attach',
                    activity_id: v === NO_ACTIVITY ? null : Number(v),
                  },
                  v === NO_ACTIVITY
                    ? 'Activity detached'
                    : 'Conversation attached to activity',
                )
              }
            >
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue placeholder="Attach to an activity…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ACTIVITY}>No activity</SelectItem>
                {(campaignActivities ?? []).map((a) => (
                  <SelectItem key={a.activity_id} value={String(a.activity_id)}>
                    {a.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {conversation.state === 'closed' ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => runAction({ action: 'reopen' }, 'Conversation reopened')}
          >
            Reopen conversation
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => runAction({ action: 'close' }, 'Conversation closed')}
          >
            Close conversation
          </Button>
        )}
      </div>

      <Separator />

      {/* Canned replies */}
      <div className="space-y-1.5">
        <Label className="text-xs">Canned replies</Label>
        {(cannedReplies ?? []).length === 0 && (
          <p className="text-xs text-muted-foreground">None yet.</p>
        )}
        <div className="max-h-40 space-y-1 overflow-y-auto">
          {(cannedReplies ?? []).map((r) => (
            <button
              key={r.reply_id}
              type="button"
              className="w-full rounded-md border p-1.5 text-left text-xs hover:bg-muted/50"
              title={r.body}
              onClick={() => onInsertCanned(r.body)}
            >
              <span className="font-medium">{r.title}</span>
              {r.campaign_id == null && (
                <span className="ml-1 text-muted-foreground">(org-wide)</span>
              )}
              <span className="block truncate text-muted-foreground">{r.body}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <Input
            className="h-7 text-xs"
            placeholder="Save draft as canned…"
            value={cannedTitle}
            onChange={(e) => setCannedTitle(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            disabled={
              !cannedTitle.trim() || !draft.trim() || createCanned.isPending
            }
            title="Saves the current reply draft as a canned reply"
            onClick={() =>
              createCanned.mutate(
                {
                  title: cannedTitle.trim(),
                  body: draft.trim(),
                  campaign_id: conversation.campaign_id,
                  outcome_value:
                    cannedOutcome === NO_OUTCOME ? null : cannedOutcome,
                },
                {
                  onSuccess: () => {
                    setCannedTitle('')
                    setCannedOutcome(NO_OUTCOME)
                    toast.success('Canned reply saved')
                  },
                  onError: (err: Error) => toast.error(err.message),
                },
              )
            }
          >
            <MessageSquarePlus className="h-3 w-3" />
          </Button>
        </div>
        {outcomeOptions.length > 0 && (
          <div className="space-y-1">
            <Select value={cannedOutcome} onValueChange={setCannedOutcome}>
              <SelectTrigger className="h-7 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_OUTCOME}>
                  No outcome link (plain reply)
                </SelectItem>
                {outcomeOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    Follows outcome: {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Tagged replies auto-load into the composer when that outcome
              is recorded from the quick-capture buttons.
            </p>
          </div>
        )}
      </div>

      <Separator />

      {/* Internal note composer (rendered inline in the thread). */}
      <div className="space-y-1.5">
        <Label className="text-xs">Internal note</Label>
        <Textarea
          rows={2}
          className="resize-none text-xs"
          placeholder="Visible to staff only — shows inline in the thread."
          value={noteBody}
          onChange={(e) => setNoteBody(e.target.value)}
        />
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={!noteBody.trim() || addNote.isPending}
          onClick={() =>
            addNote.mutate(noteBody.trim(), {
              onSuccess: () => setNoteBody(''),
              onError: (err: Error) => toast.error(err.message),
            })
          }
        >
          {addNote.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          Add note
        </Button>
      </div>
    </div>
  )
}
