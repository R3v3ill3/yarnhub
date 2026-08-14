'use client'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export function SmsOrgNameWarningDialog({
  open,
  onOpenChange,
  onConfirm,
  confirmLabel = 'Continue without it',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  confirmLabel?: string
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Message does not name Offshore Alliance
          </AlertDialogTitle>
          <AlertDialogDescription>
            Many conversations are between organisers and members who already
            know each other, so naming the organisation in every opener is
            unnecessary. Include &ldquo;Offshore Alliance&rdquo; for first-contact
            or cold outreach so the recipient knows who is texting.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Go back</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
