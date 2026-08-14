'use client'

/**
 * P2P chat board (the 'chat' pathway): the organiser has loaded a full
 * working list and now progressively selects individuals or subsets
 * (search/filter, checkboxes, "select next N") and fires the
 * personalised initial to just those — start with 5–10, add more as
 * the session progresses. Each row defaults to the board opener; click
 * a person to customise theirs (including adding/removing merge fields)
 * before sending.
 *
 * Sends have no blackout hard-block (organiser-judgement sends — a
 * soft warning banner shows outside 09:00–20:00 board-timezone);
 * opted-out members are hard-skipped and grey out immediately. Replies
 * flow into the shared Inbox automatically (thread-key match); the
 * thread column shows the linked conversation state and opens the
 * thread quick-view.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Ban,
  CheckSquare,
  Loader2,
  MessageSquare,
  Pencil,
  RefreshCw,
  Send,
  Square,
  UserPlus,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toDisplay } from '@/lib/phone/normalise-phone'
import { ALL_TEMPLATE_VARIABLES } from '@/lib/comms/template-variables'
import { isWithinSendWindow } from '@/lib/sms/blackout'
import { countSegments } from '@/lib/sms/segments'
import { validateSmsBody } from '@/lib/sms/compliance'
import {
  P2P_SEND_CAP,
  filterP2pItems,
  isP2pSendable,
  p2pItemTemplate,
  pruneP2pSelection,
  renderP2pBody,
  selectNextN,
} from '@/lib/sms/p2p'
import {
  useSmsP2pAddPeople,
  useSmsP2pBoard,
  useSmsP2pClose,
  useSmsP2pSend,
  useSmsP2pSetItemBody,
} from '@/lib/hooks/useSmsP2p'
import {
  confirmSmsDoNotContact,
  useStaffSmsOptOut,
} from '@/lib/hooks/useSmsOptOut'
import { SmsThreadDialog } from '@/components/sms/inbox/SmsThreadDialog'
import { CONVERSATION_STATE_COLORS } from '@/components/sms/inbox/sms-inbox-shared'
import {
  AudiencePicker,
  type AudienceValue,
} from '@/components/audience/AudiencePicker'
import { STANDALONE_AUDIENCE_PICKER } from '@/lib/sms/audience-helpers'
import type { SmsP2pBoardItem } from '@/types/sms'

const ITEM_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700',
  sending: 'bg-blue-100 text-blue-700',
  sent: 'bg-blue-100 text-blue-700',
  delivered: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-slate-100 text-slate-500',
  opted_out: 'bg-amber-100 text-amber-800',
  blocked: 'bg-amber-100 text-amber-800',
}

const STATUS_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Not messaged' },
  { value: 'sent', label: 'Messaged' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'failed', label: 'Failed' },
  { value: 'opted_out', label: 'Opted out' },
  { value: 'skipped', label: 'Skipped' },
]

interface SmsP2pBoardProps {
  campaignId: string
  listId: number
  standaloneMode?: boolean
}

export function SmsP2pBoard({
  campaignId,
  listId,
  standaloneMode = false,
}: SmsP2pBoardProps) {
  const { data: board, isLoading, isFetching, refetch } = useSmsP2pBoard(
    campaignId,
    listId,
  )
  const send = useSmsP2pSend(campaignId, listId)
  const addPeople = useSmsP2pAddPeople(campaignId, listId)
  const closeBoard = useSmsP2pClose(campaignId, listId)
  const setItemBody = useSmsP2pSetItemBody(campaignId, listId)
  const staffOptOut = useStaffSmsOptOut()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [nextN, setNextN] = useState('10')
  const [threadId, setThreadId] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<SmsP2pBoardItem | null>(null)

  const items = useMemo(() => board?.items ?? [], [board])
  const filtered = useMemo(
    () => filterP2pItems(items, { search, status: statusFilter }),
    [items, search, statusFilter],
  )
  // Selection survives refetches but drops rows that stopped being
  // sendable (sent meanwhile / opted out).
  const liveSelection = useMemo(
    () => pruneP2pSelection(items, selected),
    [items, selected],
  )

  const template = board?.draft?.body ?? ''
  const mergeContext = useMemo(
    () => board?.merge_context ?? {},
    [board],
  )
  const preview = (item: SmsP2pBoardItem) =>
    renderP2pBody(p2pItemTemplate(template, item.body_override), {
      ...mergeContext,
      first_name: item.first_name,
      last_name: item.last_name,
      occupation: item.occupation ?? undefined,
      employer_name: item.employer_name ?? mergeContext.employer_name,
    })

  const boardClosed = board != null && board.list.status !== 'draft'
  const outsideWindow =
    board != null && !isWithinSendWindow(new Date(), board.list.timezone)

  const runSend = (itemIds: number[]) => {
    if (itemIds.length === 0) return
    send.mutate(itemIds, {
      onSuccess: (res) => {
        const notes: string[] = []
        if (res.failed > 0) notes.push(`${res.failed} failed`)
        if (res.blocked > 0) notes.push(`${res.blocked} blocked`)
        if (res.opted_out > 0) notes.push(`${res.opted_out} opted out`)
        if (res.skipped > 0) notes.push(`${res.skipped} skipped`)
        toast.success(
          `Sent ${res.sent} initial${res.sent === 1 ? '' : 's'}${
            notes.length ? ` (${notes.join(', ')})` : ''
          }`,
        )
        setSelected(new Set())
      },
      onError: (err: Error) => toast.error(err.message),
    })
  }

  const markDoNotContact = (item: SmsP2pBoardItem) => {
    if (!confirmSmsDoNotContact(item.worker_name)) return
    staffOptOut.mutate(
      { workerId: item.worker_id, optOut: true },
      {
        onSuccess: () =>
          toast.success(`${item.worker_name} marked Do not contact (SMS)`),
        onError: (err: Error) =>
          toast.error(err.message || 'Failed to update opt-out'),
      },
    )
  }

  const toggleRow = (item: SmsP2pBoardItem) => {
    if (!isP2pSendable(item)) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(item.item_id)) next.delete(item.item_id)
      else if (next.size < P2P_SEND_CAP) next.add(item.item_id)
      else toast.warning(`Selection is capped at ${P2P_SEND_CAP} per send`)
      return next
    })
  }

  const selectAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const item of filtered) {
        if (next.size >= P2P_SEND_CAP) {
          toast.warning(`Selection is capped at ${P2P_SEND_CAP} per send`)
          break
        }
        if (isP2pSendable(item)) next.add(item.item_id)
      }
      return next
    })
  }

  if (isLoading || !board) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const sentCount = items.filter((i) =>
    ['sent', 'delivered'].includes(i.status),
  ).length
  const pendingCount = items.filter((i) => isP2pSendable(i)).length

  return (
    <div className="space-y-3">
      {/* Header line */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{board.list.name}</p>
          <p className="text-xs text-muted-foreground">
            via{' '}
            {board.list.sender_label ||
              (board.list.sender_phone_e164
                ? toDisplay(board.list.sender_phone_e164)
                : 'no sender')}{' '}
            · {sentCount}/{items.length} messaged · {pendingCount} to go
            {' · '}auto-refreshes every 10s
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={isFetching}
          title="Reload replies and send status now"
          onClick={() => void refetch()}
        >
          <RefreshCw
            className={`mr-1 h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={boardClosed || addPeople.isPending}
          onClick={() => setAddOpen(true)}
        >
          <UserPlus className="mr-1 h-3.5 w-3.5" />
          Add people
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive"
          disabled={boardClosed || closeBoard.isPending}
          title="Close the board — remaining unsent rows are skipped; existing threads stay open in the Inbox"
          onClick={() => {
            if (
              window.confirm(
                'Close this chat board? Rows not yet messaged will be skipped. Existing threads stay open in the Inbox.',
              )
            ) {
              closeBoard.mutate(undefined, {
                onSuccess: () => toast.success('Chat board closed'),
                onError: (err: Error) => toast.error(err.message),
              })
            }
          }}
        >
          <XCircle className="mr-1 h-3.5 w-3.5" />
          Close board
        </Button>
      </div>

      {boardClosed && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          This board is closed — threads remain workable from the Inbox.
        </p>
      )}

      {/* Soft blackout warning — no hard block for board sends. */}
      {!boardClosed && outsideWindow && (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          It is outside the 9am–8pm window ({board.list.timezone}). Board sends
          are not blocked — use your judgement before messaging members at this
          hour.
        </p>
      )}

      {/* Filters + selection controls */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          className="h-8 w-48 text-xs"
          placeholder="Search name, employer, phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          disabled={boardClosed}
          onClick={selectAllFiltered}
        >
          <CheckSquare className="mr-1 h-3.5 w-3.5" />
          Select filtered
        </Button>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={boardClosed}
            onClick={() => {
              const n = parseInt(nextN, 10)
              if (!Number.isFinite(n) || n <= 0) return
              setSelected(selectNextN(filtered, liveSelection, n))
            }}
          >
            Select next
          </Button>
          <Input
            className="h-8 w-14 text-xs"
            type="number"
            min={1}
            max={P2P_SEND_CAP}
            value={nextN}
            onChange={(e) => setNextN(e.target.value)}
          />
        </div>
        {liveSelection.size > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => setSelected(new Set())}
          >
            <Square className="mr-1 h-3.5 w-3.5" />
            Clear
          </Button>
        )}
        <Button
          size="sm"
          className="ml-auto h-8 text-xs"
          disabled={boardClosed || liveSelection.size === 0 || send.isPending}
          onClick={() => runSend([...liveSelection])}
        >
          {send.isPending ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="mr-1 h-3.5 w-3.5" />
          )}
          Send to selected ({liveSelection.size})
        </Button>
      </div>

      {/* Working-list table */}
      <div className="max-h-[55vh] divide-y overflow-y-auto rounded-md border">
        {filtered.length === 0 && (
          <p className="p-4 text-center text-xs text-muted-foreground">
            No rows match — clear the search or add people to the board.
          </p>
        )}
        {filtered.map((item) => {
          const sendable = isP2pSendable(item) && !boardClosed
          const greyed = item.sms_opt_out || item.status === 'opted_out'
          return (
            <div
              key={item.item_id}
              className={`flex items-start gap-2 px-3 py-2 text-sm ${
                greyed ? 'opacity-50' : ''
              }`}
            >
              <Checkbox
                className="mt-0.5"
                checked={liveSelection.has(item.item_id)}
                disabled={!sendable}
                onCheckedChange={() => toggleRow(item)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{item.worker_name}</span>
                  {item.employer_name && (
                    <span className="text-xs text-muted-foreground">
                      {item.employer_name}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {item.phone_e164 ? toDisplay(item.phone_e164) : 'no mobile'}
                  </span>
                  <Badge
                    variant="secondary"
                    className={`text-[10px] ${ITEM_STATUS_COLORS[item.status] || ''}`}
                  >
                    {item.status.replace('_', ' ')}
                  </Badge>
                  {item.body_override && isP2pSendable(item) && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] bg-indigo-50 text-indigo-700"
                    >
                      Customised
                    </Badge>
                  )}
                  {item.conversation_id != null && item.conversation_state && (
                    <button
                      type="button"
                      title="Open the thread"
                      onClick={() => setThreadId(item.conversation_id)}
                    >
                      <Badge
                        variant="secondary"
                        className={`cursor-pointer text-[10px] ${
                          CONVERSATION_STATE_COLORS[item.conversation_state] || ''
                        }`}
                      >
                        <MessageSquare className="mr-0.5 h-2.5 w-2.5" />
                        {item.conversation_state.replace('_', ' ')}
                        {item.unread_count > 0 ? ` · ${item.unread_count}` : ''}
                      </Badge>
                    </button>
                  )}
                  {item.sent_at && (
                    <span className="text-[10px] text-muted-foreground">
                      sent{' '}
                      {formatDistanceToNow(new Date(item.sent_at), {
                        addSuffix: true,
                      })}
                    </span>
                  )}
                </div>
                {isP2pSendable(item) && template && (
                  <button
                    type="button"
                    className="mt-0.5 block w-full truncate text-left text-xs text-muted-foreground hover:text-foreground"
                    title={
                      boardClosed
                        ? preview(item)
                        : 'Click to customise this opener'
                    }
                    disabled={boardClosed}
                    onClick={() => setEditingItem(item)}
                  >
                    {preview(item)}
                  </button>
                )}
                {item.failure_reason && (
                  <p className="mt-0.5 text-xs text-red-600">
                    {item.failure_reason}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {sendable && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    title="Customise this person's opener"
                    onClick={() => setEditingItem(item)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                )}
                {sendable && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    disabled={send.isPending}
                    title="Send the initial to just this member"
                    onClick={() => runSend([item.item_id])}
                  >
                    <Send className="h-3 w-3" />
                  </Button>
                )}
                {!item.sms_opt_out && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-red-700"
                    disabled={staffOptOut.isPending}
                    title="Do not contact (SMS) — opts this member out of ALL SMS"
                    onClick={() => markDoNotContact(item)}
                  >
                    <Ban className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <SmsThreadDialog
        conversationId={threadId}
        onOpenChange={(open) => {
          if (!open) setThreadId(null)
        }}
      />

      <EditInitialDialog
        item={editingItem}
        boardTemplate={template}
        mergeContext={mergeContext}
        pending={setItemBody.isPending}
        onOpenChange={(open) => {
          if (!open) setEditingItem(null)
        }}
        onSave={(body) => {
          if (!editingItem) return
          setItemBody.mutate(
            { itemId: editingItem.item_id, body },
            {
              onSuccess: (res) => {
                toast.success(
                  res.body_override
                    ? `Opener customised for ${editingItem.worker_name}`
                    : `Using the board message for ${editingItem.worker_name}`,
                )
                setEditingItem(null)
              },
              onError: (err: Error) => toast.error(err.message),
            },
          )
        }}
      />

      <AddPeopleDialog
        campaignId={campaignId}
        standaloneMode={standaloneMode}
        open={addOpen}
        onOpenChange={setAddOpen}
        pending={addPeople.isPending}
        onSubmit={(input) =>
          addPeople.mutate(input, {
            onSuccess: (res) => {
              toast.success(
                `Added ${res.added} ${res.added === 1 ? 'person' : 'people'}${
                  res.already_on_board > 0
                    ? ` (${res.already_on_board} already on the board)`
                    : ''
                }`,
              )
              setAddOpen(false)
            },
            onError: (err: Error) => toast.error(err.message),
          })
        }
      />
    </div>
  )
}

function EditInitialDialog({
  item,
  boardTemplate,
  mergeContext,
  pending,
  onOpenChange,
  onSave,
}: {
  item: SmsP2pBoardItem | null
  boardTemplate: string
  mergeContext: Record<string, string | undefined>
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSave: (body: string) => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [body, setBody] = useState('')

  useEffect(() => {
    if (!item) return
    setBody(p2pItemTemplate(boardTemplate, item.body_override))
  }, [item, boardTemplate])

  const preview = item
    ? renderP2pBody(body, {
        ...mergeContext,
        first_name: item.first_name,
        last_name: item.last_name,
        occupation: item.occupation ?? undefined,
        employer_name: item.employer_name ?? mergeContext.employer_name,
      })
    : ''
  const segments = countSegments(preview)
  const compliance = validateSmsBody(body)
  const differsFromDefault = body.trim() !== boardTemplate.trim()

  const insertToken = (token: string) => {
    const insert = `{{${token}}}`
    const el = textareaRef.current
    if (!el) {
      setBody((prev) => prev + insert)
      return
    }
    const start = el.selectionStart ?? body.length
    const end = el.selectionEnd ?? start
    const next = body.slice(0, start) + insert + body.slice(end)
    setBody(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + insert.length, start + insert.length)
    })
  }

  return (
    <Dialog open={item != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Customise opener{item ? ` — ${item.worker_name}` : ''}
          </DialogTitle>
          <DialogDescription>
            Defaults to the board message. You can rewrite it, drop merge
            fields, or type a one-off note. Tokens still resolve when you send.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="p2p-item-body">Initiating message</Label>
            <Textarea
              id="p2p-item-body"
              ref={textareaRef}
              rows={6}
              disabled={pending}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="flex flex-wrap gap-1">
              {ALL_TEMPLATE_VARIABLES.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  disabled={pending}
                  title={v.description}
                  className="rounded-full border bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/70 disabled:opacity-50"
                  onClick={() => insertToken(v.key)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {segments.length} chars · {segments.segments}{' '}
            {segments.segments === 1 ? 'part' : 'parts'} ({segments.encoding})
            after merge fields
          </p>
          {!compliance.hasOrgName && (
            <p className="flex items-start gap-1 text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              Organisation name optional for known contacts — include
              &quot;Offshore Alliance&quot; for first-contact or cold outreach.
            </p>
          )}
          {preview && (
            <div className="rounded-md border bg-muted/30 p-2">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Sends as
              </p>
              <p className="whitespace-pre-wrap text-sm">{preview}</p>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={pending || !differsFromDefault}
            onClick={() => setBody(boardTemplate)}
          >
            Use board default
          </Button>
          <Button
            disabled={pending}
            onClick={() => onSave(body)}
          >
            {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save opener
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Mid-session additions: reuse the shared AudiencePicker (saved lists,
 * whole campaign, manual add + CSV import) and translate its value to
 * the add-people endpoint (dedupe on UNIQUE(list_id, worker_id)).
 */
function AddPeopleDialog({
  campaignId,
  standaloneMode = false,
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  campaignId: string
  standaloneMode?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onSubmit: (input: {
    worker_ids?: number[]
    audience?: { type: 'worker_list'; worker_list_id: number } | { type: 'campaign' }
  }) => void
}) {
  const [audience, setAudience] = useState<AudienceValue>({
    mode: 'composed',
    worker_ids: [],
  })

  const submit = () => {
    if (audience.mode === 'campaign') {
      onSubmit({ audience: { type: 'campaign' } })
    } else if (audience.mode === 'worker_list') {
      onSubmit({
        audience: {
          type: 'worker_list',
          worker_list_id: audience.worker_list_id,
        },
      })
    } else {
      onSubmit({ worker_ids: audience.worker_ids })
    }
  }

  const emptyComposed =
    audience.mode === 'composed' && audience.worker_ids.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add people to the board</DialogTitle>
          <DialogDescription>
            People already on the board are skipped; opted-out members and
            members without a mobile are added but not sendable.
          </DialogDescription>
        </DialogHeader>
        <AudiencePicker
          channel="sms"
          campaignId={campaignId}
          value={audience}
          onChange={setAudience}
          disabled={pending}
          {...(standaloneMode ? STANDALONE_AUDIENCE_PICKER : {})}
        />
        <DialogFooter>
          <Button disabled={pending || emptyComposed} onClick={submit}>
            {pending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="mr-1.5 h-4 w-4" />
            )}
            Add to board
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
