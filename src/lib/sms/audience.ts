import type { SupabaseClient } from "@supabase/supabase-js";

export interface AudienceContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone_e164: string;
  sms_opt_out: boolean;
}

export async function loadAudienceContacts(
  db: SupabaseClient,
  args: {
    orgId: string;
    audience: "all" | "list";
    listId?: string | null;
  },
): Promise<{ contacts: AudienceContact[]; error?: string }> {
  if (args.audience === "list") {
    if (!args.listId) return { contacts: [], error: "Pick a saved list" };
    const { data: members, error } = await db
      .from("contact_list_members")
      .select("contact_id, contacts ( id, first_name, last_name, phone_e164, sms_opt_out )")
      .eq("list_id", args.listId)
      .eq("organisation_id", args.orgId);
    if (error) return { contacts: [], error: error.message };
    const contacts = (members ?? [])
      .map((row) => {
        const c = row.contacts as AudienceContact | AudienceContact[] | null;
        return Array.isArray(c) ? c[0] : c;
      })
      .filter((c): c is AudienceContact => Boolean(c));
    return { contacts };
  }

  const { data, error } = await db
    .from("contacts")
    .select("id, first_name, last_name, phone_e164, sms_opt_out")
    .eq("organisation_id", args.orgId);
  if (error) return { contacts: [], error: error.message };
  return { contacts: (data ?? []) as AudienceContact[] };
}

export function uniqueEligibleContacts(contacts: AudienceContact[]): AudienceContact[] {
  const seen = new Set<string>();
  return contacts.filter((c) => {
    if (c.sms_opt_out || !c.phone_e164 || seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

export function contactDisplayName(c: {
  first_name: string | null;
  last_name: string | null;
  phone_e164: string;
}): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return name || c.phone_e164;
}
