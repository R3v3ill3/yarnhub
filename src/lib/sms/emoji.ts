/**
 * Curated emoji palette for SMS composers.
 *
 * One non-GSM character switches the whole message to UCS-2 (70/67
 * chars per part instead of 160/153). The picker is short on purpose.
 * Pure module — unit tested in __tests__/emoji.test.ts.
 */

export interface EmojiGroup {
  label: string;
  emoji: string[];
}

export const SMS_EMOJI_GROUPS: EmojiGroup[] = [
  {
    label: "Reactions",
    emoji: ["👍", "👎", "👏", "🙌", "💪", "✊", "🤝", "🙏"],
  },
  {
    label: "Faces",
    emoji: ["🙂", "😀", "😂", "😅", "😉", "😊", "🤔", "😬", "😡", "😢"],
  },
  {
    label: "Signals",
    emoji: ["✅", "❌", "⚠️", "❗", "❓", "🔴", "🟢", "⭐", "🔥", "💯"],
  },
  {
    label: "Planning",
    emoji: ["📅", "⏰", "📍", "📢", "📝", "📄", "☎️", "💬"],
  },
  {
    label: "Work",
    emoji: ["🛠️", "🦺", "🏭", "💰", "📈"],
  },
];

export const SMS_EMOJI_ALL: string[] = SMS_EMOJI_GROUPS.flatMap((g) => g.emoji);

export function hasEmoji(text: string): boolean {
  return /\p{Extended_Pictographic}|️|‍/u.test(text);
}
