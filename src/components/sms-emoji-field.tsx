"use client";

import { SMS_EMOJI_GROUPS, hasEmoji } from "@/lib/sms/emoji";
import { countSegmentsWorstCase } from "@/lib/sms/segments";

export function SmsEmojiField(props: {
  body: string;
  onInsert: (emoji: string) => void;
}) {
  const segments = countSegmentsWorstCase(props.body);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {SMS_EMOJI_GROUPS.flatMap((group) => group.emoji).map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="rounded border border-border px-1.5 py-0.5 text-base hover:bg-accent"
            aria-label={`Insert ${emoji}`}
            onClick={() => props.onInsert(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {segments.encoding} · {segments.segments} {segments.segments === 1 ? "part" : "parts"} ·{" "}
        {segments.remaining} characters left in this part
        {hasEmoji(props.body)
          ? " · An emoji switches the whole message to UCS-2, so each part holds fewer characters."
          : ""}
      </p>
    </div>
  );
}
