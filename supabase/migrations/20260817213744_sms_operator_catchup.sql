-- Operator catch-up: consent source, conversation queue states,
-- in-thread notes, P2P item → conversation link.

alter table public.contacts
  add column if not exists sms_consent_source text;

alter table public.contacts
  drop constraint if exists contacts_sms_consent_source_chk;

alter table public.contacts
  add constraint contacts_sms_consent_source_chk
  check (
    sms_consent_source is null
    or sms_consent_source in ('manual', 'import', 'legacy')
  );

update public.sms_conversations
  set state = 'needs_reply'
  where unread_count > 0
    and state = 'open';

alter table public.sms_conversations
  drop constraint if exists sms_conversations_state_chk;

alter table public.sms_conversations
  add constraint sms_conversations_state_chk
  check (state in ('open', 'needs_reply', 'closed'));

alter table public.sms_p2p_send_items
  add column if not exists conversation_id uuid references public.sms_conversations (id) on delete set null;

create index if not exists sms_p2p_send_items_conversation_id_idx
  on public.sms_p2p_send_items (conversation_id);

create table if not exists public.sms_conversation_notes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  conversation_id uuid not null references public.sms_conversations (id) on delete cascade,
  author_user_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(trim(body)) >= 1),
  created_at timestamptz not null default now()
);

create index if not exists sms_conversation_notes_thread_idx
  on public.sms_conversation_notes (conversation_id, created_at);

alter table public.sms_conversation_notes enable row level security;

drop policy if exists sms_conversation_notes_all on public.sms_conversation_notes;
create policy sms_conversation_notes_all
  on public.sms_conversation_notes for all to authenticated
  using (private.user_is_org_member(organisation_id))
  with check (private.user_is_org_member(organisation_id));

revoke all on table public.sms_conversation_notes from anon, public;
grant select, insert, update, delete on table public.sms_conversation_notes to authenticated;
