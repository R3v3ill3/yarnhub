'use client'

/**
 * Visual survey report: the headline funnel (invited → started →
 * completed) plus a pie per question, refreshing live while the
 * survey is open. The CSV export answers "who said what"; this
 * answers "what did the group say", at a glance, on a screen someone
 * can point at in a meeting.
 *
 * Labels are switchable between counts and percentages because the
 * two readings serve different rooms: an organiser sizing follow-up
 * work wants the count, a delegate reporting back wants the share.
 */
import { useMemo, useState } from 'react'
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  type PieLabelRenderProps,
} from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, MessageSquareText, RefreshCw, Radio } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import {
  useSmsSurveyReport,
  useSmsSurveyReportRealtime,
  type SmsSurveyReport,
  type SmsSurveyReportQuestion,
} from '@/lib/hooks/useSmsSurveys'
import {
  formatPercent,
  formatSliceValue,
  participationSlices,
  questionSlices,
  sliceTotal,
  type ReportSlice,
  type SurveyReportLabelMode,
} from '@/lib/sms/survey-report'

const LABEL_MODE_STORAGE_KEY = 'sms-survey-report-label-mode'

const LABEL_MODES: { id: SurveyReportLabelMode; label: string; hint: string }[] =
  [
    { id: 'count', label: '#', hint: 'Show counts' },
    { id: 'percent', label: '%', hint: 'Show percentages' },
  ]

/** The choice sticks per browser — organisers tend to want one or the other. */
function readStoredLabelMode(): SurveyReportLabelMode {
  if (typeof window === 'undefined') return 'count'
  const stored = window.localStorage.getItem(LABEL_MODE_STORAGE_KEY)
  return stored === 'percent' || stored === 'count' ? stored : 'count'
}

interface SmsSurveyReportDashboardProps {
  campaignId: string | number
  surveyId: number
}

export function SmsSurveyReportDashboard({
  campaignId,
  surveyId,
}: SmsSurveyReportDashboardProps) {
  const [labelMode, setLabelMode] =
    useState<SurveyReportLabelMode>(readStoredLabelMode)

  const chooseLabelMode = (mode: SurveyReportLabelMode) => {
    setLabelMode(mode)
    window.localStorage.setItem(LABEL_MODE_STORAGE_KEY, mode)
  }

  const { data, isLoading, isFetching, error, refetch } = useSmsSurveyReport(
    campaignId,
    surveyId,
  )
  const status = data?.survey.status
  const live = status === 'open' || status === 'paused'
  const questionIds = useMemo(
    () => data?.questions.map((q) => q.question_id) ?? [],
    [data?.questions],
  )
  useSmsSurveyReportRealtime(campaignId, surveyId, questionIds, live)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        {error instanceof Error ? error.message : 'Report unavailable'}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {live && (
            <Badge
              variant="secondary"
              className="bg-emerald-100 text-emerald-700"
            >
              <Radio className="mr-1 h-3 w-3" />
              Live
            </Badge>
          )}
          <span>
            Updated{' '}
            {new Date(data.generated_at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Labels</span>
          <div className="inline-flex rounded-md border p-0.5">
            {LABEL_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                title={mode.hint}
                onClick={() => chooseLabelMode(mode.id)}
                className={cn(
                  'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                  labelMode === mode.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')}
            />
            <span className="sr-only">Refresh</span>
          </Button>
        </div>
      </div>

      <HeadlineNumbers report={data} labelMode={labelMode} />

      <QuestionCharts report={data} labelMode={labelMode} />
    </div>
  )
}

function HeadlineNumbers({
  report,
  labelMode,
}: {
  report: SmsSurveyReport
  labelMode: SurveyReportLabelMode
}) {
  const funnel = report.funnel
  const invited = funnel?.ever_invited_count ?? 0
  const started = funnel?.started_count ?? 0
  const completed = funnel?.completed_count ?? 0
  const slices = participationSlices(funnel)
  const total = sliceTotal(slices)

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
      <div className="grid grid-cols-3 gap-3">
        <HeadlineCard label="Invited" value={invited} />
        <HeadlineCard
          label="Started"
          value={started}
          sub={`${formatPercent(started, invited)} of invited`}
        />
        <HeadlineCard
          label="Completed"
          value={completed}
          sub={`${formatPercent(completed, invited)} of invited`}
          accent
        />
      </div>
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-sm">Participation</CardTitle>
        </CardHeader>
        <CardContent>
          <SlicePie
            slices={slices}
            total={total}
            labelMode={labelMode}
            height={170}
            emptyText="Nobody has been invited yet"
          />
          <SliceLegend slices={slices} total={total} />
        </CardContent>
      </Card>
    </div>
  )
}

function HeadlineCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: number
  sub?: string
  accent?: boolean
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p
          className={cn(
            'text-3xl font-semibold tabular-nums',
            accent && 'text-emerald-600',
          )}
        >
          {value.toLocaleString()}
        </p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function QuestionCharts({
  report,
  labelMode,
}: {
  report: SmsSurveyReport
  labelMode: SurveyReportLabelMode
}) {
  const invited = report.funnel?.ever_invited_count ?? 0
  const isBallot = report.survey.purpose === 'indicative_ballot'
  const statsByQuestion = useMemo(
    () => new Map(report.question_stats.map((s) => [s.question_id, s])),
    [report.question_stats],
  )

  if (report.questions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        This survey has no questions.
      </p>
    )
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {report.questions.map((question, i) => {
        const stats = statsByQuestion.get(question.question_id)
        return (
          <QuestionCard
            key={question.question_id}
            index={i}
            question={question}
            slices={questionSlices(question, report.distribution, {
              completedOnly: isBallot,
            })}
            // open_text has no distribution rows (free text never
            // becomes a slice) — its answered count comes from stats.
            answered={stats?.answered_count ?? 0}
            unparsed={
              report.survey.results_restricted ? 0 : (stats?.unparsed_count ?? 0)
            }
            invited={invited}
            labelMode={labelMode}
          />
        )
      })}
    </div>
  )
}

