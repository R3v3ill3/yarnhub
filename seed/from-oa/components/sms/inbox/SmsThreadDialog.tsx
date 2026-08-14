'use client'

/**
 * Lightweight thread quick-view: SmsThreadView in a dialog, reused by
 * the worker-page "Message" flow and the P2P chat board (thread column
 * click) so neither needs to leave its page for a 1:1 conversation.
 *
 * Carries the "Do not contact (SMS)" control in the header (writes
 * workers.sms_opt_out source 'staff' via the shared pathway) and the
 * full member sidebar in a bottom sheet.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Ban, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useSmsConversationDetail } from '@/lib/hooks/useSmsInbox'
import {
  confirmSmsDoNotContact,
  useStaffSmsOptOut,
} from '@/lib/hooks/useSmsOptOut'
import { SmsThreadView } from './SmsThreadView'
import { SmsMemberSidebar } from './SmsMemberSidebar'
import { conversationTitle } from './sms-inbox-shared'

interface SmsThreadDialogProps {
  conversationId: number | null
  onOpenChange: (open: boolean) => void
}

export function SmsThreadDialog({
  conversationId,
  onOpenChange,
}: SmsThreadDialogProps) {
  const { data: detail } = useSmsConversationDetail(conversationId)
  const [draft, setDraft] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const staffOptOut = useStaffSmsOptOut()

  const worker = detail?.conversation.worker ?? null

  const markDoNotContact = () => {
    if (!detail || !worker || worker.sms_opt_out) return
    if (!confirmSmsDoNotContact(conversationTitle(detail.conversation))) return
    staffOptOut.mutate(
      { workerId: worker.worker_id, optOut: true },
      {
        onSuccess: () => toast.success('Member marked Do not contact (SMS)'),
        onError: (err: Error) =>
          toast.error(err.message || 'Failed to update opt-out'),
      },
    )
  }

  return (
    <Dialog
      open={conversationId != null}
      onOpenChange={(open) => {
        if (!open) setDraft('')
        onOpenChange(open)
      }}
    >
      <DialogContent className="flex h-[80vh] w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-4 py-2">
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle className="text-sm">
              {detail ? conversationTitle(detail.conversation) : 'Conversation'}
            </DialogTitle>
            {worker && !worker.sms_opt_out && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs text-red-700 hover:text-red-800"
                disabled={staffOptOut.isPending}
                title="Opts this member out of ALL SMS — blasts, surveys, chats and 1:1 replies"
                onClick={markDoNotContact}
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
        </DialogHeader>
        {detail && conversationId != null ? (
          <div className="min-h-0 flex-1">
            <SmsThreadView
              detail={detail}
              draft={draft}
              onDraftChange={setDraft}
              onBack={() => onOpenChange(false)}
              onOpenSidebar={() => setSidebarOpen(true)}
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </DialogContent>
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="bottom" className="h-[80vh] overflow-y-auto p-0">
          <SheetHeader className="border-b p-3">
            <SheetTitle className="text-sm">Member details</SheetTitle>
          </SheetHeader>
          {detail && (
            <SmsMemberSidebar
              detail={detail}
              draft={draft}
              onInsertCanned={(body) => {
                setDraft(body)
                setSidebarOpen(false)
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </Dialog>
  )
}
