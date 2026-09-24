import { demoId, REDGUM_DEMO_KEY } from "@/lib/demo/demo-id";
import { ACMA_FICTION_MOBILES } from "@/lib/demo/fiction-phones";
import { composeForwardBody } from "@/lib/sms/relay-engine";

/**
 * Fictional Pilbara iron-ore bargaining campaign.
 * Employer: Redgum Resources, site Redgum Ridge.
 * Sender identity in the copy: Mineworkers Union.
 * Every phone is an ACMA fiction mobile — not a live service.
 */

export const REDGUM_DEMO_NOTE = `demo:${REDGUM_DEMO_KEY}`;
export const DEMO_PROVIDER_CIPHERTEXT = "demo:not-a-real-mobile-message-account";

const PETITION_URL = "https://example.com/redgum-majority-support";

export const REDGUM_BLAST_BODY = `Mineworkers Union: Redgum Resources has refused to bargain on our log of claims. Wages, safe crewing and permanency are still unresolved — they will not sit down.

Sign the majority support petition (hypothetical): ${PETITION_URL}

Reply YES if you have signed. Reply STOP to opt out.`;

export const P2P_STEPS = [
  {
    key: "intro",
    title: "1. Introductory text",
    template:
      "Hi {{first_name}}, it's Mina from the Mineworkers Union at Redgum Ridge. I'm talking with operators about bargaining. Have you got two minutes for a yarn about what the pit needs? Reply STOP to opt out.",
  },
  {
    key: "agitation",
    title: "2. Wages and safety",
    template:
      "{{first_name}}, the last rise didn't cover a week on site, and nights are still short-crewed. A truck went down last month after a rushed prestart. Does that match your shift? — Mineworkers Union. Reply STOP to opt out.",
  },
  {
    key: "hope",
    title: "3. Surging interest",
    template:
      "{{first_name}}, you are not on your own. Forty people in the pit have asked for a chat this fortnight, and the log of claims survey is filling up. Management has noticed. Want me to keep you in the loop? — Mineworkers Union",
  },
  {
    key: "cta",
    title: "4. List and join",
    template:
      "{{first_name}}, two things move this: your classification and shift, so the list is accurate, and one workmate who should be in the union. Reply with both if you can. — Mineworkers Union. Reply STOP to opt out.",
  },
] as const;

const CLAIM_OPTIONS = [
  { value: "wages", label: "Wages", synonyms: ["1", "pay"] },
  { value: "safety", label: "Safety", synonyms: ["2", "crewing"] },
  { value: "rosters", label: "Rosters", synonyms: ["3"] },
  { value: "security", label: "Permanency", synonyms: ["4", "permanency", "job security"] },
];

type MemberKey =
  | "priya"
  | "tom"
  | "jess"
  | "dale"
  | "rina"
  | "chris"
  | "mo"
  | "aisha"
  | "lee"
  | "nina"
  | "pete"
  | "holly"
  | "jack"
  | "erin"
  | "ben"
  | "cara"
  | "owen"
  | "maya"
  | "luke"
  | "noor";

type Member = {
  key: MemberKey;
  first: string;
  last: string;
  phone: string;
  notes: string;
  optOut?: boolean;
};

function at(now: Date, daysAgo: number, hourUtc: number, minute = 0): string {
  const d = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  d.setUTCHours(hourUtc, minute, 0, 0);
  return d.toISOString();
}

function fill(template: string, first: string): string {
  return template.replaceAll("{{first_name}}", first);
}

function phones() {
  const [
    membersLine,
    hr,
    priya,
    tom,
    jess,
    outreach,
    survey,
    relay,
    dale,
    rina,
    chris,
    mo,
    aisha,
    lee,
    nina,
    pete,
    holly,
    jack,
    erin,
    ben,
    cara,
    owen,
    maya,
    luke,
    noor,
  ] = ACMA_FICTION_MOBILES;
  return {
    membersLine,
    hr,
    outreach,
    survey,
    relay,
    member: {
      priya,
      tom,
      jess,
      dale,
      rina,
      chris,
      mo,
      aisha,
      lee,
      nina,
      pete,
      holly,
      jack,
      erin,
      ben,
      cara,
      owen,
      maya,
      luke,
      noor,
    } as Record<MemberKey, string>,
  };
}

