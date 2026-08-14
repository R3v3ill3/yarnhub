"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-org-member";

export async function createFirstOrganisation(name: string): Promise<{
  error?: string;
  publicId?: string;
}> {
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    return { error: "Organisation name is required" };
  }
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("create_organisation", {
    p_name: trimmed,
  });
  if (error && !/already a member/i.test(error.message)) {
    return { error: error.message };
  }
  revalidatePath("/", "layout");
  const row = data as { public_id?: string } | { public_id?: string }[] | null;
  const publicId = Array.isArray(row) ? row[0]?.public_id : row?.public_id;
  return { publicId };
}
