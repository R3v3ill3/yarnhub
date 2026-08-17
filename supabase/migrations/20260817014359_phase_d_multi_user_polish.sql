-- Phase D: invites, roles, canned replies, audit, soft claim, Realtime.

alter table public.sms_conversations
  add column if not exists claimed_by uuid references auth.users (id) on delete set null,
  add column if not exists claimed_at timestamptz;

create table public.organisation_invites (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  role text not null check (role in ('admin', 'member')),
  token text not null unique,
  created_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index organisation_invites_org_idx
  on public.organisation_invites (organisation_id, created_at desc);

create table public.sms_canned_replies (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  title text not null check (char_length(trim(title)) >= 1),
  body text not null check (char_length(trim(body)) >= 1),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index sms_canned_replies_org_idx
  on public.sms_canned_replies (organisation_id, created_at desc);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_org_created_idx
  on public.audit_events (organisation_id, created_at desc);

-- ── Invite accept (one org per user; email must match) ───────────────

create or replace function private.accept_organisation_invite(p_token text)
returns public.organisations
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  user_email text;
  inv public.organisation_invites;
  org public.organisations;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if exists (select 1 from public.organisation_members where user_id = uid) then
    raise exception 'Already a member of an organisation';
  end if;

  select email into user_email from auth.users where id = uid;
  user_email := lower(trim(coalesce(user_email, auth.jwt() ->> 'email', '')));

  select * into inv
  from public.organisation_invites
  where token = p_token
  for update;
  if not found then
    raise exception 'Invite not found';
  end if;
  if inv.accepted_at is not null then
    raise exception 'Invite already accepted';
  end if;
  if inv.expires_at < now() then
    raise exception 'Invite expired';
  end if;
  if user_email is distinct from lower(trim(inv.email)) then
    raise exception 'This invite was sent to a different email address';
  end if;

  insert into public.organisation_members (organisation_id, user_id, role)
  values (inv.organisation_id, uid, inv.role);

  update public.organisation_invites
    set accepted_at = now()
    where id = inv.id;

  select * into org from public.organisations where id = inv.organisation_id;
  return org;
end;
$$;

revoke all on function private.accept_organisation_invite(text) from public, anon;
grant execute on function private.accept_organisation_invite(text) to authenticated;

create or replace function public.accept_organisation_invite(p_token text)
returns public.organisations
language sql
security invoker
set search_path = public
as $$
  select * from private.accept_organisation_invite(p_token);
$$;

revoke all on function public.accept_organisation_invite(text) from public, anon;
grant execute on function public.accept_organisation_invite(text) to authenticated;

-- ── RLS ──────────────────────────────────────────────────────────────

alter table public.organisation_invites enable row level security;
alter table public.sms_canned_replies enable row level security;
alter table public.audit_events enable row level security;

create policy organisation_invites_select
  on public.organisation_invites for select to authenticated
  using (private.user_is_org_member(organisation_id));

create policy organisation_invites_insert
  on public.organisation_invites for insert to authenticated
  with check (private.user_has_org_role(organisation_id, array['owner', 'admin']::text[]));

create policy organisation_invites_update
  on public.organisation_invites for update to authenticated
  using (private.user_has_org_role(organisation_id, array['owner', 'admin']::text[]))
  with check (private.user_has_org_role(organisation_id, array['owner', 'admin']::text[]));

create policy organisation_invites_delete
  on public.organisation_invites for delete to authenticated
  using (private.user_has_org_role(organisation_id, array['owner', 'admin']::text[]));

create policy sms_canned_replies_all
  on public.sms_canned_replies for all to authenticated
  using (private.user_is_org_member(organisation_id))
  with check (private.user_is_org_member(organisation_id));

create policy audit_events_select
  on public.audit_events for select to authenticated
  using (private.user_is_org_member(organisation_id));

create policy audit_events_insert
  on public.audit_events for insert to authenticated
  with check (
    private.user_is_org_member(organisation_id)
    and actor_user_id = auth.uid()
  );

create policy organisation_members_update
  on public.organisation_members for update to authenticated
  using (private.user_has_org_role(organisation_id, array['owner', 'admin']::text[]))
  with check (private.user_has_org_role(organisation_id, array['owner', 'admin']::text[]));

create policy organisation_members_delete
  on public.organisation_members for delete to authenticated
  using (private.user_has_org_role(organisation_id, array['owner', 'admin']::text[]));

revoke all on table public.organisation_invites from anon, public;
revoke all on table public.sms_canned_replies from anon, public;
revoke all on table public.audit_events from anon, public;

grant select, insert, update, delete on table public.organisation_invites to authenticated;
grant select, insert, update, delete on table public.sms_canned_replies to authenticated;
grant select, insert on table public.audit_events to authenticated;
grant update, delete on table public.organisation_members to authenticated;

grant execute on function private.user_is_org_member(uuid) to authenticated;
grant execute on function private.user_has_org_role(uuid, text[]) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.sms_messages;
exception
  when duplicate_object then null;
end $$;
