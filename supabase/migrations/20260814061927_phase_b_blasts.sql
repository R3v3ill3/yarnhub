-- Yarnhub Phase B: contact lists, blasts, send log, delivery events.

-- ── lists ────────────────────────────────────────────────────────────

create table public.contact_lists (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  name text not null check (char_length(trim(name)) >= 1),
  created_at timestamptz not null default now()
);

create index contact_lists_organisation_id_idx
  on public.contact_lists (organisation_id);

create table public.contact_list_members (
  list_id uuid not null references public.contact_lists (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (list_id, contact_id)
);

create index contact_list_members_contact_id_idx
  on public.contact_list_members (contact_id);

-- ── blasts ───────────────────────────────────────────────────────────

create table public.sms_blasts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  name text,
  body text not null check (char_length(trim(body)) >= 1),
  sender_number_id uuid not null references public.sms_numbers (id) on delete restrict,
  timezone text not null default 'Australia/Sydney',
  blackout_override boolean not null default false,
  blackout_override_reason text,
  scheduled_for timestamptz,
  status text not null default 'draft'
    check (status in ('draft', 'queued', 'sending', 'sent', 'paused', 'cancelled')),
  created_by uuid references auth.users (id) on delete set null,
  queued_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint sms_blasts_override_reason_chk check (
    not blackout_override
    or char_length(trim(coalesce(blackout_override_reason, ''))) >= 8
  )
);

create index sms_blasts_organisation_status_idx
  on public.sms_blasts (organisation_id, status);

create table public.sms_blast_items (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  blast_id uuid not null references public.sms_blasts (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete restrict,
  phone_e164 text not null,
  sort_order integer not null default 0,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'blocked', 'failed', 'opted_out', 'skipped')),
  claimed_at timestamptz,
  send_before timestamptz,
  provider_message_id text,
  sent_at timestamptz,
  failure_reason text,
  unique (blast_id, contact_id)
);

create index sms_blast_items_blast_status_idx
  on public.sms_blast_items (blast_id, status);

create index sms_blast_items_sending_claimed_at_idx
  on public.sms_blast_items (claimed_at)
  where status = 'sending';

-- ── send log + delivery ──────────────────────────────────────────────

create table public.sms_send_log (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  blast_id uuid references public.sms_blasts (id) on delete set null,
  blast_item_id uuid unique references public.sms_blast_items (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  phone_e164 text not null,
  body text not null,
  segments integer,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'blocked', 'failed', 'delivered')),
  provider_message_id text,
  cost numeric,
  sent_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now()
);

create index sms_send_log_organisation_id_idx
  on public.sms_send_log (organisation_id);

create unique index sms_send_log_org_provider_message_id_idx
  on public.sms_send_log (organisation_id, provider_message_id)
  where provider_message_id is not null;

create table public.sms_delivery_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  send_log_id uuid references public.sms_send_log (id) on delete set null,
  provider_message_id text,
  status text not null,
  occurred_at timestamptz,
  created_at timestamptz not null default now()
);

create index sms_delivery_events_organisation_id_idx
  on public.sms_delivery_events (organisation_id);

create index sms_delivery_events_provider_message_id_idx
  on public.sms_delivery_events (provider_message_id);

-- ── RLS ──────────────────────────────────────────────────────────────

alter table public.contact_lists enable row level security;
alter table public.contact_list_members enable row level security;
alter table public.sms_blasts enable row level security;
alter table public.sms_blast_items enable row level security;
alter table public.sms_send_log enable row level security;
alter table public.sms_delivery_events enable row level security;

create policy contact_lists_all
  on public.contact_lists for all to authenticated
  using (private.user_is_org_member(organisation_id))
  with check (private.user_is_org_member(organisation_id));

create policy contact_list_members_all
  on public.contact_list_members for all to authenticated
  using (private.user_is_org_member(organisation_id))
  with check (private.user_is_org_member(organisation_id));

create policy sms_blasts_all
  on public.sms_blasts for all to authenticated
  using (private.user_is_org_member(organisation_id))
  with check (private.user_is_org_member(organisation_id));

create policy sms_blast_items_all
  on public.sms_blast_items for all to authenticated
  using (private.user_is_org_member(organisation_id))
  with check (private.user_is_org_member(organisation_id));

create policy sms_send_log_select
  on public.sms_send_log for select to authenticated
  using (private.user_is_org_member(organisation_id));

create policy sms_delivery_events_select
  on public.sms_delivery_events for select to authenticated
  using (private.user_is_org_member(organisation_id));

revoke all on table public.contact_lists from anon, public;
revoke all on table public.contact_list_members from anon, public;
revoke all on table public.sms_blasts from anon, public;
revoke all on table public.sms_blast_items from anon, public;
revoke all on table public.sms_send_log from anon, public;
revoke all on table public.sms_delivery_events from anon, public;

grant select, insert, update, delete on table public.contact_lists to authenticated;
grant select, insert, update, delete on table public.contact_list_members to authenticated;
grant select, insert, update, delete on table public.sms_blasts to authenticated;
grant select, insert, update, delete on table public.sms_blast_items to authenticated;
grant select on table public.sms_send_log to authenticated;
grant select on table public.sms_delivery_events to authenticated;
