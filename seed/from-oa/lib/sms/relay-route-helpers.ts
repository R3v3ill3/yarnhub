/**
 * Shared auth/lookup for the /api/sms/relays routes (Phase 6).
 *
 * Relays can be org-wide (campaign_id NULL), so they live under
 * /api/sms rather than /api/campaigns/[id]. Access rule (house
 * §7.0 posture): campaign-scoped relays require
 * can_write_to_campaign for mutations; org-wide relays are
 * mutable by any authenticated staff — but ONLY through these
 * routes: sms_relays/sms_relay_targets/sms_relay_messages are
 * service-role-write-only (the relay leg outranks conversational
 * routing, so a direct PostgREST write could hijack an organiser
 * number's inbound traffic). This check is therefore THE gate —
 * every route must call it before any admin-client write. Reads
 * are open to all authenticated staff.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SmsRelayRow } from "@/types/sms";

// User-scoped server client (untyped — relay tables are not in
// generated types until the migration is applied).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export type RelayAccess =
  | { ok: true; relay: SmsRelayRow }
  | { ok: false; status: 404 | 403; error: string };

/**
 * Load a relay and enforce the campaign write gate (explicit RPC
 * check — the admin client used for message-table side effects has
 * no RLS, so the route must check before it acts).
 */
export async function requireRelayWriteAccess(
  supabase: Db,
  relayId: number,
): Promise<RelayAccess> {
  const { data: relay, error } = await supabase
    .from("sms_relays")
    .select("*")
    .eq("relay_id", relayId)
    .maybeSingle();
  if (error) throw error;
  if (!relay) return { ok: false, status: 404, error: "Relay not found" };

  if (relay.campaign_id != null) {
    const { data: canWrite, error: permErr } = await supabase.rpc(
      "can_write_to_campaign",
      { p_campaign_id: relay.campaign_id },
    );
    if (permErr) throw permErr;
    if (!canWrite) {
      return {
        ok: false,
        status: 403,
        error: "No write access to this campaign",
      };
    }
  }
  return { ok: true, relay: relay as SmsRelayRow };
}
