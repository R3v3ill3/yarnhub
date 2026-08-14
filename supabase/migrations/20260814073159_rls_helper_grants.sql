-- RLS policies call these SECURITY DEFINER helpers as the querying role.
-- EXECUTE was revoked from authenticated, so membership + org embeds
-- returned 403 after signup (permission denied for function user_is_org_member).

grant execute on function private.user_is_org_member(uuid) to authenticated;
grant execute on function private.user_has_org_role(uuid, text[]) to authenticated;