export interface RedgumDemoPlan {
  marker: string;
  senderPhones: string[];
  provider: {
    id: string;
    organisation_id: string;
    provider: "mobile_message";
    mode: "byo";
    credentials_ciphertext: string;
  } | null;
  numbers: Array<{
    id: string;
    organisation_id: string;
    provider_account_id: string;
    phone_e164: string;
    purpose: "inbox" | "survey" | "relay";
    status: "active";
    label: string;
    created_at: string;
  }>;
  contacts: Array<Record<string, unknown>>;
  lists: Array<Record<string, unknown>>;
  listMembers: Array<Record<string, unknown>>;
  canned: Array<Record<string, unknown>>;
  blasts: Array<Record<string, unknown>>;
  blastItems: Array<Record<string, unknown>>;
  sendLogs: Array<Record<string, unknown>>;
  deliveryEvents: Array<Record<string, unknown>>;
  p2pSends: Array<Record<string, unknown>>;
  p2pItems: Array<Record<string, unknown>>;
  surveys: Array<Record<string, unknown>>;
  questions: Array<Record<string, unknown>>;
  sessions: Array<Record<string, unknown>>;
  answers: Array<Record<string, unknown>>;
  relays: Array<Record<string, unknown>>;
  relayTargets: Array<Record<string, unknown>>;
  relayMessages: Array<Record<string, unknown>>;
  conversations: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  notes: Array<Record<string, unknown>>;
}

