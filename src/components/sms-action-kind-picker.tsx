"use client";

import {
  ArrowRightLeft,
  CheckCircle2,
  ClipboardList,
  MessagesSquare,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SMS_ACTION_KIND_COPY,
  SMS_ACTION_KINDS,
  type SmsActionKind,
} from "@/lib/sms/action-kind";

const ICONS: Record<SmsActionKind, typeof Send> = {
  blast: Send,
  chat: MessagesSquare,
  survey: ClipboardList,
  relay: ArrowRightLeft,
};

const TONES: Record<SmsActionKind, string> = {
  blast: "text-sky-600",
  chat: "text-emerald-600",
  survey: "text-violet-600",
  relay: "text-amber-600",
};

export function SmsActionKindPicker({
  value,
  onChange,
}: {
  value: SmsActionKind | null;
  onChange: (kind: SmsActionKind) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Kind of SMS action"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      {SMS_ACTION_KINDS.map((kind) => {
        const copy = SMS_ACTION_KIND_COPY[kind];
        const Icon = ICONS[kind];
        const selected = value === kind;
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={selected}
            className={cn(
              "rounded-lg border-2 bg-card p-4 text-left shadow-sm transition-colors",
              selected
                ? "border-primary bg-primary/5"
                : "border-border hover:border-foreground/20",
            )}
            onClick={() => onChange(kind)}
          >
            <span className="flex items-start justify-between">
              <Icon className={cn("h-7 w-7", TONES[kind])} aria-hidden />
              {selected ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-hidden />
              ) : (
                <span className="h-5 w-5" />
              )}
            </span>
            <span className="mt-3 block text-sm font-semibold">{copy.headline}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{copy.label}</span>
            <span className="mt-3 block text-xs leading-relaxed text-muted-foreground">
              {copy.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
