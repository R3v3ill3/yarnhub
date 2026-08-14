'use client'

/**
 * Surveys tab of the SMS Outreach sub-tab (Phase 4, brief §4.1 +
 * §7.3): survey list with status + mini funnel, a create/edit sheet
 * around SmsSurveyEditor, an open sheet with audience selection
 * (whole campaign or a saved worker list — the sms-lists idiom), and
 * a funnel report for open/closed surveys (invited → started →
 * completed, per-question drop-off + invalid-reply rate with the
 * §4.1 ">10–15% invalid = rewrite the question" hint).
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api/fetch-api'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/supabase/auth-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { Progress } from '@/components/ui/progress'
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
  AlertTriangle,
  ClipboardList,
  Copy,
  Download,
  GitBranch,
  ListPlus,
  Loader2,
  Lock,
  Pause,
  PieChart,
  Play,
  Plus,
  Rocket,
  Scale,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils/cn'
import { BALLOT_COMPLIANCE_BANNER } from '@/lib/sms/survey-validation'
import { validateSmsBody } from '@/lib/sms/compliance'
import { surveySenderPurposeWarning } from '@/lib/sms/sender-purpose'
import { SmsOrgNameWarningDialog } from '@/components/sms/SmsOrgNameWarningDialog'
import type { IntegrityFinding } from '@/lib/sms/survey-integrity'
import type {
  SmsBallotDetail,
  SmsBallotEventRow,
  SmsSurveyPauseMode,
  VwSmsBallotTallyRow,
} from '@/types/sms'
import {
  useCreateSmsSurvey,
  useDeleteSmsSurvey,
  useSmsSurveyAction,
  useSmsSurveyCatalogue,
  useSmsSurveyDetail,
  useSmsSurveys,
  useUpdateSmsSurvey,
  type SmsSurveyCatalogueRow,
  type SmsSurveyDetail,
  type SmsSurveyListRow,
  type SurveyLaunchPreview,
} from '@/lib/hooks/useSmsSurveys'
import { useSmsSenders } from '@/lib/hooks/useSmsBroadcast'
import { inboundUnsafeClientMessage } from '@/lib/sms/sender-inbound'
import {
  EMPTY_SURVEY,
  EMPTY_SURVEY_QUESTION,
  SmsSurveyEditor,
  fromQuestionRows,
  toQuestionInputs,
  type SurveyEditorValue,
} from '@/components/sms/surveys/SmsSurveyEditor'
import { SmsSurveyFlowChart } from '@/components/sms/surveys/SmsSurveyFlowChart'
import { SmsSurveyReportDashboard } from '@/components/sms/surveys/SmsSurveyReportDashboard'
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
  open: 'bg-green-100 text-green-700',
  paused: 'bg-amber-100 text-amber-800',
  closed: 'bg-slate-100 text-slate-500',
}

type ListFilter = 'all' | 'active' | 'tests' | 'closed'

const LIST_FILTERS: { id: ListFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'tests', label: 'Tests' },
  { id: 'closed', label: 'Closed' },
]

function matchesListFilter(survey: SmsSurveyListRow, filter: ListFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'active') {
    return (
      survey.status === 'draft' ||
      survey.status === 'open' ||
      survey.status === 'paused'
    )
  }
  if (filter === 'tests') return !!survey.is_test
  return survey.status === 'closed'
}

interface SmsSurveysPanelProps {
  campaignId?: string | number | null
  standaloneMode?: boolean
}

export function SmsSurveysPanel({
  campaignId,
  standaloneMode = false,
}: SmsSurveysPanelProps) {
  const id = campaignId != null && String(campaignId) !== '' ? String(campaignId) : ''
  const searchParams = useSearchParams()
  const { data: campaignSurveys, isLoading: campaignLoading } = useSmsSurveys(id)
  const { data: episodes, isLoading: episodesLoading } = useSmsEpisodes(standaloneMode)
  const createEpisode = useCreateSmsEpisode()
  const deleteEpisode = useDeleteSmsEpisode()
  const renameEpisode = useRenameSmsEpisode()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorCampaignId, setEditorCampaignId] = useState<string | null>(null)
  const [editorSaved, setEditorSaved] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [detailCampaignId, setDetailCampaignId] = useState<string | null>(null)
  const [sourceWorkerListId, setSourceWorkerListId] = useState<number | null>(null)
  const [listFilter, setListFilter] = useState<ListFilter>('all')

  const surveys = useMemo(() => {
    if (standaloneMode) {
      return (episodes ?? []).flatMap((e) =>
        e.surveys.map((s) => ({
          survey_id: s.survey_id,
          campaign_id: e.campaign_id,
          title: s.title,
          status: s.status,
          is_test: s.is_test,
          purpose: s.purpose,
          question_count: s.question_count,
          funnel: s.funnel,
        })),
      )
    }
    return campaignSurveys ?? []
  }, [standaloneMode, episodes, campaignSurveys])

  const isLoading = standaloneMode ? episodesLoading : campaignLoading

  const startNewSurvey = async () => {
    if (!standaloneMode) {
      setEditorCampaignId(id)
      setEditorSaved(false)
      setEditorOpen(true)
      return
    }
    try {
      const ep = await createEpisode.mutateAsync({ kind: 'survey' })
      setEditorCampaignId(String(ep.campaign_id))
      setEditorSaved(false)
      setEditorOpen(true)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not start standalone survey',
      )
    }
  }

  const closeEditor = (open: boolean) => {
    setEditorOpen(open)
    if (open) return
    const cid = editorCampaignId
    if (standaloneMode && cid && !editorSaved) {
      deleteEpisode.mutate(cid)
    }
    setEditorCampaignId(null)
    setEditorSaved(false)
  }

  // Chain B (Phase 8): the SMS Build List Survey pathway lands here
  // with ?survey_source_list=<lid> (cohort attached) or ?new_survey=1
  // (header entry, no cohort) — open the create sheet on mount.
  useEffect(() => {
    const sourceList = searchParams.get('survey_source_list')
    const newSurvey = searchParams.get('new_survey')
    if (sourceList) {
      const n = Number(sourceList)
      if (Number.isFinite(n)) setSourceWorkerListId(n)
      if (!standaloneMode) {
        setEditorCampaignId(id)
        setEditorOpen(true)
      }
    } else if (newSurvey === '1' && !standaloneMode) {
      setEditorCampaignId(id)
      setEditorOpen(true)
    }
    // Mount-only: re-running on every searchParams change would reopen
    // the sheet after the user closes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totals = useMemo(() => {
    const rows = surveys
    const sum = (fn: (r: (typeof surveys)[number]) => number) =>
      rows.reduce((acc, r) => acc + fn(r), 0)
    return {
      surveys: rows.length,
      open: rows.filter((r) => r.status === 'open').length,
      invited: sum((r) => r.funnel?.ever_invited_count ?? 0),
      completed: sum((r) => r.funnel?.completed_count ?? 0),
    }
  }, [surveys])

  const filteredSurveys = useMemo(
    () => surveys.filter((s) => matchesListFilter(s as SmsSurveyListRow, listFilter)),
    [surveys, listFilter],
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Button size="lg" onClick={() => void startNewSurvey()}>
          <ClipboardList className="h-5 w-5 mr-2" />
          New survey
        </Button>
      </div>

      <div>
        <h3 className="font-semibold">SMS Surveys</h3>
        <p className="text-sm text-muted-foreground">
          {standaloneMode
            ? 'Standalone surveys are not tied to a campaign. Answers are recorded; assessment mapping stays off.'
            : 'Reply-native surveys with automatic parsing, retries and handoff. Answers land in the inbox thread; marked questions write member ratings.'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Surveys" value={totals.surveys} />
        <StatCard label="Open" value={totals.open} />
        <StatCard label="Invited" value={totals.invited} />
        <StatCard label="Completed" value={totals.completed} />
      </div>

      {(surveys?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {LIST_FILTERS.map((f) => (
            <Button
              key={f.id}
              type="button"
              size="sm"
              variant={listFilter === f.id ? 'secondary' : 'outline'}
              onClick={() => setListFilter(f.id)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : surveys && surveys.length > 0 ? (
        filteredSurveys.length > 0 ? (
          <div className="space-y-2">
            {filteredSurveys.map((s) => (
              <SurveyCard
                key={s.survey_id}
                survey={s}
                onOpen={() => {
                  setDetailCampaignId(String(s.campaign_id))
                  setDetailId(s.survey_id)
                }}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No surveys match this filter.
          </p>
        )
      ) : (
        <Card className="border-dashed">
          <CardContent className="p-4 text-center">
            <ClipboardList className="h-7 w-7 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground mb-3">
              No surveys yet. Keep them short — completion drops sharply past 5
              questions.
            </p>
            <Button variant="outline" size="sm" onClick={() => void startNewSurvey()}>
              <Plus className="h-4 w-4 mr-1" />
              New survey
            </Button>
          </CardContent>
        </Card>
      )}

      {editorCampaignId && (
      <SurveyEditorSheet
        campaignId={editorCampaignId}
        surveyId={null}
        open={editorOpen}
        onOpenChange={closeEditor}
        sourceWorkerListId={sourceWorkerListId}
        hideAssessments={standaloneMode}
        onSaved={(surveyId, title) => {
          setEditorSaved(true)
          setEditorOpen(false)
          if (standaloneMode && title?.trim()) {
            renameEpisode.mutate({
              campaignId: editorCampaignId,
              name: title.trim(),
            })
          }
          setDetailCampaignId(editorCampaignId)
          setDetailId(surveyId)
          setEditorCampaignId(null)
        }}
      />
      )}

      <SurveyDetailSheet
        campaignId={detailCampaignId ?? id}
        surveyId={detailId}
        hideAssessments={standaloneMode}
        onOpenChange={(open) => {
          if (!open) {
            setDetailId(null)
            setDetailCampaignId(null)
          }
        }}
        onPromoted={(newId) => setDetailId(newId)}
      />
    </div>
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

type SurveyCardRow = {
  survey_id: number
  campaign_id: number
  title: string
  status: string
  is_test: boolean
  purpose: string
  question_count: number
  funnel: SmsSurveyListRow['funnel']
}

function SurveyCard({
  survey,
  onOpen,
}: {
  survey: SurveyCardRow
  onOpen: () => void
}) {
  const funnel = survey.funnel
  const invited = funnel?.ever_invited_count ?? 0
  const completed = funnel?.completed_count ?? 0
  const pct = invited > 0 ? Math.round((completed / invited) * 100) : 0

  return (
    <Card className="hover:bg-muted/30 transition-colors">
      <CardContent className="p-3">
        <button type="button" className="w-full text-left" onClick={onOpen}>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-medium truncate">{survey.title}</p>
            <Badge className={STATUS_COLORS[survey.status] || ''} variant="secondary">
              {survey.status}
            </Badge>
            {survey.is_test && (
              <Badge variant="secondary" className="bg-violet-100 text-violet-800">
                Test
              </Badge>
            )}
            {survey.purpose === 'indicative_ballot' && (
              <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                <Scale className="h-3 w-3 mr-1" />
                indicative ballot
              </Badge>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              {survey.question_count} question
              {survey.question_count === 1 ? '' : 's'}
            </span>
          </div>
          {survey.status !== 'draft' && funnel && (
            <>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>{funnel.total_sessions} recipients</span>
                <span>{invited} invited</span>
                <span>{funnel.started_count} started</span>
                <span>{completed} completed</span>
                {funnel.handed_off_count > 0 && (
                  <span className="text-amber-700">
                    {funnel.handed_off_count} handed off
                  </span>
                )}
                {funnel.opted_out_count > 0 && (
                  <span>{funnel.opted_out_count} opted out</span>
                )}
              </div>
              {invited > 0 && <Progress value={pct} className="h-1 mt-2" />}
            </>
          )}
        </button>
      </CardContent>
    </Card>
  )
}

function detailToEditorValue(detail: SmsSurveyDetail): SurveyEditorValue {
  const s = detail.survey
  return {
    title: s.title,
    purpose: s.purpose ?? 'survey',
    revote_policy: s.revote_policy ?? 'locked',
    results_restricted: !!s.results_restricted,
    activity_id: null,
    sender_number_id: s.sender_number_id,
    invitation_body: s.invitation_body ?? '',
    completion_body: s.completion_body ?? '',
    retry_limit: s.retry_limit,
    question_timeout_minutes: s.question_timeout_minutes,
    session_ttl_hours: s.session_ttl_hours,
    reminder_offsets: Array.isArray(s.reminder_offsets) ? s.reminder_offsets : [],
    is_test: s.is_test ?? true,
    timezone: s.timezone || 'Australia/Perth',
    blackout_override: !!s.blackout_override,
    blackout_override_reason: s.blackout_override_reason ?? '',
    // A survey fired from the wall-chart fire path (or any other
    // question-less draft) must still open to a usable editor, not a
    // zero-card list.
    questions:
      detail.questions.length > 0
        ? fromQuestionRows(detail.questions)
        : [{ ...EMPTY_SURVEY_QUESTION }],
  }
}

/**
 * Clone a survey definition into a new draft for the current campaign.
 * Campaign-local FKs (ratings targets, source list) are cleared — sender
 * numbers are org-scoped and kept when present.
 */
