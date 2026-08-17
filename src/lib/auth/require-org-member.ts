import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { Organisation, OrgRole } from "@/lib/supabase/types";

export class NotAuthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "NotAuthenticatedError";
  }
}

export async function getSessionUser() {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return { user, supabase: await createClient() };
}

export async function requireOrgMember(): Promise<{
  user: { id: string; email?: string };
  supabase: Awaited<ReturnType<typeof createClient>>;
  org: Organisation;
  role: OrgRole;
}> {
  const { user, supabase } = await requireUser();
  const { data, error } = await supabase
    .from("organisation_members")
    .select(
      "organisation_id, role, organisations ( id, name, slug, public_id, timezone, created_at, sending_suspended, kyc_status, kyc_legal_name, kyc_abn )",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (error && error.code !== "PGRST116") throw error;
  const org = data?.organisations as Organisation | Organisation[] | null;
  const resolved = Array.isArray(org) ? org[0] : org;
  if (!data || !resolved) redirect("/onboarding");

  return {
    user: { id: user.id, email: user.email },
    supabase,
    org: resolved,
    role: data.role as OrgRole,
  };
}

export async function getOrgMembership() {
  if (!isSupabaseConfigured()) return null;
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("organisation_members")
    .select(
      "organisation_id, role, organisations ( id, name, slug, public_id, timezone, created_at, sending_suspended, kyc_status, kyc_legal_name, kyc_abn )",
    )
    .eq("user_id", user.id)
    .maybeSingle();
  const org = data?.organisations as Organisation | Organisation[] | null;
  const resolved = Array.isArray(org) ? org[0] : org;
  if (!data || !resolved) return { user, org: null, role: null };
  return { user, org: resolved, role: data.role as OrgRole };
}
