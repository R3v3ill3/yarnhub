-- Yarnhub Phase C: P2P, surveys, relays. Keys are organisation_id + contact_id.

-- ── P2P ──────────────────────────────────────────────────────────────

create table public.sms_p2p_sends (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  sender_number_id uuid not null references public.sms_numbers (id) on delete restrict,
  body_template text not null check (char_length(trim(body_template)) >= 1),
  timezone text not null default 'Australia/Sydney',
  blackout_override boolean not null default false,
  blackout_override_reason text,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'paused')),
  created_by uuid references auth.users (id) on delete set null,
  queued_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint sms_p2p_sends_override_reason_chk check (
    not blackout_override
    or char_length(trim(coalesce(blackout_override_reason, ''))) >= 8
  )
);

create index sms_p2p_sends_organisation_status_idx
  on public.sms_p2p_sends (organisation_id, status);

create table public.sms_p2p_send_items (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  send_id uuid not null references public.sms_p2p_sends (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete restrict,
  phone_e164 text not null,
  body text not null,
  sort_order integer not null default 0,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'blocked', 'failed', 'opted_out', 'skipped')),
  claimed_at timestamptz,
  send_before timestamptz,
  provider_message_id text,
  sent_at timestamptz,
  failure_reason text,
  unique (send_id, contact_id)
);

create index sms_p2p_send_items_send_status_idx
  on public.sms_p2p_send_items (send_id, status);

create index sms_p2p_send_items_sending_claimed_at_idx
  on public.sms_p2p_send_items (claimed_at)
  where status = 'sending';

alter table public.sms_send_log
  add column p2p_item_id uuid unique references public.sms_p2p_send_items (id) on delete set null;

-- ── Surveys ──────────────────────────────────────────────────────────

create table public.sms_surveys (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  title text not null check (char_length(trim(title)) >= 1),
  status text not null default 'draft'
    check (status in ('draft', 'open', 'paused', 'closed')),
  pause_mode text check (pause_mode in ('soft', 'hard')),
  paused_at timestamptz,
  retry_limit integer not null default 2 check (retry_limit >= 0 and retry_limit <= 5),
  question_timeout_minutes integer not null default 120 check (question_timeout_minutes > 0),
  session_ttl_hours integer not null default 72 check (session_ttl_hours > 0),
  reminder_offsets integer[] not null default '{1440,4320}',
  sender_number_id uuid references public.sms_numbers (id) on delete restrict,
  timezone text not null default 'Australia/Sydney',
  blackout_override boolean not null default false,
  blackout_override_reason text,
  invitation_body text,
  completion_body text,
  opened_at timestamptz,
  closed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint sms_surveys_override_reason_chk check (
    not blackout_override
    or char_length(trim(coalesce(blackout_override_reason, ''))) >= 8
  )
);

create index sms_surveys_organisation_status_idx
  on public.sms_surveys (organisation_id, status);

create table public.sms_survey_questions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  survey_id uuid not null references public.sms_surveys (id) on delete cascade,
  sort_order integer not null default 0,
  prompt text not null check (char_length(trim(prompt)) >= 1),
  qtype text not null check (qtype in ('choice', 'yes_no', 'scale', 'open_text')),
  options jsonb,
  branching jsonb,
  invalid_prompt text,
  nudge_text text,
  created_at timestamptz not null default now()
);

create index sms_survey_questions_survey_sort_idx
  on public.sms_survey_questions (survey_id, sort_order, id);

create table public.sms_survey_sessions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  survey_id uuid not null references public.sms_surveys (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete restrict,
  phone_e164 text not null,
  conversation_id uuid references public.sms_conversations (id) on delete set null,
  state text not null default 'queued'
    check (state in (
      'queued', 'invited', 'active', 'completed', 'expired',
      'opted_out', 'handed_off', 'undeliverable'
    )),
  current_question_id uuid references public.sms_survey_questions (id) on delete set null,
  retry_count integer not null default 0,
  nudged boolean not null default false,
  reminders_sent integer not null default 0,
  last_prompt_at timestamptz,
  invited_at timestamptz,
  first_answer_at timestamptz,
  last_activity_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index sms_survey_sessions_survey_state_idx
  on public.sms_survey_sessions (survey_id, state);

create index sms_survey_sessions_org_phone_idx
  on public.sms_survey_sessions (organisation_id, phone_e164);

create unique index sms_survey_sessions_one_live_per_org_phone
  on public.sms_survey_sessions (organisation_id, phone_e164)
  where state in ('invited', 'active');

create table public.sms_survey_answers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  session_id uuid not null references public.sms_survey_sessions (id) on delete cascade,
  question_id uuid not null references public.sms_survey_questions (id) on delete restrict,
  raw_body text,
  parsed_value text,
  invalid_attempts integer not null default 0,
  provider_message_id text,
  received_at timestamptz not null default now(),
  unique (session_id, question_id)
);

create index sms_survey_answers_session_idx
  on public.sms_survey_answers (session_id);

-- ── Relays ───────────────────────────────────────────────────────────

