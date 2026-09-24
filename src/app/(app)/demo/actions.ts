"use server";

import { revalidatePath } from "next/cache";
import { destructiveRoleError } from "@/lib/auth/roles";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { loadRedgumDemo, removeRedgumDemo } from "@/lib/demo/load-redgum-demo";
import { createAdminClient } from "@/lib/supabase/admin";

function refresh() {
  for (const path of ["/demo", "/inbox", "/blasts", "/p2p", "/surveys", "/relays", "/contacts", "/reports", "/settings"]) {
    revalidatePath(path);
  }
}

export async function loadBargainingDemo(): Promise<{ error?: string; contacts?: number; threads?: number }> {
  const { org, user, role } = await requireOrgMember();
  const blocked = destructiveRoleError(role);
  if (blocked) return { error: blocked };
  try {
    const result = await loadRedgumDemo(createAdminClient(), org.id, user.id);
    refresh();
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not load demo data" };
  }
}

export async function removeBargainingDemo(): Promise<{ error?: string }> {
  const { org, user, role } = await requireOrgMember();
  const blocked = destructiveRoleError(role);
  if (blocked) return { error: blocked };
  try {
    await removeRedgumDemo(createAdminClient(), org.id, user.id);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not remove demo data" };
  }
}
