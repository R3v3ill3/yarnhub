-- Operator port: archive stamps, survey test flag, org test roster.
-- Tapbacks stay in message bodies and are folded in the inbox UI.

alter table public.sms_blasts
  add column if not exists archived_at timestamptz;

alter table public.sms_surveys
  add column if not exists archived_at timestamptz;

alter table public.sms_surveys
  add column if not exists is_test boolean not null default false;

alter table public.sms_relays
  add column if not exists archived_at timestamptz;

alter table public.sms_p2p_sends
  add column if not exists archived_at timestamptz;

create table if not exists public.sms_test_recipients (
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (organisation_id, contact_id)
);

alter table public.sms_test_recipients enable row level security;

drop policy if exists sms_test_recipients_all on public.sms_test_recipients;
create policy sms_test_recipients_all
  on public.sms_test_recipients for all to authenticated
  using (
    private.user_is_org_member(organisation_id)
    and exists (
      select 1
      from public.contacts
      where contacts.id = contact_id
        and contacts.organisation_id = sms_test_recipients.organisation_id
    )
  )
  with check (
    private.user_is_org_member(organisation_id)
    and exists (
      select 1
      from public.contacts
      where contacts.id = contact_id
        and contacts.organisation_id = sms_test_recipients.organisation_id
    )
  );

revoke all on table public.sms_test_recipients from anon, public;
grant select, insert, update, delete on table public.sms_test_recipients to authenticated;