function cloneSurveyForNewDraft(detail: SmsSurveyDetail): SurveyEditorValue {
  const base = detailToEditorValue(detail)
  const title = base.title.trim()
  return {
    ...base,
    title: title ? `${title} (copy)` : '',
    activity_id: null,
    questions: base.questions.map((q) => ({
      ...q,
      activity_id: null,
    })),
  }
}

function freshEditorValue(initial?: SurveyEditorValue): SurveyEditorValue {
  return (
    initial ?? {
      ...EMPTY_SURVEY,
      questions: [{ ...EMPTY_SURVEY_QUESTION }],
    }
  )
}

function SurveyEditorSheet({
  campaignId,
  surveyId,
  initial,
  open,
  onOpenChange,
  onSaved,
  sourceWorkerListId,
  hideAssessments = false,
}: {
  campaignId: string
  surveyId: number | null
  initial?: SurveyEditorValue
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (surveyId: number, title?: string) => void
  /** Chain B: the cohort this draft is being created from (create mode only). */
  sourceWorkerListId?: number | null
  hideAssessments?: boolean
}) {
  const isCreate = surveyId == null
  const [value, setValue] = useState<SurveyEditorValue>(() =>
    freshEditorValue(initial),
  )
  const [showFlow, setShowFlow] = useState(true)
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState<number | null>(
    0,
  )
  const [duplicateKey, setDuplicateKey] = useState<string>('none')
  const [duplicating, setDuplicating] = useState(false)
  const [ackFindings, setAckFindings] = useState<IntegrityFinding[] | null>(null)
  const [ackText, setAckText] = useState('')
  const queryClient = useQueryClient()
  const create = useCreateSmsSurvey(campaignId)
  const update = useUpdateSmsSurvey(campaignId)
  const { data: senders } = useSmsSenders()
  const pending = create.isPending || update.isPending || duplicating
  const senderInboundError = inboundUnsafeClientMessage(
    senders?.find((s) => s.number_id === value.sender_number_id),
  )
  const { data: catalogue, isLoading: catalogueLoading } = useSmsSurveyCatalogue(
    open && isCreate,
  )

  // Re-seed when the sheet opens or the edited survey changes. `initial` is
  // omitted from deps so parent re-renders (new object identity) do not wipe
  // in-progress edits.
  useEffect(() => {
    if (!open) return
    setValue(freshEditorValue(initial))
    setSelectedQuestionIndex(0)
    setDuplicateKey('none')
    setShowFlow(true)
    setAckFindings(null)
    setAckText('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, surveyId])

  const activitiesQueryKey = ['sms-survey-activities', campaignId] as const
  const { data: activities } = useQuery({
    queryKey: activitiesQueryKey,
    queryFn: async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('campaign_activities')
        .select('activity_id, title, is_binary')
        .eq('campaign_id', Number(campaignId))
        .eq('activity_kind', 'assessment')
        .order('title')
      if (error) throw error
      return (data ?? []).map((a) => ({
        activity_id: a.activity_id as number,
        title: a.title as string,
        is_binary: !!a.is_binary,
      }))
    },
    enabled: open && !hideAssessments,
  })

  const catalogueOptions = useMemo(() => {
    const rows = catalogue ?? []
    // Prefer other campaigns first, then this campaign's surveys.
    return [...rows].sort((a, b) => {
      const aHere = a.campaign_id === Number(campaignId) ? 1 : 0
      const bHere = b.campaign_id === Number(campaignId) ? 1 : 0
      if (aHere !== bHere) return aHere - bHere
      return a.campaign_name.localeCompare(b.campaign_name) ||
        a.title.localeCompare(b.title)
    })
  }, [catalogue, campaignId])

  const applyDuplicate = async (key: string) => {
    setDuplicateKey(key)
    if (key === 'none') return
    const [srcCampaignId, srcSurveyId] = key.split(':').map(Number)
    if (!Number.isFinite(srcCampaignId) || !Number.isFinite(srcSurveyId)) return
    setDuplicating(true)
    try {
      const res = await fetchApi(
        `/api/campaigns/${srcCampaignId}/sms-surveys/${srcSurveyId}`,
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to load survey to duplicate')
      }
      const detail = (await res.json()) as SmsSurveyDetail
      const cloned = cloneSurveyForNewDraft(detail)
      setValue(cloned)
      setSelectedQuestionIndex(0)
      setShowFlow(true)
      toast.success(
        `Duplicated “${detail.survey.title}” — edit and save as a new draft in this campaign.`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Duplicate failed')
      setDuplicateKey('none')
    } finally {
      setDuplicating(false)
    }
  }

  const buildPayload = (acknowledgeHighRisk?: string) => ({
    title: value.title,
    purpose: value.purpose,
    revote_policy: value.revote_policy,
    results_restricted: value.results_restricted,
    activity_id: null,
    sender_number_id: value.sender_number_id,
    invitation_body: value.invitation_body,
    completion_body: value.completion_body || null,
    retry_limit: value.retry_limit,
    question_timeout_minutes: value.question_timeout_minutes,
    session_ttl_hours: value.session_ttl_hours,
    reminder_offsets: value.reminder_offsets,
    is_test: value.is_test,
    timezone: value.timezone,
    blackout_override: value.blackout_override,
    blackout_override_reason: value.blackout_override
      ? value.blackout_override_reason || null
      : null,
    questions: toQuestionInputs(value.questions),
    ...(acknowledgeHighRisk
      ? { acknowledge_high_risk: acknowledgeHighRisk }
      : {}),
    ...(surveyId == null && sourceWorkerListId != null
      ? { source_worker_list_id: sourceWorkerListId }
      : {}),
  })

  const submit = (acknowledgeHighRisk?: string) => {
    if (!value.title.trim()) {
      toast.error('Give the survey a title')
      return
    }
    if (senderInboundError) {
      toast.error(senderInboundError)
      return
    }
    const payload = buildPayload(acknowledgeHighRisk)
    const onError = (err: Error) => {
      const withFindings = err as Error & { findings?: IntegrityFinding[] }
      const highRisk = (withFindings.findings ?? []).filter((f) => f.risk === 'high')
      if (surveyId != null && highRisk.length > 0) {
        setAckFindings(withFindings.findings ?? highRisk)
        setAckText('')
        return
      }
      toast.error(err.message)
    }
    if (surveyId != null) {
      update.mutate(
        { surveyId, ...payload },
        {
          onSuccess: () => {
            setAckFindings(null)
            setAckText('')
            toast.success('Survey saved')
            onSaved(surveyId, value.title)
          },
          onError,
        },
      )
    } else {
      create.mutate(payload, {
        onSuccess: (res) => {
          toast.success('Survey created')
          onSaved(res.survey_id, value.title)
        },
        onError,
      })
    }
  }

  const highRiskFindings = (ackFindings ?? []).filter((f) => f.risk === 'high')

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className={cn(
          'flex w-full flex-col overflow-hidden p-0',
          showFlow ? 'sm:max-w-[min(96vw,88rem)]' : 'sm:max-w-2xl',
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <div
            className={cn(
              'min-h-0 overflow-y-auto p-6',
              showFlow
                ? 'sm:w-[min(100%,36rem)] sm:shrink-0 sm:border-r'
                : 'flex-1',
            )}
          >
            <SheetHeader>
              <div className="flex items-start justify-between gap-2 pr-6">
                <div className="space-y-1.5">
                  <SheetTitle>
                    {surveyId != null ? 'Edit survey' : 'New survey'}
                  </SheetTitle>
                  <SheetDescription>
                    Reply-native SMS survey — members answer by text, the engine
                    parses, retries and hands off to the inbox when needed.
                    {surveyId == null && sourceWorkerListId != null && (
                      <span className="mt-1 block font-medium text-foreground">
                        Fired from list #{sourceWorkerListId}
                      </span>
                    )}
                  </SheetDescription>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={showFlow ? 'secondary' : 'outline'}
                  className="shrink-0"
                  onClick={() => setShowFlow((v) => !v)}
                >
                  <GitBranch className="mr-1 h-3.5 w-3.5" />
                  {showFlow ? 'Hide flow' : 'Show flow'}
                </Button>
              </div>
            </SheetHeader>

            <div className="mt-4 space-y-4 pb-8">
              {isCreate && (
                <div className="space-y-1.5 rounded-md border bg-muted/20 p-3">
                  <Label className="flex items-center gap-1.5">
                    <Copy className="h-3.5 w-3.5" />
                    Duplicate existing survey
                  </Label>
                  <Select
                    value={duplicateKey}
                    disabled={pending || catalogueLoading}
                    onValueChange={applyDuplicate}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={
                          catalogueLoading
                            ? 'Loading surveys…'
                            : 'Start blank, or pick a survey to copy'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="none">Start blank</SelectItem>
                      {catalogueOptions.map((s: SmsSurveyCatalogueRow) => (
                        <SelectItem
                          key={`${s.campaign_id}:${s.survey_id}`}
                          value={`${s.campaign_id}:${s.survey_id}`}
                        >
                          {s.title}
                          {' — '}
                          {s.campaign_name}
                          {s.campaign_id === Number(campaignId)
                            ? ' (this campaign)'
                            : ''}
                          {' · '}
                          {s.question_count}q · {s.status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Copies questions, branching and copy from any campaign.
                    Ratings targets are cleared so you can re-attach them here.
                  </p>
                </div>
              )}

              <SmsSurveyEditor
                value={value}
                onChange={setValue}
                activities={activities ?? []}
                disabled={pending}
                campaignId={campaignId}
                hideAssessments={hideAssessments}
                selectedQuestionIndex={selectedQuestionIndex}
                onSelectQuestion={setSelectedQuestionIndex}
                onActivityCreated={() => {
                  queryClient.invalidateQueries({ queryKey: activitiesQueryKey })
                }}
              />
              <Button
                className="w-full"
                disabled={pending || !!senderInboundError}
                onClick={() => submit()}
              >
                {pending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                {surveyId != null ? 'Save survey' : 'Create survey'}
              </Button>
            </div>
          </div>

          {showFlow && (
            <div className="min-h-[280px] min-w-0 flex-1 overflow-hidden border-t p-4 sm:min-h-0 sm:border-t-0">
              <SmsSurveyFlowChart
                questions={value.questions}
                selectedIndex={selectedQuestionIndex}
                onSelectQuestion={setSelectedQuestionIndex}
                className="h-full min-h-[260px]"
              />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>

    <Dialog
      open={highRiskFindings.length > 0}
      onOpenChange={(next) => {
        if (!next) {
          setAckFindings(null)
          setAckText('')
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>High-risk edit acknowledgement</DialogTitle>
          <DialogDescription>
            These changes can break in-flight answers. Type EDIT to save anyway.
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {highRiskFindings.map((f) => (
            <li key={`${f.code}-${f.message}`}>{f.message}</li>
          ))}
        </ul>
        <div className="space-y-1.5">
          <Label htmlFor="ack-edit">Type EDIT to confirm</Label>
          <Input
            id="ack-edit"
            value={ackText}
            onChange={(e) => setAckText(e.target.value)}
            placeholder="EDIT"
            autoComplete="off"
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setAckFindings(null)
              setAckText('')
            }}
          >
            Cancel
          </Button>
          <Button
            disabled={ackText !== 'EDIT' || pending}
            onClick={() => submit('EDIT')}
          >
            {pending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Save with acknowledgement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}

function SurveyDetailSheet({
  campaignId,
  surveyId,
  onOpenChange,
  onPromoted,
  hideAssessments = false,
}: {
  campaignId: string
  surveyId: number | null
  onOpenChange: (open: boolean) => void
  onPromoted?: (newSurveyId: number) => void
  hideAssessments?: boolean
}) {
  const { data: detail, isLoading } = useSmsSurveyDetail(campaignId, surveyId)
  const [editing, setEditing] = useState(false)

  return (
    <>
      <Sheet
        open={surveyId != null && !editing}
        onOpenChange={(open) => {
          if (!open) onOpenChange(false)
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          {isLoading || !detail ? (
            <>
              {/* The loaded branches name the sheet; while the detail
                  is in flight it would otherwise be unnamed. */}
              <SheetHeader className="sr-only">
                <SheetTitle>Survey</SheetTitle>
                <SheetDescription>Loading survey details.</SheetDescription>
              </SheetHeader>
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            </>
          ) : detail.survey.status === 'draft' ? (
            <DraftDetail
              campaignId={campaignId}
              detail={detail}
              hideAssessments={hideAssessments}
              onEdit={() => setEditing(true)}
              onGone={() => onOpenChange(false)}
            />
          ) : (
            <FunnelDetail
              campaignId={campaignId}
              detail={detail}
              onEdit={() => setEditing(true)}
              onGone={() => onOpenChange(false)}
              onPromoted={onPromoted}
            />
          )}
        </SheetContent>
      </Sheet>

      {detail && editing && (
        <SurveyEditorSheet
          campaignId={campaignId}
          surveyId={detail.survey.survey_id}
          initial={detailToEditorValue(detail)}
          open={editing}
          hideAssessments={hideAssessments}
          onOpenChange={(open) => {
            if (!open) setEditing(false)
          }}
          onSaved={() => setEditing(false)}
        />
      )}
    </>
  )
}

function DraftDetail({
  campaignId,
  detail,
  onEdit,
  onGone,
  hideAssessments = false,
}: {
  campaignId: string
  detail: SmsSurveyDetail
  onEdit: () => void
  onGone: () => void
  hideAssessments?: boolean
}) {
  const action = useSmsSurveyAction(campaignId)
  const del = useDeleteSmsSurvey(campaignId)
  const queryClient = useQueryClient()
  const [submitting, setSubmitting] = useState(false)
  const [preview, setPreview] = useState<SurveyLaunchPreview | null>(null)
  const [orgWarnOpen, setOrgWarnOpen] = useState(false)

  // Default to source_worker_list_id from Phase 8 when present
  const sourceListId = detail.survey.source_worker_list_id
  const defaultValue: AudienceValue = sourceListId
    ? { mode: 'worker_list', worker_list_id: sourceListId }
    : hideAssessments
      ? EMPTY_COMPOSED_AUDIENCE
      : { mode: 'campaign' }
  const [audienceValue, setAudienceValue] = useState<AudienceValue>(defaultValue)

  const busy = action.isPending || del.isPending || submitting
  const isTest = detail.survey.is_test ?? true
  const senderWarn = surveySenderPurposeWarning(preview?.sender_purpose)

  const runWithAudience = async (
    lifecycleAction: 'preview' | 'open',
  ) => {
    try {
      if (
        audienceValue.mode === 'composed' &&
        audienceValue.worker_ids.length === 0
      ) {
        toast.error('Pick an audience first')
        return
      }
      setSubmitting(true)
      const audience = await toApiAudience(campaignId, audienceValue)
      if (audienceValue.mode === 'composed') {
        queryClient.invalidateQueries({
          queryKey: ['worker-lists-for-sms', String(campaignId)],
        })
      }
      action.mutate(
        {
          surveyId: detail.survey.survey_id,
          action: lifecycleAction,
          audience,
        },
        {
          onSuccess: (res) => {
            if (lifecycleAction === 'preview') {
              setPreview({
                ok: true,
                invitable: res.invitable ?? 0,
                opted_out: res.opted_out ?? 0,
                skipped_no_phone: res.skipped_no_phone ?? 0,
                question_count: res.question_count ?? detail.questions.length,
                timezone: res.timezone ?? detail.survey.timezone,
                blackout_override:
                  res.blackout_override ?? !!detail.survey.blackout_override,
                within_window: res.within_window ?? false,
                next_window_at: res.next_window_at ?? '',
                is_test: res.is_test ?? isTest,
                sender_purpose: res.sender_purpose ?? null,
                sender_inbound_error: res.sender_inbound_error ?? null,
                other_open_surveys: res.other_open_surveys ?? [],
                audience_overlap_count: res.audience_overlap_count ?? 0,
              })
              return
            }
            const notes: string[] = []
            if (res.opted_out) notes.push(`${res.opted_out} opted out`)
            if (res.skipped_no_phone)
              notes.push(`${res.skipped_no_phone} without a mobile`)
            const sent = res.invitations_sent ?? 0
            const remaining = res.invitations_remaining_queued ?? 0
            const deferredLive = res.invitations_deferred_live_phone ?? 0
            let sendNote: string
            if (res.invitations_deferred_blackout) {
              sendNote =
                'Invitations are queued until the next send window (09:00–20:00).'
            } else if (sent > 0 && remaining === 0) {
              sendNote = `${sent} invitation${sent === 1 ? '' : 's'} sent now.`
            } else if (sent > 0 && remaining > 0) {
              sendNote = `${sent} invitation${sent === 1 ? '' : 's'} sent now; ${remaining} still queued for the next cron tick.`
            } else if (remaining > 0) {
              sendNote =
                `${remaining} invitation${remaining === 1 ? '' : 's'} still queued` +
                (res.invitation_errors?.length
                  ? ` — ${res.invitation_errors[0]}`
                  : '; cron will retry.')
            } else {
              sendNote = 'No invitations were sendable.'
            }
            toast.success(
              `Survey opened — ${res.sessions_created} recipient${
                res.sessions_created === 1 ? '' : 's'
              }${notes.length ? ` (${notes.join(', ')} excluded)` : ''}. ${sendNote}`,
            )
            if (deferredLive > 0) {
              toast.warning(
                `${deferredLive} ${
                  deferredLive === 1 ? 'person is' : 'people are'
                } already in another live survey — their invites wait until that session ends.`,
              )
            }
            setPreview(null)
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
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2 flex-wrap">
          {detail.survey.title}
          <Badge variant="secondary" className={STATUS_COLORS.draft}>
            draft
          </Badge>
          {isTest && (
            <Badge variant="secondary" className="bg-violet-100 text-violet-800">
              Test
            </Badge>
          )}
        </SheetTitle>
        <SheetDescription>
          {detail.questions.length} question
          {detail.questions.length === 1 ? '' : 's'} — pick the audience,
          review the launch summary, then launch. Opted-out workers and workers
          without a mobile are excluded automatically.
        </SheetDescription>
      </SheetHeader>
      <div className="mt-4 space-y-4 pb-8">
        {detail.survey.purpose === 'indicative_ballot' && (
          <BallotBanner note="Opening freezes the eligibility roll to the chosen audience — turnout reports against it, one vote per member." />
        )}
        <QuestionListPreview detail={detail} />

        <AudiencePicker
          channel="sms"
          campaignId={campaignId}
          value={audienceValue}
          onChange={(next) => {
            setAudienceValue(next)
            setPreview(null)
          }}
          disabled={busy}
          {...(hideAssessments ? STANDALONE_AUDIENCE_PICKER : {})}
        />

        {preview && (
          <Card>
            <CardContent className="p-3 space-y-2 text-sm">
              <p className="font-medium">Launch summary</p>
              {((preview.other_open_surveys?.length ?? 0) > 0 ||
                (preview.audience_overlap_count ?? 0) > 0) && (
                <div
                  className={cn(
                    'rounded-md border p-2.5 text-xs space-y-1',
                    (preview.audience_overlap_count ?? 0) > 0
                      ? 'border-amber-300 bg-amber-50 text-amber-900'
                      : 'border-amber-200 bg-amber-50 text-amber-800',
                  )}
                >
                  <p className="flex items-start gap-1.5 font-medium">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {(preview.audience_overlap_count ?? 0) > 0
                      ? `${preview.audience_overlap_count} ${
                          preview.audience_overlap_count === 1
                            ? 'person in this audience is'
                            : 'people in this audience are'
                        } already in another live survey. Their invitations stay queued until that session ends.`
                      : 'Another survey is already open. Disjoint audiences are fine — a member can only have one live session at a time.'}
                  </p>
                  {(preview.other_open_surveys?.length ?? 0) > 0 && (
                    <p className="pl-5 text-amber-800/90">
                      Open now:{' '}
                      {preview.other_open_surveys!
                        .map(
                          (s) =>
                            `${s.title}${s.status === 'paused' ? ' (paused)' : ''}`,
                        )
                        .join(', ')}
                    </p>
                  )}
                </div>
              )}
              {preview.sender_inbound_error && (
                <p className="flex items-start gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {preview.sender_inbound_error}
                </p>
              )}
              {senderWarn && (
                <p className="flex items-start gap-1.5 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {senderWarn}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <span className="text-muted-foreground">Questions</span>
                <span>{preview.question_count}</span>
                <span className="text-muted-foreground">Invitable</span>
                <span>{preview.invitable}</span>
                <span className="text-muted-foreground">Opted out</span>
                <span>{preview.opted_out}</span>
                <span className="text-muted-foreground">No phone</span>
                <span>{preview.skipped_no_phone}</span>
                {(preview.audience_overlap_count ?? 0) > 0 && (
                  <>
                    <span className="text-muted-foreground">
                      Already in a live survey
                    </span>
                    <span>{preview.audience_overlap_count}</span>
                  </>
                )}
                {(preview.other_open_surveys?.length ?? 0) > 0 && (
                  <>
                    <span className="text-muted-foreground">Other surveys open</span>
                    <span>
                      {preview.other_open_surveys!
                        .map((s) => s.title)
                        .join(', ')}
                    </span>
                  </>
                )}
                <span className="text-muted-foreground">Timezone</span>
                <span>{preview.timezone}</span>
                <span className="text-muted-foreground">Send window</span>
                <span>
                  {preview.within_window
                    ? 'Within window now'
                    : `Next window ${
                        preview.next_window_at
                          ? new Date(preview.next_window_at).toLocaleString()
                          : '—'
                      }`}
                </span>
                <span className="text-muted-foreground">Blackout override</span>
                <span>{preview.blackout_override ? 'Yes' : 'No'}</span>
                <span className="text-muted-foreground">Mode</span>
                <span>{preview.is_test ? 'Test' : 'Live'}</span>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={onEdit}>
            Edit
          </Button>
          {!preview ? (
            <Button
              className="flex-1"
              disabled={busy}
              onClick={() => runWithAudience('preview')}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Review & launch
            </Button>
          ) : (
            <Button
              className="flex-1"
              disabled={busy || !!preview.sender_inbound_error}
              onClick={() => {
                if (!validateSmsBody(detail.survey.invitation_body ?? '').hasOrgName) {
                  setOrgWarnOpen(true)
                  return
                }
                void runWithAudience('open')
              }}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              {isTest ? 'Launch test' : 'Launch survey'}
            </Button>
          )}
          <Button
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            disabled={busy}
            onClick={() =>
              del.mutate(
                { surveyId: detail.survey.survey_id },
                {
                  onSuccess: () => {
                    toast.success('Survey deleted')
                    onGone()
                  },
                  onError: (err: Error) => toast.error(err.message),
                },
              )
            }
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <SmsOrgNameWarningDialog
        open={orgWarnOpen}
        onOpenChange={setOrgWarnOpen}
        onConfirm={() => {
          setOrgWarnOpen(false)
          void runWithAudience('open')
        }}
        confirmLabel="Launch without it"
      />
    </>
  )
}

function QuestionListPreview({ detail }: { detail: SmsSurveyDetail }) {
  return (
    <div className="rounded-md border divide-y">
      {detail.questions.map((q, i) => (
        <div key={q.question_id} className="px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Q{i + 1}</Badge>
            <span className="text-xs text-muted-foreground">{q.qtype}</span>
            {q.write_rating && (
              <Badge variant="secondary" className="bg-indigo-100 text-indigo-700">
                writes rating
              </Badge>
            )}
          </div>
          <p className="mt-1 whitespace-pre-wrap">{q.prompt}</p>
        </div>
      ))}
    </div>
  )
}

function FunnelDetail({
  campaignId,
  detail,
  onEdit,
  onGone,
  onPromoted,
}: {
  campaignId: string
  detail: SmsSurveyDetail
  onEdit: () => void
  onGone: () => void
  onPromoted?: (newSurveyId: number) => void
}) {
  const { isAdmin } = useAuth()
  const action = useSmsSurveyAction(campaignId)
  const del = useDeleteSmsSurvey(campaignId)
  const funnel = detail.funnel
  const invited = funnel?.ever_invited_count ?? 0
  const isBallot = detail.survey.purpose === 'indicative_ballot'
  const status = detail.survey.status
  const isTest = !!detail.survey.is_test
  // Restricted ballots: the aggregate tally is the ONLY reporting
  // surface — the per-question stats (with unparsed-capture drill-in
  // counts) are hidden along with any per-member answer surface.
  const restricted = isBallot && detail.survey.results_restricted

  const [pauseOpen, setPauseOpen] = useState(false)
  const [pauseMode, setPauseMode] = useState<SmsSurveyPauseMode>('soft')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [reportOpen, setReportOpen] = useState(false)

  const busy = action.isPending || del.isPending

  const statsByQuestion = new Map(
    detail.question_stats.map((s) => [s.question_id, s]),
  )

  const runClose = () => {
    action.mutate(
      { surveyId: detail.survey.survey_id, action: 'close' },
      {
        onSuccess: (res) =>
          toast.success(
            `${isBallot ? 'Ballot' : 'Survey'} closed${
              res.expired_sessions
                ? ` — ${res.expired_sessions} unfinished sessions expired`
                : ''
            }`,
          ),
        onError: (err: Error) => toast.error(err.message),
      },
    )
  }

  const runPromote = () => {
    action.mutate(
      { surveyId: detail.survey.survey_id, action: 'promote' },
      {
        onSuccess: (res) => {
          toast.success('Promoted to a new live draft')
          if (res.survey_id != null) onPromoted?.(res.survey_id)
        },
        onError: (err: Error) => toast.error(err.message),
      },
    )
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2 flex-wrap">
          {detail.survey.title}
          <Badge
            variant="secondary"
            className={STATUS_COLORS[status] || ''}
          >
            {status}
          </Badge>
          {status === 'paused' && detail.survey.pause_mode && (
            <Badge variant="secondary" className="bg-amber-100 text-amber-800">
              {detail.survey.pause_mode} pause
            </Badge>
          )}
          {isTest && (
            <Badge variant="secondary" className="bg-violet-100 text-violet-800">
              Test
            </Badge>
          )}
          {isBallot && (
            <Badge variant="secondary" className="bg-blue-100 text-blue-700">
              <Scale className="h-3 w-3 mr-1" />
              indicative ballot
            </Badge>
          )}
        </SheetTitle>
        <SheetDescription>
          {funnel?.total_sessions ?? 0} recipients — invitations send on open
          (inside the send window); stalled sessions get one nudge and up to
          two reminders before expiring.
        </SheetDescription>
      </SheetHeader>
      <div className="mt-4 space-y-4 pb-8">
        {isBallot && (
          <BallotBanner
            note={
              detail.survey.revote_policy === 'revote_until_close'
                ? 'Re-votes allowed until close — the last vote counts and supersessions are logged.'
                : 'One vote per member — re-vote attempts are rejected and logged.'
            }
          />
        )}
        {funnel && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            <StatCard label="Invited" value={invited} />
            <StatCard label="Started" value={funnel.started_count} />
            <StatCard label="Completed" value={funnel.completed_count} />
            <StatCard label="Handed off" value={funnel.handed_off_count} />
            <StatCard label="Queued" value={funnel.queued_count} />
            <StatCard label="Expired" value={funnel.expired_count} />
            <StatCard label="Opted out" value={funnel.opted_out_count} />
            <StatCard label="Undeliverable" value={funnel.undeliverable_count} />
          </div>
        )}

        {isBallot && detail.ballot && (
          <BallotResults detail={detail} ballot={detail.ballot} />
        )}

        {/* Phase 7: answers export (blocked server-side for restricted
            ballots — hidden here too) + "create list from responders"
            cohorts (§3.1 item 11). Cohort lists carry membership only,
            never answers, so they stay available for restricted
            ballots. */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Aggregate-only — safe for restricted ballots, which
                get the same completed-sessions tally as the table. */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReportOpen(true)}
            >
              <PieChart className="h-3 w-3 mr-1" />
              Visual report
            </Button>
            {!restricted && (
              <Button asChild variant="outline" size="sm">
                <a
                  href={`/api/campaigns/${campaignId}/sms-surveys/${detail.survey.survey_id}/export`}
                  download
                >
                  <Download className="h-3 w-3 mr-1" />
                  Export answers CSV
                </a>
              </Button>
            )}
          </div>
          <SurveyCohortButtons
            campaignId={campaignId}
            surveyId={detail.survey.survey_id}
          />
        </div>

        {/* Per-question drop-off + invalid-reply rate (§4.1) — hidden
            for restricted ballots (the tally is the whole surface). */}
        {!restricted && (
        <div className="rounded-md border divide-y">
          {detail.questions.map((q, i) => {
            const stats = statsByQuestion.get(q.question_id)
            const answered = stats?.answered_count ?? 0
            const invalid = stats?.invalid_attempts ?? 0
            const replies = answered + invalid
            const invalidPct = replies > 0 ? Math.round((invalid / replies) * 100) : 0
            const dropPct =
              invited > 0 ? Math.round((answered / invited) * 100) : 0
            return (
              <div key={q.question_id} className="px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">Q{i + 1}</Badge>
                  <p className="truncate flex-1">{q.prompt}</p>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    {answered} answered ({dropPct}% of invited)
                  </span>
                  {(stats?.unparsed_count ?? 0) > 0 && (
                    <span>{stats?.unparsed_count} unparsed</span>
                  )}
                  <span className={invalidPct > 10 ? 'text-amber-700 font-medium' : ''}>
                    {invalidPct}% invalid replies
                    {invalidPct > 10 ? ' — consider rewording' : ''}
                  </span>
                </div>
                <Progress value={dropPct} className="h-1 mt-1.5" />
              </div>
            )
          })}
        </div>
        )}

        <div className="flex flex-wrap gap-2">
          {status === 'open' && (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setPauseMode('soft')
                  setPauseOpen(true)
                }}
              >
                <Pause className="h-4 w-4 mr-2" />
                Pause
              </Button>
              <Button variant="outline" disabled={busy} onClick={runClose}>
                {action.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Lock className="h-4 w-4 mr-2" />
                )}
                {isBallot ? 'Close ballot' : 'Close survey'}
              </Button>
            </>
          )}

          {status === 'paused' && (
            <>
              <Button
                disabled={busy}
                onClick={() =>
                  action.mutate(
                    {
                      surveyId: detail.survey.survey_id,
                      action: 'resume',
                    },
                    {
                      onSuccess: () => toast.success('Survey resumed'),
                      onError: (err: Error) => toast.error(err.message),
                    },
                  )
                }
              >
                {action.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Resume
              </Button>
              <Button variant="outline" disabled={busy} onClick={onEdit}>
                Edit
              </Button>
              <Button variant="outline" disabled={busy} onClick={runClose}>
                <Lock className="h-4 w-4 mr-2" />
                {isBallot ? 'Close ballot' : 'Close survey'}
              </Button>
              {isTest && (
                <Button variant="outline" disabled={busy} onClick={runPromote}>
                  <Rocket className="h-4 w-4 mr-2" />
                  Promote
                </Button>
              )}
            </>
          )}

          {status === 'closed' && (
            <>
              {isTest && (
                <Button variant="outline" disabled={busy} onClick={runPromote}>
                  <Rocket className="h-4 w-4 mr-2" />
                  Promote
                </Button>
              )}
              {isAdmin && (
                <Button
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={busy}
                  onClick={() => {
                    setDeleteConfirm('')
                    setDeleteOpen(true)
                  }}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="max-h-[90vh] w-[95vw] max-w-6xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              {detail.survey.title}
              <Badge variant="secondary" className={STATUS_COLORS[status] || ''}>
                {status}
              </Badge>
              {isTest && (
                <Badge
                  variant="secondary"
                  className="bg-violet-100 text-violet-800"
                >
                  Test
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {isBallot
                ? 'Completed votes only — an abandoned half-vote is not a vote.'
                : 'Every answer counts, including sessions still in progress.'}{' '}
              Updates live while the survey is open.
            </DialogDescription>
          </DialogHeader>
          {reportOpen && (
            <SmsSurveyReportDashboard
              campaignId={campaignId}
              surveyId={detail.survey.survey_id}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={pauseOpen} onOpenChange={setPauseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pause survey</DialogTitle>
            <DialogDescription>
              Soft pause still accepts answers; hard pause acknowledges replies
              but does not advance sessions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Pause mode</Label>
            <Select
              value={pauseMode}
              onValueChange={(v) => setPauseMode(v as SmsSurveyPauseMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="soft">Soft — keep collecting answers</SelectItem>
                <SelectItem value="hard">Hard — hold replies until resume</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPauseOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                action.mutate(
                  {
                    surveyId: detail.survey.survey_id,
                    action: 'pause',
                    pause_mode: pauseMode,
                  },
                  {
                    onSuccess: () => {
                      setPauseOpen(false)
                      toast.success(
                        `Survey paused (${pauseMode})`,
                      )
                    },
                    onError: (err: Error) => toast.error(err.message),
                  },
                )
              }
            >
              {busy ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Pause className="h-4 w-4 mr-2" />
              )}
              Pause
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(next) => {
          setDeleteOpen(next)
          if (!next) setDeleteConfirm('')
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete closed survey</DialogTitle>
            <DialogDescription>
              Permanently destroys sessions, answers, and ballot audit rows.
              Type DELETE to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="delete-confirm">Type DELETE</Label>
            <Input
              id="delete-confirm"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteConfirm !== 'DELETE' || busy}
              onClick={() =>
                del.mutate(
                  {
                    surveyId: detail.survey.survey_id,
                    confirm: 'DELETE',
                  },
                  {
                    onSuccess: () => {
                      setDeleteOpen(false)
                      toast.success('Survey deleted')
                      onGone()
                    },
                    onError: (err: Error) => toast.error(err.message),
                  },
                )
              }
            >
              {del.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

const SURVEY_COHORT_OPTIONS = [
  { value: 'completed', label: 'Completed' },
  { value: 'started_not_completed', label: 'Started, not completed' },
  { value: 'non_responders', label: 'Non-responders' },
] as const

/**
 * "Create list from responders" (Phase 7, §3.1 item 11) — one click
 * turns a funnel segment into a draft campaign_worker_list usable by
 * every channel. non_responders excludes opted-out sessions.
 */
function SurveyCohortButtons({
  campaignId,
  surveyId,
}: {
  campaignId: string
  surveyId: number
}) {
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: async (cohort: string) => {
      const res = await fetchApi(
        `/api/campaigns/${campaignId}/sms-surveys/${surveyId}/worker-list`,
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
      {SURVEY_COHORT_OPTIONS.map((o) => (
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

/**
 * The §4.2/§8.1 compliance boundary — always visible on ballot
 * surfaces, never editable.
 */
function BallotBanner({ note }: { note?: string }) {
  return (
    <div className="flex gap-2 rounded-md border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-900">
      <Scale className="h-4 w-4 shrink-0 mt-0.5" />
      <p>
        <span className="font-semibold">{BALLOT_COMPLIANCE_BANNER}</span>
        {note ? ` ${note}` : ''}
      </p>
    </div>
  )
}

const BALLOT_EVENT_LABELS: Record<SmsBallotEventRow['event_type'], string> = {
  roll_frozen: 'Roll frozen',
  invitation_sent: 'Invitation sent',
  vote_received: 'Vote received',
  vote_superseded: 'Vote superseded (re-vote)',
  vote_rejected_locked: 'Re-vote rejected (locked)',
  receipt_sent: 'Receipt sent',
  ballot_opened: 'Ballot opened',
  ballot_closed: 'Ballot closed',
  tally_generated: 'Tally generated',
}

/**
 * Ballot results & audit (§4.2): turnout vs the frozen roll, the
 * aggregate tally (no per-member choices — the reporting surface for
 * restricted ballots), the recomputed receipt list (codes only,
 * lexicographic — members self-verify against it) and the append-only
 * event log timeline.
 */
function BallotResults({
  detail,
  ballot,
}: {
  detail: SmsSurveyDetail
  ballot: SmsBallotDetail
}) {
  const [showReceipts, setShowReceipts] = useState(false)
  const [showEvents, setShowEvents] = useState(false)

  const tallyByQuestion = new Map<number, VwSmsBallotTallyRow[]>()
  for (const row of ballot.tally) {
    const list = tallyByQuestion.get(row.question_id) ?? []
    list.push(row)
    tallyByQuestion.set(row.question_id, list)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="On roll" value={ballot.turnout.roll_count} />
        <StatCard label="Votes cast" value={ballot.turnout.votes_cast} />
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Turnout</p>
            <p className="text-lg font-semibold">{ballot.turnout.turnout_pct}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Aggregate tally — completed votes only, no member ids. */}
      <div className="rounded-md border divide-y">
        {detail.questions.map((q, i) => {
          const rows = tallyByQuestion.get(q.question_id) ?? []
          const total = rows.reduce((acc, r) => acc + r.vote_count, 0)
          return (
            <div key={q.question_id} className="px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Q{i + 1}</Badge>
                <p className="truncate flex-1">{q.prompt}</p>
                <span className="text-xs text-muted-foreground">
                  {total} vote{total === 1 ? '' : 's'}
                </span>
              </div>
              {rows.length > 0 ? (
                <div className="mt-1.5 space-y-1">
                  {rows.map((r) => {
                    const pct =
                      total > 0 ? Math.round((r.vote_count / total) * 100) : 0
                    return (
                      <div
                        key={r.parsed_value}
                        className="flex items-center gap-2 text-xs"
                      >
                        <span className="w-24 truncate" title={r.parsed_value}>
                          {r.parsed_value}
                        </span>
                        <Progress value={pct} className="h-1.5 flex-1" />
                        <span className="w-16 text-right text-muted-foreground">
                          {r.vote_count} ({pct}%)
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  No completed votes yet.
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* Receipt audit list — recomputed codes only, never member-
          linked; a voter checks their own code appears. */}
      <div className="rounded-md border">
        <button
          type="button"
          className="w-full px-3 py-2 text-left text-sm font-medium"
          onClick={() => setShowReceipts((v) => !v)}
        >
          Receipts ({ballot.receipts.length}) {showReceipts ? '▾' : '▸'}
        </button>
        {showReceipts && (
          <div className="border-t px-3 py-2">
            {ballot.receipts.length > 0 ? (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs sm:grid-cols-3">
                {ballot.receipts.map((code, i) => (
                  <span key={`${code}-${i}`}>{code}</span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No receipts yet.</p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Codes are recomputed from the votes, sorted alphabetically and
              never linked to members — a voter verifies their own receipt
              appears here.
            </p>
          </div>
        )}
      </div>

      {/* Append-only event log timeline. */}
      <div className="rounded-md border">
        <button
          type="button"
          className="w-full px-3 py-2 text-left text-sm font-medium"
          onClick={() => setShowEvents((v) => !v)}
        >
          Event log ({ballot.events.length}
          {ballot.events.length === 200 ? '+' : ''}) {showEvents ? '▾' : '▸'}
        </button>
        {showEvents && (
          <div className="max-h-64 divide-y overflow-y-auto border-t">
            {ballot.events.map((e) => (
              <div
                key={e.event_id}
                className="flex items-center gap-2 px-3 py-1.5 text-xs"
              >
                <span className="font-medium">
                  {BALLOT_EVENT_LABELS[e.event_type] ?? e.event_type}
                </span>
                <span className="ml-auto text-muted-foreground">
                  {new Date(e.occurred_at).toLocaleString()}
                </span>
              </div>
            ))}
            {ballot.events.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                No events yet.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