create table public.sms_relays (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  number_id uuid not null references public.sms_numbers (id) on delete restrict,
  name text not null check (char_length(trim(name)) >= 1),
  status text not null default 'paused'
    check (status in ('active', 'paused', 'ended')),
  prefix_template text,
  suffix_template text,
  timezone text not null default 'Australia/Sydney',
  quiet_hours_respected boolean not null default true,
  moderation_required boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create index sms_relays_organisation_status_idx
  on public.sms_relays (organisation_id, status);

create unique index sms_relays_one_live_per_number
  on public.sms_relays (number_id)
  where status in ('active', 'paused');

create table public.sms_relay_targets (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  relay_id uuid not null references public.sms_relays (id) on delete cascade,
  phone_e164 text not null,
  display_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (relay_id, phone_e164)
);

create index sms_relay_targets_relay_idx
  on public.sms_relay_targets (relay_id);

create table public.sms_relay_messages (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  relay_id uuid not null references public.sms_relays (id) on delete cascade,
  direction text not null check (direction in ('member_to_target', 'target_to_member')),
  contact_id uuid references public.contacts (id) on delete set null,
  member_phone_e164 text,
  target_id uuid references public.sms_relay_targets (id) on delete set null,
  body text,
  forwarded_body text,
  moderation_status text not null default 'auto_approved'
    check (moderation_status in ('auto_approved', 'pending', 'approved', 'rejected')),
  provider_message_id text,
  forward_status text not null default 'queued'
    check (forward_status in ('queued', 'sending', 'sent', 'delivered', 'failed', 'held', 'rejected')),
  forward_provider_message_id text,
  claimed_at timestamptz,
  forwarded_at timestamptz,
  created_at timestamptz not null default now()
);

create index sms_relay_messages_relay_created_idx
  on public.sms_relay_messages (relay_id, created_at desc);

create index sms_relay_messages_forward_status_idx
  on public.sms_relay_messages (relay_id, forward_status);

create unique index sms_relay_messages_org_provider_message_id_idx
  on public.sms_relay_messages (organisation_id, provider_message_id)
  where provider_message_id is not null;

create index sms_relay_messages_forward_provider_id_idx
  on public.sms_relay_messages (forward_provider_message_id)
  where forward_provider_message_id is not null;

-- ── RLS ──────────────────────────────────────────────────────────────

alter table public.sms_p2p_sends enable row level security;
alter table public.sms_p2p_send_items enable row level security;
alter table public.sms_surveys enable row level security;
alter table public.sms_survey_questions enable row level security;
alter table public.sms_survey_sessions enable row level security;
alter table public.sms_survey_answers enable row level security;
alter table public.sms_relays enable row level security;
alter table public.sms_relay_targets enable row level security;
alter table public.sms_relay_messages enable row level security;

create policy sms_p2p_sends_all
  on public.sms_p2p_sends for all to authenticated
  using (private.user_is_org_member(organisation_id))
  with check (private.user_is_org_member(organisation_id));

create policy sms_p2p_send_items_all
  on public.sms_p2p_send_items for all to authenticated
  using (private.user_is_org_member(organisation_id))
  with check (private.user_is_org_member(organisation_id));

create policy sms_surveys_all
  on public.sms_surveys for all to authenticated
  using (private.user_is_org_member(organisation_id))
  with check (private.user_is_org_member(organisation_id));

create policy sms_survey_questions_all
  on public.sms_survey_questions for all to authenticated
  using (private.user_is_org_member(organisation_id))
  with check (private.user_is_org_member(organisation_id));

create policy sms_survey_sessions_all
  on public.sms_survey_sessions for all to authenticated
  using (private.user_is_org_member(organisation_id))
  with check (private.user_is_org_member(organisation_id));

create policy sms_survey_answers_select
  on public.sms_survey_answers for select to authenticated
  using (private.user_is_org_member(organisation_id));

create policy sms_relays_all
  on public.sms_relays for all to authenticated
  using (private.user_is_org_member(organisation_id))
  with check (private.user_is_org_member(organisation_id));

create policy sms_relay_targets_all
  on public.sms_relay_targets for all to authenticated
  using (private.user_is_org_member(organisation_id))
  with check (private.user_is_org_member(organisation_id));

create policy sms_relay_messages_select
  on public.sms_relay_messages for select to authenticated
  using (private.user_is_org_member(organisation_id));

revoke all on table public.sms_p2p_sends from anon, public;
revoke all on table public.sms_p2p_send_items from anon, public;
revoke all on table public.sms_surveys from anon, public;
revoke all on table public.sms_survey_questions from anon, public;
revoke all on table public.sms_survey_sessions from anon, public;
revoke all on table public.sms_survey_answers from anon, public;
revoke all on table public.sms_relays from anon, public;
revoke all on table public.sms_relay_targets from anon, public;
revoke all on table public.sms_relay_messages from anon, public;

grant select, insert, update, delete on table public.sms_p2p_sends to authenticated;
grant select, insert, update, delete on table public.sms_p2p_send_items to authenticated;
grant select, insert, update, delete on table public.sms_surveys to authenticated;
grant select, insert, update, delete on table public.sms_survey_questions to authenticated;
grant select, insert, update, delete on table public.sms_survey_sessions to authenticated;
grant select on table public.sms_survey_answers to authenticated;
grant select, insert, update, delete on table public.sms_relays to authenticated;
grant select, insert, update, delete on table public.sms_relay_targets to authenticated;
grant select on table public.sms_relay_messages to authenticated;

-- Keep Phase B helper grants; policies above call these as authenticated.
grant execute on function private.user_is_org_member(uuid) to authenticated;
grant execute on function private.user_has_org_role(uuid, text[]) to authenticated;
