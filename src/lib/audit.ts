import type { SupabaseClient } from "@supabase/supabase-js";

export async function writeAudit(
  db: SupabaseClient,
  args: {
    organisationId: string;
    actorUserId: string | null;
    action: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await db.from("audit_events").insert({
    organisation_id: args.organisationId,
    actor_user_id: args.actorUserId,
    action: args.action,
    payload: args.payload ?? {},
  });
  if (error) console.error("audit_events insert failed", error);
}
