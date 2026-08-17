"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-org-member";

export async function acceptInvite(token: string): Promise<{ error?: string }> {
  const trimmed = token.trim();
  if (!trimmed) return { error: "Missing invite token" };
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("accept_organisation_invite", {
    p_token: trimmed,
  });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return {};
}
