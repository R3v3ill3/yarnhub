import type { SupabaseClient } from "@supabase/supabase-js";

export const SMS_CONSENT_SOURCES = ["manual", "import", "legacy"] as const;
export type SmsConsentSource = (typeof SMS_CONSENT_SOURCES)[number];

export const CONSENT_ATTESTATION =
  "I confirm these people gave this organisation consent to send them SMS (membership form, signup sheet, or direct request).";

export async function insertContactList(
  supabase: SupabaseClient,
  args: {
    orgId: string;
    name: string;
    contactIds: string[];
  },
): Promise<{ listId?: string; error?: string }> {
  const name = args.name.trim();
  if (!name) return { error: "List name is required" };
  const uniqueIds = [...new Set(args.contactIds.filter(Boolean))];
  if (uniqueIds.length === 0) return { error: "The list has no contacts" };

  const { data: list, error: listError } = await supabase
    .from("contact_lists")
    .insert({ organisation_id: args.orgId, name })
    .select("id")
    .single();
  if (listError) return { error: listError.message };

  const { error: memberError } = await supabase.from("contact_list_members").insert(
    uniqueIds.map((contact_id) => ({
      list_id: list.id,
      contact_id,
      organisation_id: args.orgId,
    })),
  );
  if (memberError) {
    await supabase.from("contact_lists").delete().eq("id", list.id);
    return { error: memberError.message };
  }
  return { listId: list.id as string };
}
