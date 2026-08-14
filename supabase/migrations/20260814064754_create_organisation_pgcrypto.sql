-- pgcrypto is installed in schema `extensions` on hosted Supabase.
-- private.create_organisation used search_path = public, so
-- gen_random_bytes() was not found and first-org signup failed.

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

  pid := encode(extensions.gen_random_bytes(12), 'hex');
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

-- Own membership rows must be readable so first login can route to inbox
-- vs onboarding without depending on the org-scoped helper alone.
drop policy if exists organisation_members_select on public.organisation_members;
create policy organisation_members_select
  on public.organisation_members for select to authenticated
  using (
    user_id = auth.uid()
    or private.user_is_org_member(organisation_id)
  );
