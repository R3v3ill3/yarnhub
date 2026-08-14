-- Yarnhub Phase A foundations. Do not apply OA SMS migrations.

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- ── helpers ──────────────────────────────────────────────────────────

create or replace function private.user_organisation_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organisation_id
  from public.organisation_members
  where user_id = auth.uid();
$$;

revoke all on function private.user_organisation_ids() from public, anon, authenticated;

create or replace function private.user_is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organisation_members
    where organisation_id = org_id
      and user_id = auth.uid()
  );
$$;

revoke all on function private.user_is_org_member(uuid) from public, anon, authenticated;

create or replace function private.user_has_org_role(org_id uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organisation_members
    where organisation_id = org_id
      and user_id = auth.uid()
      and role = any (roles)
  );
$$;

revoke all on function private.user_has_org_role(uuid, text[]) from public, anon, authenticated;

-- ── organisations ────────────────────────────────────────────────────

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) >= 2),
  slug text not null unique,
  public_id text not null unique,
  timezone text not null default 'Australia/Sydney',
  created_at timestamptz not null default now()
);

create table public.organisation_members (
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (organisation_id, user_id)
);

create index organisation_members_user_id_idx
  on public.organisation_members (user_id);

create or replace function private.create_organisation(p_name text)
returns public.organisations
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  org public.organisations;
  base_slug text;
  pid text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if exists (select 1 from public.organisation_members where user_id = uid) then
    raise exception 'Already a member of an organisation';
  end if;
  if p_name is null or char_length(trim(p_name)) < 2 then
    raise exception 'Organisation name is required';
  end if;

  pid := encode(gen_random_bytes(12), 'hex');
  base_slug := trim(both '-' from lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g')));
  if base_slug is null or base_slug = '' then
    base_slug := 'org';
  end if;

  insert into public.organisations (name, slug, public_id)
  values (trim(p_name), base_slug || '-' || substr(pid, 1, 6), pid)
  returning * into org;

  insert into public.organisation_members (organisation_id, user_id, role)
  values (org.id, uid, 'owner');

  return org;
end;
$$;

revoke all on function private.create_organisation(text) from public, anon;
grant execute on function private.create_organisation(text) to authenticated;

create or replace function public.create_organisation(p_name text)
returns public.organisations
language sql
security invoker
set search_path = public
as $$
  select * from private.create_organisation(p_name);
$$;

revoke all on function public.create_organisation(text) from public, anon;
grant execute on function public.create_organisation(text) to authenticated;

-- ── contacts ─────────────────────────────────────────────────────────

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  first_name text,
  last_name text,
  phone_e164 text not null,
  sms_opt_out boolean not null default false,
  sms_opt_out_at timestamptz,
  sms_opt_out_source text,
  notes text,
  created_at timestamptz not null default now(),
  unique (organisation_id, phone_e164)
);

create index contacts_organisation_id_idx on public.contacts (organisation_id);

-- ── provider + numbers ───────────────────────────────────────────────

create table public.provider_accounts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  provider text not null default 'mobile_message',
  mode text not null default 'byo' check (mode = 'byo'),
  credentials_ciphertext text not null,
  webhook_secret_ciphertext text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organisation_id)
);

create table public.sms_numbers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  provider_account_id uuid not null references public.provider_accounts (id) on delete cascade,
  phone_e164 text not null unique,
  purpose text not null default 'inbox' check (purpose in ('inbox', 'survey', 'relay', 'spare')),
  status text not null default 'active' check (status in ('active', 'retired')),
  label text,
  created_at timestamptz not null default now()
);

create index sms_numbers_organisation_id_idx on public.sms_numbers (organisation_id);

-- ── conversations ────────────────────────────────────────────────────

create table public.sms_conversations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  our_number_id uuid not null references public.sms_numbers (id) on delete restrict,
  contact_id uuid references public.contacts (id) on delete set null,
  phone_e164 text not null,
  state text not null default 'open',
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  unread_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (organisation_id, our_number_id, phone_e164)
);

create index sms_conversations_organisation_id_idx
  on public.sms_conversations (organisation_id, last_message_at desc);

create table public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  conversation_id uuid not null references public.sms_conversations (id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null,
  phone_e164 text,
  sender_user_id uuid references auth.users (id) on delete set null,
  provider_message_id text,
  status text,
  created_at timestamptz not null default now()
);

create index sms_messages_conversation_id_created_at_idx
  on public.sms_messages (conversation_id, created_at);

create unique index sms_messages_org_provider_message_id_idx
  on public.sms_messages (organisation_id, provider_message_id)
  where provider_message_id is not null;

-- ── RLS ──────────────────────────────────────────────────────────────

alter table public.organisations enable row level security;
alter table public.organisation_members enable row level security;
alter table public.contacts enable row level security;
alter table public.provider_accounts enable row level security;
alter table public.sms_numbers enable row level security;
alter table public.sms_conversations enable row level security;
alter table public.sms_messages enable row level security;

create policy organisations_select
  on public.organisations for select to authenticated
  using (private.user_is_org_member(id));

create policy organisations_update
  on public.organisations for update to authenticated
  using (private.user_has_org_role(id, array['owner', 'admin']::text[]))
  with check (private.user_has_org_role(id, array['owner', 'admin']::text[]));

create policy organisation_members_select
  on public.organisation_members for select to authenticated
  using (private.user_is_org_member(organisation_id));

create policy contacts_all
  on public.contacts for all to authenticated
  using (private.user_is_org_member(organisation_id))
  with check (private.user_is_org_member(organisation_id));

-- Ciphertext is service-role only. No authenticated policies on provider_accounts.
create policy sms_numbers_select
  on public.sms_numbers for select to authenticated
  using (private.user_is_org_member(organisation_id));

create policy sms_numbers_insert
  on public.sms_numbers for insert to authenticated
  with check (private.user_is_org_member(organisation_id));

create policy sms_numbers_update
  on public.sms_numbers for update to authenticated
  using (private.user_is_org_member(organisation_id))
  with check (private.user_is_org_member(organisation_id));

create policy sms_numbers_delete
  on public.sms_numbers for delete to authenticated
  using (private.user_has_org_role(organisation_id, array['owner', 'admin']::text[]));

create policy sms_conversations_all
  on public.sms_conversations for all to authenticated
  using (private.user_is_org_member(organisation_id))
  with check (private.user_is_org_member(organisation_id));

create policy sms_messages_all
  on public.sms_messages for all to authenticated
  using (private.user_is_org_member(organisation_id))
  with check (private.user_is_org_member(organisation_id));

revoke all on table public.organisations from anon, public;
revoke all on table public.organisation_members from anon, public;
revoke all on table public.contacts from anon, public;
revoke all on table public.provider_accounts from anon, authenticated, public;
revoke all on table public.sms_numbers from anon, public;
revoke all on table public.sms_conversations from anon, public;
revoke all on table public.sms_messages from anon, public;

grant select, update on table public.organisations to authenticated;
grant select on table public.organisation_members to authenticated;
grant select, insert, update, delete on table public.contacts to authenticated;
grant select, insert, update, delete on table public.sms_numbers to authenticated;
grant select, insert, update, delete on table public.sms_conversations to authenticated;
grant select, insert, update, delete on table public.sms_messages to authenticated;
