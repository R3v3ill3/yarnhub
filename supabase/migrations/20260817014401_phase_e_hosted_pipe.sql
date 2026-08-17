-- Phase E: hosted MM pipe — KYC, suspend, number pool, credits, send slots.
-- Stripe checkout is billed against sms_credit_ledger; MM number purchase stays ops.

alter table public.organisations
  add column if not exists sending_suspended boolean not null default false,
  add column if not exists kyc_status text not null default 'none'
    check (kyc_status in ('none', 'pending', 'approved', 'rejected')),
  add column if not exists kyc_legal_name text,
  add column if not exists kyc_abn text,
  add column if not exists kyc_submitted_at timestamptz;

alter table public.provider_accounts
  drop constraint if exists provider_accounts_mode_check;

alter table public.provider_accounts
  add constraint provider_accounts_mode_check
  check (mode in ('byo', 'hosted'));

alter table public.provider_accounts
  alter column credentials_ciphertext drop not null;

create table public.platform_sms_accounts (
  id uuid primary key default gen_random_uuid(),
  label text not null default 'hosted',
  credentials_ciphertext text not null,
  webhook_secret_ciphertext text,
  created_at timestamptz not null default now()
);

create table public.hosted_number_pool (
  id uuid primary key default gen_random_uuid(),
  platform_account_id uuid not null references public.platform_sms_accounts (id) on delete restrict,
  phone_e164 text not null unique,
  label text,
  status text not null default 'available'
    check (status in ('available', 'assigned', 'retired')),
  assigned_organisation_id uuid references public.organisations (id) on delete set null,
  assigned_sms_number_id uuid references public.sms_numbers (id) on delete set null,
  assigned_at timestamptz,
  created_at timestamptz not null default now()
);

create index hosted_number_pool_status_idx
  on public.hosted_number_pool (status);

create table public.sms_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  delta integer not null check (delta <> 0),
  reason text not null,
  ref text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index sms_credit_ledger_org_idx
  on public.sms_credit_ledger (organisation_id, created_at desc);

create table public.sms_hosted_send_slots (
  slot smallint primary key check (slot between 1 and 5),
  leased_until timestamptz not null default to_timestamp(0),
  holder text
);

insert into public.sms_hosted_send_slots (slot)
values (1), (2), (3), (4), (5)
on conflict (slot) do nothing;

create table public.billing_checkout_intents (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  credits integer not null check (credits > 0),
  provider_ref text unique,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.platform_sms_accounts enable row level security;
alter table public.hosted_number_pool enable row level security;
alter table public.sms_credit_ledger enable row level security;
alter table public.sms_hosted_send_slots enable row level security;
alter table public.billing_checkout_intents enable row level security;

-- Pool / platform credentials / send slots: service role only (no authenticated policies).

create policy sms_credit_ledger_select
  on public.sms_credit_ledger for select to authenticated
  using (private.user_is_org_member(organisation_id));

create policy billing_checkout_intents_select
  on public.billing_checkout_intents for select to authenticated
  using (private.user_is_org_member(organisation_id));

create policy billing_checkout_intents_insert
  on public.billing_checkout_intents for insert to authenticated
  with check (private.user_has_org_role(organisation_id, array['owner', 'admin']::text[]));

revoke all on table public.platform_sms_accounts from anon, authenticated, public;
revoke all on table public.hosted_number_pool from anon, authenticated, public;
revoke all on table public.sms_hosted_send_slots from anon, authenticated, public;
revoke all on table public.sms_credit_ledger from anon, public;
revoke all on table public.billing_checkout_intents from anon, public;

grant select on table public.sms_credit_ledger to authenticated;
grant select, insert on table public.billing_checkout_intents to authenticated;

grant execute on function private.user_is_org_member(uuid) to authenticated;
grant execute on function private.user_has_org_role(uuid, text[]) to authenticated;
