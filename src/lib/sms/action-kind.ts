/**
 * The four SMS jobs an organisation can start. Copy leads with the
 * job, then the mechanism, matching the Offshore Alliance create
 * wizard. There is no campaign scope: every action belongs to the org.
 */

export const SMS_ACTION_KINDS = ["blast", "chat", "survey", "relay"] as const;

export type SmsActionKind = (typeof SMS_ACTION_KINDS)[number];

export interface SmsActionKindCopy {
  label: string;
  headline: string;
  description: string;
  /** Sentence fragment: "You're creating {noun}." */
  noun: string;
  editorTitle: string;
  home: string;
}

export const SMS_ACTION_KIND_COPY: Record<SmsActionKind, SmsActionKindCopy> = {
  blast: {
    label: "Blast",
    headline: "Tell everyone the same thing",
    description:
      "One message to a list. Merge fields, send window and opt-out screening; replies land in the Inbox.",
    noun: "a blast",
    editorTitle: "Compose the blast",
    home: "/blasts",
  },
  chat: {
    label: "P2P chat",
    headline: "Talk to people one at a time",
    description:
      "Work through a list a handful at a time with personalised openers. Every reply is a 1:1 thread.",
    noun: "a P2P chat",
    editorTitle: "Choose people and an opener",
    home: "/p2p",
  },
  survey: {
    label: "Survey",
    headline: "Get an answer from each person",
    description:
      "Up to five questions by reply. Answers are parsed from what they text back.",
    noun: "a survey",
    editorTitle: "Write the questions",
    home: "/surveys",
  },
  relay: {
    label: "Relay",
    headline: "Let people reach someone outside",
    description:
      "A dedicated number forwards texts to someone outside the organisation, with attribution. Neither side sees the other’s number.",
    noun: "a relay",
    editorTitle: "Set the number and who it reaches",
    home: "/relays",
  },
};

export function parseSmsActionKind(value: string | null | undefined): SmsActionKind | null {
  if (!value) return null;
  return (SMS_ACTION_KINDS as readonly string[]).includes(value)
    ? (value as SmsActionKind)
    : null;
}