export function buildRedgumPlan(
  orgId: string,
  userId: string,
  now = new Date(),
): RedgumDemoPlan {
  const id = (key: string) => demoId(orgId, key);
  const p = phones();
  const created = at(now, 21, 1);

  const numberIds = {
    members: id("number:members"),
    outreach: id("number:outreach"),
    survey: id("number:survey"),
    relay: id("number:relay"),
  };
  const providerId = id("provider");

  const members: Member[] = [
    ["priya", "Priya", "Nair", "Level 4 operator, nights. Signed the petition and named her offsider."],
    ["tom", "Tom", "Callaghan", "Fitter. Engaged on pay and crewing. Will not put a workmate's name in a text yet."],
    ["jess", "Jess", "Okonkwo", "Dump truck, nights. Mid survey. Says prestart is rushed."],
    ["dale", "Dale", "Hargreaves", "Haul truck. Asked to be texted after shift."],
    ["rina", "Rina", "Patel", "Level 3 operator, days. Gave classification and a workmate to join."],
    ["chris", "Chris", "Bui", "Survey invited. No reply to the intro yet."],
    ["mo", "Mo", "Ibrahim", "Opted out by STOP. Do not text."],
    ["aisha", "Aisha", "Rahman", "Wants the log of claims in a text she can forward."],
    ["lee", "Lee", "Thompson", "Survey expired without an answer."],
    ["nina", "Nina", "Brooks", "Invited to the log of claims survey. Has not started."],
    ["pete", "Pete", "Wallace", "Supports the claims. Not ready to sign the petition."],
    ["holly", "Holly", "Grant", "Part-way through the survey. Safety is her claim."],
    ["jack", "Jack", "Moretti", "Blast failed — handset unreachable."],
    ["erin", "Erin", "Walsh", "Survey invite expired."],
    ["ben", "Ben", "Okada", "Blast failed — number unavailable."],
    ["cara", "Cara", "Singh", "Survey marked undeliverable."],
    ["owen", "Owen", "Blake", "Asked when the next shift meeting is."],
    ["maya", "Maya", "Costa", "Signed the petition from the blast."],
    ["luke", "Luke", "Fraser", "Does not support the log of claims."],
    ["noor", "Noor", "Haddad", "Left site in March. Intro only."],
  ].map(([key, first, last, notes]) => ({
    key: key as MemberKey,
    first: first as string,
    last: last as string,
    phone: p.member[key as MemberKey],
    notes: `${REDGUM_DEMO_NOTE} — ${notes}`,
    optOut: key === "mo",
  }));

  const contactId = (key: MemberKey) => id(`contact:${key}`);

  const contacts = members.map((m) => ({
    id: contactId(m.key),
    organisation_id: orgId,
    first_name: m.first,
    last_name: m.last,
    phone_e164: m.phone,
    sms_opt_out: Boolean(m.optOut),
    sms_opt_out_at: m.optOut ? at(now, 18, 6) : null,
    sms_opt_out_source: m.optOut ? "stop" : null,
    sms_consent_source: "import" as const,
    notes: m.notes,
    created_at: created,
  }));

  const listCrew = id("list:crew");
  const listOutreach = id("list:outreach");
  const listSurvey = id("list:survey");
  const lists = [
    { id: listCrew, organisation_id: orgId, name: "Redgum Ridge crew", created_at: created },
    { id: listOutreach, organisation_id: orgId, name: "Outreach — bargaining yarn", created_at: created },
    { id: listSurvey, organisation_id: orgId, name: "Log of claims survey", created_at: created },
  ];

  const outreachKeys: MemberKey[] = ["priya", "tom", "jess", "dale", "rina", "chris", "noor"];
  const surveyKeys: MemberKey[] = [
    "priya", "tom", "jess", "dale", "rina", "chris", "mo", "aisha", "lee", "nina",
    "pete", "holly", "erin", "ben", "cara", "owen", "luke",
  ];
  const listMembers = [
    ...members.map((m) => ({
      list_id: listCrew,
      contact_id: contactId(m.key),
      organisation_id: orgId,
      created_at: created,
    })),
    ...outreachKeys.map((key) => ({
      list_id: listOutreach,
      contact_id: contactId(key),
      organisation_id: orgId,
      created_at: created,
    })),
    ...surveyKeys.map((key) => ({
      list_id: listSurvey,
      contact_id: contactId(key),
      organisation_id: orgId,
      created_at: created,
    })),
  ];

  const canned = [
    {
      id: id("canned:petition"),
      organisation_id: orgId,
      title: "Petition link",
      body: `Here's the majority support petition again (hypothetical): ${PETITION_URL} — Mineworkers Union`,
      created_by: userId,
      created_at: created,
    },
    {
      id: id("canned:classification"),
      organisation_id: orgId,
      title: "Classification",
      body: "When you can, reply with your classification and shift so the list is accurate. — Mina, Mineworkers Union",
      created_by: userId,
      created_at: created,
    },
    {
      id: id("canned:meeting"),
      organisation_id: orgId,
      title: "Shift meeting",
      body: "Next yarn is Thursday after day shift, crib hut 2. Come if you can. — Mineworkers Union",
      created_by: userId,
      created_at: created,
    },
  ];

  const numbers = [
    {
      id: numberIds.members,
      organisation_id: orgId,
      provider_account_id: providerId,
      phone_e164: p.membersLine,
      purpose: "inbox" as const,
      status: "active" as const,
      label: "Members line",
      created_at: created,
    },
    {
      id: numberIds.outreach,
      organisation_id: orgId,
      provider_account_id: providerId,
      phone_e164: p.outreach,
      purpose: "inbox" as const,
      status: "active" as const,
      label: "Outreach line",
      created_at: created,
    },
    {
      id: numberIds.survey,
      organisation_id: orgId,
      provider_account_id: providerId,
      phone_e164: p.survey,
      purpose: "survey" as const,
      status: "active" as const,
      label: "Claims survey",
      created_at: created,
    },
    {
      id: numberIds.relay,
      organisation_id: orgId,
      provider_account_id: providerId,
      phone_e164: p.relay,
      purpose: "relay" as const,
      status: "active" as const,
      label: "HR bargain line",
      created_at: created,
    },
  ];

  const blastId = id("blast:refusal");
  const blastSentAt = at(now, 1, 2, 15);
  type BlastOutcome = {
    key: MemberKey;
    status: "sent" | "failed" | "opted_out" | "skipped";
    logStatus?: "delivered" | "failed";
    failure?: string;
  };
  const blastOutcomes: BlastOutcome[] = [
    ...(["priya", "tom", "jess", "dale", "rina", "chris", "noor", "aisha", "pete", "owen", "luke", "maya"] as MemberKey[]).map(
      (key) => ({ key, status: "sent" as const, logStatus: "delivered" as const }),
    ),
    { key: "jack", status: "failed", logStatus: "failed", failure: "Handset unreachable" },
    { key: "ben", status: "failed", logStatus: "failed", failure: "Number unavailable" },
    { key: "mo", status: "opted_out" },
    { key: "cara", status: "skipped", failure: "Undeliverable on the last attempt" },
  ];

  const blasts = [
    {
      id: blastId,
      organisation_id: orgId,
      name: "Management refuses to bargain",
      body: REDGUM_BLAST_BODY,
      sender_number_id: numberIds.outreach,
      timezone: "Australia/Perth",
      blackout_override: false,
      status: "sent",
      created_by: userId,
      queued_at: at(now, 1, 2),
      completed_at: blastSentAt,
      created_at: at(now, 2, 4),
    },
  ];

  const blastItems = blastOutcomes.map((row, index) => ({
    id: id(`blast-item:${row.key}`),
    organisation_id: orgId,
    blast_id: blastId,
    contact_id: contactId(row.key),
    phone_e164: p.member[row.key],
    sort_order: index,
    status: row.status,
    provider_message_id: row.logStatus ? `demo:blast:${row.key}` : null,
    sent_at: row.status === "sent" ? blastSentAt : null,
    failure_reason: row.failure ?? null,
  }));

  const sendLogs = blastOutcomes
    .filter((row) => row.logStatus)
    .map((row) => ({
      id: id(`send-log:blast:${row.key}`),
      organisation_id: orgId,
      blast_id: blastId,
      blast_item_id: id(`blast-item:${row.key}`),
      contact_id: contactId(row.key),
      phone_e164: p.member[row.key],
      body: REDGUM_BLAST_BODY,
      segments: 3,
      status: row.logStatus,
      provider_message_id: `demo:blast:${row.key}`,
      sent_at: row.logStatus === "delivered" ? blastSentAt : null,
      failed_at: row.logStatus === "failed" ? blastSentAt : null,
      failure_reason: row.failure ?? null,
      created_at: blastSentAt,
    }));

  const deliveryEvents = sendLogs
    .filter((row) => row.status === "delivered")
    .map((row) => ({
      id: id(`delivery:${String(row.provider_message_id)}`),
      organisation_id: orgId,
      send_log_id: row.id,
      provider_message_id: row.provider_message_id,
      status: "delivered",
      occurred_at: blastSentAt,
      created_at: blastSentAt,
    }));

  const stepKeys: Record<(typeof P2P_STEPS)[number]["key"], MemberKey[]> = {
    intro: outreachKeys,
    agitation: ["priya", "tom", "jess", "rina"],
    hope: ["priya", "tom", "rina"],
    cta: ["priya", "tom", "rina"],
  };
  const stepWhen: Record<(typeof P2P_STEPS)[number]["key"], string> = {
    intro: at(now, 8, 1),
    agitation: at(now, 6, 1, 20),
    hope: at(now, 4, 1, 40),
    cta: at(now, 2, 3),
  };

  const p2pSends = P2P_STEPS.map((step) => ({
    id: id(`p2p:${step.key}`),
    organisation_id: orgId,
    sender_number_id: numberIds.outreach,
    body_template: step.template,
    timezone: "Australia/Perth",
    blackout_override: false,
    status: "sent",
    created_by: userId,
    queued_at: stepWhen[step.key],
    completed_at: stepWhen[step.key],
    created_at: stepWhen[step.key],
  }));

  const p2pItems = P2P_STEPS.flatMap((step) =>
    stepKeys[step.key].map((key, index) => {
      const member = members.find((m) => m.key === key)!;
      return {
        id: id(`p2p-item:${step.key}:${key}`),
        organisation_id: orgId,
        send_id: id(`p2p:${step.key}`),
        contact_id: contactId(key),
        phone_e164: member.phone,
        body: fill(step.template, member.first),
        sort_order: index,
        status: "sent",
        provider_message_id: `demo:p2p:${step.key}:${key}`,
        sent_at: stepWhen[step.key],
        conversation_id: id(`conv:outreach:${key}`),
      };
    }),
  );

  const surveyId = id("survey:claims");
  const q1 = id("q:support");
  const q2 = id("q:claim");
  const q3 = id("q:confidence");
  const q4 = id("q:petition");
  const surveys = [
    {
      id: surveyId,
      organisation_id: orgId,
      title: "Log of claims — Redgum Resources",
      status: "paused",
      pause_mode: "hard",
      paused_at: at(now, 1, 8),
      retry_limit: 2,
      question_timeout_minutes: 120,
      session_ttl_hours: 72,
      reminder_offsets: [1440, 4320],
      sender_number_id: numberIds.survey,
      timezone: "Australia/Perth",
      blackout_override: false,
      invitation_body:
        "Hi {{first_name}}, it's the Mineworkers Union. One minute on the Redgum Resources log of claims. Reply STOP to opt out.",
      completion_body:
        "Thanks. That's the log of claims recorded. We'll be in touch about the petition. — Mineworkers Union",
      opened_at: at(now, 14, 1),
      created_by: userId,
      created_at: at(now, 16, 2),
    },
  ];
  const questions = [
    {
      id: q1,
      organisation_id: orgId,
      survey_id: surveyId,
      sort_order: 0,
      prompt: "Do you support the Mineworkers Union log of claims at Redgum Resources? Reply YES or NO.",
      qtype: "yes_no",
      options: null,
      created_at: created,
    },
    {
      id: q2,
      organisation_id: orgId,
      survey_id: surveyId,
      sort_order: 1,
      prompt: "Which claim matters most right now? Reply 1 wages, 2 safety, 3 rosters, 4 permanency.",
      qtype: "choice",
      options: CLAIM_OPTIONS,
      created_at: created,
    },
    {
      id: q3,
      organisation_id: orgId,
      survey_id: surveyId,
      sort_order: 2,
      prompt: "How confident are you we can win this if most of the pit sticks together? Reply 1 (low) to 5 (high).",
      qtype: "scale",
      options: { min: 1, max: 5 },
      created_at: created,
    },
    {
      id: q4,
      organisation_id: orgId,
      survey_id: surveyId,
      sort_order: 3,
      prompt: "If management keeps refusing to bargain, will you sign the majority support petition? Reply YES or NO.",
      qtype: "yes_no",
      options: null,
      created_at: created,
    },
  ];

  type SessionSpec = {
    key: MemberKey;
    state: "completed" | "active" | "invited" | "expired" | "opted_out" | "undeliverable";
    answers?: Array<{ questionId: string; raw: string; parsed: string }>;
    current?: string;
  };
  const sessionSpecs: SessionSpec[] = [
    { key: "priya", state: "completed", answers: [
      { questionId: q1, raw: "YES", parsed: "yes" },
      { questionId: q2, raw: "2", parsed: "safety" },
      { questionId: q3, raw: "5", parsed: "5" },
      { questionId: q4, raw: "YES", parsed: "yes" },
    ] },
    { key: "tom", state: "completed", answers: [
      { questionId: q1, raw: "Yes", parsed: "yes" },
      { questionId: q2, raw: "1 wages", parsed: "wages" },
      { questionId: q3, raw: "3", parsed: "3" },
      { questionId: q4, raw: "YES", parsed: "yes" },
    ] },
    { key: "dale", state: "completed", answers: [
      { questionId: q1, raw: "Y", parsed: "yes" },
      { questionId: q2, raw: "pay", parsed: "wages" },
      { questionId: q3, raw: "4", parsed: "4" },
      { questionId: q4, raw: "yes", parsed: "yes" },
    ] },
    { key: "rina", state: "completed", answers: [
      { questionId: q1, raw: "YES", parsed: "yes" },
      { questionId: q2, raw: "safety", parsed: "safety" },
      { questionId: q3, raw: "4", parsed: "4" },
      { questionId: q4, raw: "YES", parsed: "yes" },
    ] },
    { key: "aisha", state: "completed", answers: [
      { questionId: q1, raw: "yes", parsed: "yes" },
      { questionId: q2, raw: "3", parsed: "rosters" },
      { questionId: q3, raw: "5", parsed: "5" },
      { questionId: q4, raw: "yes", parsed: "yes" },
    ] },
    { key: "pete", state: "completed", answers: [
      { questionId: q1, raw: "yes", parsed: "yes" },
      { questionId: q2, raw: "4", parsed: "security" },
      { questionId: q3, raw: "2", parsed: "2" },
      { questionId: q4, raw: "no", parsed: "no" },
    ] },
    { key: "owen", state: "completed", answers: [
      { questionId: q1, raw: "yes", parsed: "yes" },
      { questionId: q2, raw: "2", parsed: "safety" },
      { questionId: q3, raw: "4", parsed: "4" },
      { questionId: q4, raw: "yes", parsed: "yes" },
    ] },
    { key: "luke", state: "completed", answers: [
      { questionId: q1, raw: "no", parsed: "no" },
      { questionId: q2, raw: "1", parsed: "wages" },
      { questionId: q3, raw: "2", parsed: "2" },
      { questionId: q4, raw: "no", parsed: "no" },
    ] },
    { key: "jess", state: "active", current: q2, answers: [
      { questionId: q1, raw: "YES", parsed: "yes" },
    ] },
    { key: "holly", state: "active", current: q3, answers: [
      { questionId: q1, raw: "yes", parsed: "yes" },
      { questionId: q2, raw: "safety", parsed: "safety" },
    ] },
    { key: "chris", state: "invited" },
    { key: "nina", state: "invited" },
    { key: "ben", state: "invited" },
    { key: "lee", state: "expired" },
    { key: "erin", state: "expired" },
    { key: "mo", state: "opted_out" },
    { key: "cara", state: "undeliverable" },
  ];

  const sessions = sessionSpecs.map((spec) => {
    const invitedAt = at(now, spec.state === "expired" ? 12 : 10, 1);
    const completed = spec.state === "completed";
    return {
      id: id(`session:${spec.key}`),
      organisation_id: orgId,
      survey_id: surveyId,
      contact_id: contactId(spec.key),
      phone_e164: p.member[spec.key],
      conversation_id: spec.key === "priya" || spec.key === "jess" || spec.key === "luke"
        ? id(`conv:survey:${spec.key}`)
        : null,
      state: spec.state,
      current_question_id: spec.current ?? null,
      invited_at: spec.state === "undeliverable" ? null : invitedAt,
      first_answer_at: spec.answers?.length ? at(now, 10, 2) : null,
      last_activity_at: completed ? at(now, 9, 4) : invitedAt,
      completed_at: completed ? at(now, 9, 4) : null,
      created_at: at(now, 11, 1),
    };
  });

  const answers = sessionSpecs.flatMap((spec) =>
    (spec.answers ?? []).map((answer, index) => ({
      id: id(`answer:${spec.key}:${index}`),
      organisation_id: orgId,
      session_id: id(`session:${spec.key}`),
      question_id: answer.questionId,
      raw_body: answer.raw,
      parsed_value: answer.parsed,
      received_at: at(now, 10, 2, index * 5),
    })),
  );

  const relayId = id("relay:hr");
  const targetId = id("relay-target:alex");
  const relays = [
    {
      id: relayId,
      organisation_id: orgId,
      number_id: numberIds.relay,
      name: "Members to HR — bargain properly",
      status: "active",
      prefix_template: "From {{first_name}} {{last_name}} (Redgum Ridge):",
      suffix_template: "— passed on by the Mineworkers Union. Please bargain on the log of claims.",
      timezone: "Australia/Perth",
      quiet_hours_respected: true,
      moderation_required: false,
      created_by: userId,
      created_at: at(now, 5, 2),
    },
  ];
  const relayTargets = [
    {
      id: targetId,
      organisation_id: orgId,
      relay_id: relayId,
      phone_e164: p.hr,
      display_name: "Alex Chen, HR, Redgum Resources",
      is_active: true,
      created_at: at(now, 5, 2),
    },
  ];

  const relayScripts: Array<{ key: MemberKey; body: string; reply: string; daysAgo: number }> = [
    {
      key: "priya",
      daysAgo: 3,
      body: "Please bargain in good faith on the log of claims. We want a fair rise, enough people on crew to do the job safely, and permanency for labour hire. The pit is ready to sit down.",
      reply: "Thanks Priya. I've passed this to the bargaining team. We don't have dates yet.",
    },
    {
      key: "tom",
      daysAgo: 2,
      body: "Crews are short on nights and the pay scale is behind the other pits. Refusing to bargain is making this worse. Sit down with the union.",
      reply: "Tom, employee feedback is noted. Any meeting will be scheduled through the proper channel.",
    },
    {
      key: "rina",
      daysAgo: 1,
      body: "I'm asking you to bargain properly. People are signing the majority support petition because you walked away from the log of claims. Wages and safety can't wait.",
      reply: "Rina, we have your message. I can't confirm a bargaining meeting from this text.",
    },
  ];

  const relayMessages = relayScripts.flatMap((script) => {
    const member = members.find((m) => m.key === script.key)!;
    const forwarded = composeForwardBody({
      prefixTemplate: "From {{first_name}} {{last_name}} (Redgum Ridge):",
      suffixTemplate: "— passed on by the Mineworkers Union. Please bargain on the log of claims.",
      memberBody: script.body,
      context: { first_name: member.first, last_name: member.last },
    });
    const sentAt = at(now, script.daysAgo, 4);
    const replyAt = at(now, script.daysAgo, 7);
    return [
      {
        id: id(`relay-msg:${script.key}:out`),
        organisation_id: orgId,
        relay_id: relayId,
        direction: "member_to_target",
        contact_id: contactId(script.key),
        member_phone_e164: member.phone,
        target_id: targetId,
        body: script.body,
        forwarded_body: forwarded,
        moderation_status: "auto_approved",
        provider_message_id: `demo:relay:${script.key}:in`,
        forward_status: "delivered",
        forward_provider_message_id: `demo:relay:${script.key}:fwd`,
        forwarded_at: sentAt,
        created_at: sentAt,
      },
      {
        id: id(`relay-msg:${script.key}:back`),
        organisation_id: orgId,
        relay_id: relayId,
        direction: "target_to_member",
        contact_id: contactId(script.key),
        member_phone_e164: member.phone,
        target_id: targetId,
        body: script.reply,
        forwarded_body: `Alex Chen, HR, Redgum Resources: ${script.reply}`,
        moderation_status: "auto_approved",
        provider_message_id: `demo:relay:${script.key}:reply`,
        forward_status: "delivered",
        forward_provider_message_id: `demo:relay:${script.key}:back`,
        forwarded_at: replyAt,
        created_at: replyAt,
      },
    ];
  });

  type Line = { dir: "inbound" | "outbound"; body: string; at: string; unread?: boolean };
  const outreachThreads: Record<string, Line[]> = {};

  function pushOut(key: MemberKey, step: (typeof P2P_STEPS)[number]["key"]) {
    const member = members.find((m) => m.key === key)!;
    const stepDef = P2P_STEPS.find((s) => s.key === step)!;
    (outreachThreads[key] ??= []).push({
      dir: "outbound",
      body: fill(stepDef.template, member.first),
      at: stepWhen[step],
    });
  }
  for (const key of stepKeys.intro) pushOut(key, "intro");
  for (const key of stepKeys.agitation) pushOut(key, "agitation");
  for (const key of stepKeys.hope) pushOut(key, "hope");
  for (const key of stepKeys.cta) pushOut(key, "cta");

  const reply = (key: MemberKey, body: string, when: string, unread = false) => {
    (outreachThreads[key] ??= []).push({ dir: "inbound", body, at: when, unread });
  };
  reply("priya", "Yeah I've got a minute. This is Priya on panel 2.", at(now, 8, 2));
  reply("tom", "Depends what it's about. I'm on tools until crib.", at(now, 8, 3));
  reply("jess", "Go on.", at(now, 8, 2, 30));
  reply("dale", "Text me after shift. I'm on the truck.", at(now, 8, 5));
  reply("rina", "Yep. What's the union asking for?", at(now, 8, 2, 10));
  reply("noor", "I think you've got the wrong person. I left site in March.", at(now, 8, 6));

  reply("priya", "Nights are two short. The prestart is a tick-and-flick and the money hasn't moved.", at(now, 6, 3));
  reply("tom", "Pay is behind the other pits and we ran a crew of three on a job that wants five. That's how people get hurt.", at(now, 6, 4));
  reply("jess", "Prestart is a joke on nights. Pay's behind. A truck sat with a cracked step for a week.", at(now, 6, 5), true);
  reply("rina", "Same here. People are angry and they don't think anyone is listening.", at(now, 6, 3, 20));

  reply("priya", "Forty? I didn't know it was that many. Keep me in the loop.", at(now, 4, 3));
  reply("tom", "If it's really that many, management will feel it. Don't oversell it.", at(now, 4, 4));
  reply("rina", "About time. Yes, keep texting me.", at(now, 4, 2, 40));

  reply("priya", "Level 4 operator, nights. My offsider Samira should be in the union. I'll ask her tonight.", at(now, 2, 5));
  reply("tom", "I won't put a mate's name in a text. Classification is fitter, days. I'll think about the rest.", at(now, 2, 6), true);
  reply("rina", "Level 3 operator, days. Text my workmate about joining — I'll send her number on my next break.", at(now, 2, 4, 30));

  const blastReplies: Partial<Record<MemberKey, string>> = {
    priya: "YES signed. Sent the link to the night crew.",
    tom: "Link works. I'll sign tonight.",
    rina: "Signed. Passed it to the crew chat too.",
    aisha: "YES. Can you text the log of claims so I can forward it?",
    maya: "Signed.",
    luke: "Not signing. I don't agree with the claims.",
  };

  for (const outcome of blastOutcomes) {
    if (outcome.status !== "sent") continue;
    (outreachThreads[outcome.key] ??= []).push({
      dir: "outbound",
      body: REDGUM_BLAST_BODY,
      at: blastSentAt,
    });
    const inbound = blastReplies[outcome.key];
    if (inbound) {
      reply(outcome.key, inbound, at(now, 1, 5), outcome.key === "priya" || outcome.key === "aisha");
    }
  }

  const conversations: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];

  function addThread(
    convKey: string,
    numberId: string,
    memberKey: MemberKey,
    lines: Line[],
    ourPhone: string,
  ) {
    if (lines.length === 0) return;
    const member = members.find((m) => m.key === memberKey)!;
    const sorted = [...lines].sort((a, b) => a.at.localeCompare(b.at));
    const last = sorted[sorted.length - 1];
    const unread = sorted.filter((line) => line.unread).length;
    const convId = id(convKey);
    conversations.push({
      id: convId,
      organisation_id: orgId,
      our_number_id: numberId,
      contact_id: contactId(memberKey),
      phone_e164: member.phone,
      state: unread > 0 ? "needs_reply" : "open",
      last_message_at: last.at,
      last_inbound_at: [...sorted].reverse().find((line) => line.dir === "inbound")?.at ?? null,
      last_outbound_at: [...sorted].reverse().find((line) => line.dir === "outbound")?.at ?? null,
      unread_count: unread,
      created_at: sorted[0].at,
    });
    sorted.forEach((line, index) => {
      messages.push({
        id: id(`msg:${convKey}:${index}`),
        organisation_id: orgId,
        conversation_id: convId,
        direction: line.dir,
        body: line.body,
        phone_e164: line.dir === "inbound" ? member.phone : ourPhone,
        sender_user_id: line.dir === "outbound" ? userId : null,
        provider_message_id: `demo:msg:${convKey}:${index}`,
        status: line.dir === "outbound" ? "delivered" : "received",
        created_at: line.at,
      });
    });
  }

  for (const [key, lines] of Object.entries(outreachThreads)) {
    addThread(`conv:outreach:${key}`, numberIds.outreach, key as MemberKey, lines, p.outreach);
  }

  const memberLine: Array<{ key: MemberKey; lines: Line[] }> = [
    {
      key: "owen",
      lines: [
        { dir: "inbound", body: "When's the next meeting? I can do Thursday after day shift.", at: at(now, 3, 6) },
        { dir: "outbound", body: "Thursday after day shift, crib hut 2. I'll text a reminder. — Mina, Mineworkers Union", at: at(now, 3, 7) },
        { dir: "inbound", body: "I'll be there. Bringing one from my crew.", at: at(now, 3, 8), unread: true },
      ],
    },
    {
      key: "aisha",
      lines: [
        { dir: "inbound", body: "Can you send the log of claims as a text? People keep asking me what we're actually claiming.", at: at(now, 2, 8), unread: true },
      ],
    },
    {
      key: "mo",
      lines: [
        { dir: "outbound", body: "Hi Mo, it's Mina from the Mineworkers Union. Quick yarn about bargaining at Redgum Ridge? Reply STOP to opt out.", at: at(now, 18, 2) },
        { dir: "inbound", body: "STOP", at: at(now, 18, 6) },
      ],
    },
  ];
  for (const thread of memberLine) {
    addThread(`conv:members:${thread.key}`, numberIds.members, thread.key, thread.lines, p.membersLine);
  }

  const surveyLines: Partial<Record<MemberKey, Line[]>> = {
    priya: [
      { dir: "outbound", body: "Hi Priya, it's the Mineworkers Union. One minute on the Redgum Resources log of claims. Reply STOP to opt out.\n\nDo you support the Mineworkers Union log of claims at Redgum Resources? Reply YES or NO.", at: at(now, 10, 1) },
      { dir: "inbound", body: "YES", at: at(now, 10, 2) },
      { dir: "outbound", body: "Which claim matters most right now? Reply 1 wages, 2 safety, 3 rosters, 4 permanency.", at: at(now, 10, 2, 1) },
      { dir: "inbound", body: "2", at: at(now, 10, 2, 10) },
      { dir: "outbound", body: "How confident are you we can win this if most of the pit sticks together? Reply 1 (low) to 5 (high).", at: at(now, 10, 2, 11) },
      { dir: "inbound", body: "5", at: at(now, 10, 3) },
      { dir: "outbound", body: "If management keeps refusing to bargain, will you sign the majority support petition? Reply YES or NO.", at: at(now, 10, 3, 1) },
      { dir: "inbound", body: "YES", at: at(now, 9, 4) },
      { dir: "outbound", body: "Thanks. That's the log of claims recorded. We'll be in touch about the petition. — Mineworkers Union", at: at(now, 9, 4, 1) },
    ],
    jess: [
      { dir: "outbound", body: "Hi Jess, it's the Mineworkers Union. One minute on the Redgum Resources log of claims. Reply STOP to opt out.\n\nDo you support the Mineworkers Union log of claims at Redgum Resources? Reply YES or NO.", at: at(now, 10, 1) },
      { dir: "inbound", body: "YES", at: at(now, 9, 6) },
      { dir: "outbound", body: "Which claim matters most right now? Reply 1 wages, 2 safety, 3 rosters, 4 permanency.", at: at(now, 9, 6, 1) },
    ],
    luke: [
      { dir: "outbound", body: "Hi Luke, it's the Mineworkers Union. One minute on the Redgum Resources log of claims. Reply STOP to opt out.\n\nDo you support the Mineworkers Union log of claims at Redgum Resources? Reply YES or NO.", at: at(now, 10, 1) },
      { dir: "inbound", body: "no", at: at(now, 10, 4) },
      { dir: "outbound", body: "Which claim matters most right now? Reply 1 wages, 2 safety, 3 rosters, 4 permanency.", at: at(now, 10, 4, 1) },
      { dir: "inbound", body: "1", at: at(now, 10, 4, 20) },
      { dir: "outbound", body: "How confident are you we can win this if most of the pit sticks together? Reply 1 (low) to 5 (high).", at: at(now, 10, 4, 21) },
      { dir: "inbound", body: "2", at: at(now, 10, 5) },
      { dir: "outbound", body: "If management keeps refusing to bargain, will you sign the majority support petition? Reply YES or NO.", at: at(now, 10, 5, 1) },
      { dir: "inbound", body: "no", at: at(now, 9, 4) },
      { dir: "outbound", body: "Thanks. That's the log of claims recorded. We'll be in touch about the petition. — Mineworkers Union", at: at(now, 9, 4, 1) },
    ],
  };
  for (const [key, lines] of Object.entries(surveyLines)) {
    if (lines) addThread(`conv:survey:${key}`, numberIds.survey, key as MemberKey, lines, p.survey);
  }

  const notes = [
    {
      id: id("note:priya"),
      organisation_id: orgId,
      conversation_id: id("conv:outreach:priya"),
      author_user_id: userId,
      body: "Offsider is Samira — waiting on a number. Classification recorded: level 4 operator, nights.",
      created_at: at(now, 2, 6),
    },
    {
      id: id("note:tom"),
      organisation_id: orgId,
      conversation_id: id("conv:outreach:tom"),
      author_user_id: userId,
      body: "Won't name a workmate over SMS. Follow up in person on the fitter's list.",
      created_at: at(now, 2, 7),
    },
  ];

  return {
    marker: REDGUM_DEMO_NOTE,
    senderPhones: numbers.map((n) => n.phone_e164),
    provider: {
      id: providerId,
      organisation_id: orgId,
      provider: "mobile_message",
      mode: "byo",
      credentials_ciphertext: DEMO_PROVIDER_CIPHERTEXT,
    },
    numbers,
    contacts,
    lists,
    listMembers,
    canned,
    blasts,
    blastItems,
    sendLogs,
    deliveryEvents,
    p2pSends,
    p2pItems,
    surveys,
    questions,
    sessions,
    answers,
    relays,
    relayTargets,
    relayMessages,
    conversations,
    messages,
    notes,
  };
}