function QuestionCard({
  index,
  question,
  slices,
  answered,
  unparsed,
  invited,
  labelMode,
}: {
  index: number
  question: SmsSurveyReportQuestion
  slices: ReportSlice[]
  answered: number
  unparsed: number
  invited: number
  labelMode: SurveyReportLabelMode
}) {
  const total = sliceTotal(slices)
  const isOpenText = question.qtype === 'open_text'
  const answeredCount = isOpenText ? answered : total

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="flex items-start gap-2 text-sm font-medium">
          <Badge variant="secondary" className="shrink-0">
            Q{index + 1}
          </Badge>
          <span className="leading-snug">{question.prompt}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isOpenText ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground">
            <MessageSquareText className="h-4 w-4 shrink-0" />
            Free-text question — export the answers CSV to read the replies.
          </div>
        ) : (
          <>
            <SlicePie
              slices={slices}
              total={total}
              labelMode={labelMode}
              height={200}
              emptyText="No answers yet"
            />
            <SliceLegend slices={slices} total={total} />
          </>
        )}
        <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
          {answeredCount.toLocaleString()} answered
          {invited > 0 && ` · ${formatPercent(answeredCount, invited)} of invited`}
          {!isOpenText &&
            unparsed > 0 &&
            ` · ${unparsed} free-text ${
              unparsed === 1 ? 'reply' : 'replies'
            } captured for a human`}
        </p>
      </CardContent>
    </Card>
  )
}

function SlicePie({
  slices,
  total,
  labelMode,
  height,
  emptyText,
}: {
  slices: ReportSlice[]
  total: number
  labelMode: SurveyReportLabelMode
  height: number
  emptyText: string
}) {
  if (slices.length === 0 || total === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-muted-foreground"
        style={{ height }}
      >
        {emptyText}
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={slices}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={height * 0.34}
          isAnimationActive={false}
          label={(props: PieLabelRenderProps) =>
            formatSliceValue(Number(props.value ?? 0), total, labelMode)
          }
        >
          {slices.map((slice) => (
            <Cell key={slice.key} fill={slice.color} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) => {
            const count = Number(value ?? 0)
            return `${count.toLocaleString()} (${formatPercent(count, total)})`
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}

function SliceLegend({
  slices,
  total,
}: {
  slices: ReportSlice[]
  total: number
}) {
  if (slices.length === 0 || total === 0) return null
  return (
    <ul className="mt-1 space-y-1">
      {slices.map((slice) => (
        <li
          key={slice.key}
          className="flex items-center gap-2 text-xs"
          title={slice.name}
        >
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: slice.color }}
          />
          <span className="truncate">{slice.name}</span>
          <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
            {slice.value.toLocaleString()} · {formatPercent(slice.value, total)}
          </span>
        </li>
      ))}
    </ul>
  )
}
