"use server";

import { revalidatePath } from "next/cache";
import { requireOrgMember } from "@/lib/auth/require-org-member";
import { toE164 } from "@/lib/phone/normalise-phone";
import { DEFAULT_RELAY_PREFIX_TEMPLATE } from "@/lib/sms/relay-engine";
import { isLiveRelayStatus } from "@/lib/sms/relay-runtime";
import { filterRelaySenders } from "@/lib/sms/sender-purpose";

function revalidateRelay(relayId?: string) {
  revalidatePath("/relays");
  if (relayId) revalidatePath(`/relays/${relayId}`);
}

async function loadOwnedRelay(
  supabase: Awaited<ReturnType<typeof requireOrgMember>>["supabase"],
  orgId: string,
  relayId: string,
) {
  const { data, error } = await supabase
    .from("sms_relays")
    .select("id, status, number_id")
    .eq("id", relayId)
    .eq("organisation_id", orgId)
    .maybeSingle();
  if (error) return { error: error.message as string, relay: null };
  if (!data) return { error: "Relay not found", relay: null };
  return { relay: data, error: null };
}

export async function createRelay(
  formData: FormData,
): Promise<{ error?: string; relayId?: string }> {
  const { org, user, supabase } = await requireOrgMember();
  const name = String(formData.get("name") ?? "").trim();
  const numberId = String(formData.get("numberId") ?? "");
  const prefix =
    String(formData.get("prefix_template") ?? "").trim() || DEFAULT_RELAY_PREFIX_TEMPLATE;
  const suffix = String(formData.get("suffix_template") ?? "").trim() || null;
  const quietHours = String(formData.get("quiet_hours_respected") ?? "") === "on";

  if (!name) return { error: "Name is required" };
  if (!numberId) return { error: "Pick a relay-purpose number" };

  const { data: number } = await supabase
    .from("sms_numbers")
    .select("id, purpose, status, phone_e164")
    .eq("id", numberId)
    .eq("organisation_id", org.id)
    .maybeSingle();
  if (!number || number.status !== "active") {
    return { error: "Unknown or retired number" };
  }
  if (!filterRelaySenders([number]).length) {
    return { error: "Set this number’s purpose to relay in Settings first" };
  }

  const phones = formData.getAll("target_phone").map((v) => String(v));
  const names = formData.getAll("target_name").map((v) => String(v));
  const targets: Array<{ phone_e164: string; display_name: string | null }> = [];
  const seen = new Set<string>();
  for (let i = 0; i < phones.length; i += 1) {
    const phone = toE164(phones[i] ?? "");
    if (!phone) continue;
    if (phone === number.phone_e164) {
      return { error: "A target cannot be the relay’s own number" };
    }
    if (seen.has(phone)) continue;
    seen.add(phone);
    targets.push({
      phone_e164: phone,
      display_name: (names[i] ?? "").trim() || null,
    });
  }

  const { data: relay, error } = await supabase
    .from("sms_relays")
    .insert({
      organisation_id: org.id,
      number_id: numberId,
      name,
      status: "paused",
      prefix_template: prefix,
      suffix_template: suffix,
      timezone: org.timezone,
      quiet_hours_respected: quietHours,
      moderation_required: false,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      return { error: "That number already has a live relay. End it before creating another." };
    }
    return { error: error.message };
  }

  if (targets.length > 0) {
    const { error: targetErr } = await supabase.from("sms_relay_targets").insert(
      targets.map((t) => ({
        organisation_id: org.id,
        relay_id: relay.id,
        phone_e164: t.phone_e164,
        display_name: t.display_name,
        is_active: true,
      })),
    );
    if (targetErr) {
      await supabase.from("sms_relays").delete().eq("id", relay.id);
      return { error: targetErr.message };
    }
  }

  revalidateRelay(relay.id);
  return { relayId: relay.id };
}

export async function updateRelay(
  formData: FormData,
): Promise<{ error?: string }> {
  const { org, supabase } = await requireOrgMember();
  const relayId = String(formData.get("relayId") ?? "");
  const prefix =
    String(formData.get("prefix_template") ?? "").trim() || DEFAULT_RELAY_PREFIX_TEMPLATE;
  const suffix = String(formData.get("suffix_template") ?? "").trim() || null;
  const quietHours = String(formData.get("quiet_hours_respected") ?? "") === "on";
  const loaded = await loadOwnedRelay(supabase, org.id, relayId);
  if (loaded.error || !loaded.relay) return { error: loaded.error ?? "Relay not found" };
  if (loaded.relay.status === "ended") return { error: "Ended relays cannot be edited" };

  const { error } = await supabase
    .from("sms_relays")
    .update({
      prefix_template: prefix,
      suffix_template: suffix,
      quiet_hours_respected: quietHours,
    })
    .eq("id", relayId)
    .eq("organisation_id", org.id);
  if (error) return { error: error.message };
  revalidateRelay(relayId);
  return {};
}

export async function setRelayStatus(
  formData: FormData,
): Promise<{ error?: string }> {
  const { org, supabase } = await requireOrgMember();
  const relayId = String(formData.get("relayId") ?? "");
  const action = String(formData.get("action") ?? "");
  const loaded = await loadOwnedRelay(supabase, org.id, relayId);
  if (loaded.error || !loaded.relay) return { error: loaded.error ?? "Relay not found" };

  if (action === "activate") {
    if (loaded.relay.status === "ended") {
      return { error: "Ended relays cannot be reactivated — create a new one" };
    }
    const { data: targets } = await supabase
      .from("sms_relay_targets")
      .select("id")
      .eq("relay_id", relayId)
      .eq("is_active", true)
      .limit(1);
    if (!targets?.length) {
      return { error: "Add at least one active target before activating" };
    }
    const { error } = await supabase
      .from("sms_relays")
      .update({ status: "active", ended_at: null })
      .eq("id", relayId)
      .eq("organisation_id", org.id);
    if (error) {
      if (error.code === "23505") {
        return { error: "That number already has a live relay" };
      }
      return { error: error.message };
    }
  } else if (action === "pause") {
    if (loaded.relay.status !== "active") return { error: "Only an active relay can be paused" };
    const { error } = await supabase
      .from("sms_relays")
      .update({ status: "paused" })
      .eq("id", relayId)
      .eq("organisation_id", org.id);
    if (error) return { error: error.message };
  } else if (action === "end") {
    if (!isLiveRelayStatus(loaded.relay.status)) {
      return { error: "Relay is already ended" };
    }
    const { error } = await supabase
      .from("sms_relays")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", relayId)
      .eq("organisation_id", org.id);
    if (error) return { error: error.message };
  } else {
    return { error: "Unknown action" };
  }

  revalidateRelay(relayId);
  return {};
}

export async function addRelayTarget(
  formData: FormData,
): Promise<{ error?: string }> {
  const { org, supabase } = await requireOrgMember();
  const relayId = String(formData.get("relayId") ?? "");
  const phone = toE164(String(formData.get("phone") ?? ""));
  const displayName = String(formData.get("display_name") ?? "").trim() || null;
  if (!phone) return { error: "Enter a valid Australian mobile for the target" };

  const loaded = await loadOwnedRelay(supabase, org.id, relayId);
  if (loaded.error || !loaded.relay) return { error: loaded.error ?? "Relay not found" };
  if (loaded.relay.status === "ended") return { error: "Ended relays cannot add targets" };

  const { data: number } = await supabase
    .from("sms_numbers")
    .select("phone_e164")
    .eq("id", loaded.relay.number_id)
    .maybeSingle();
  if (number?.phone_e164 === phone) {
    return { error: "A target cannot be the relay’s own number" };
  }

  const { error } = await supabase.from("sms_relay_targets").insert({
    organisation_id: org.id,
    relay_id: relayId,
    phone_e164: phone,
    display_name: displayName,
    is_active: true,
  });
  if (error) {
    if (error.code === "23505") return { error: "That phone is already a target on this relay" };
    return { error: error.message };
  }
  revalidateRelay(relayId);
  return {};
}

export async function setRelayTargetActive(
  formData: FormData,
): Promise<{ error?: string }> {
  const { org, supabase } = await requireOrgMember();
  const relayId = String(formData.get("relayId") ?? "");
  const targetId = String(formData.get("targetId") ?? "");
  const isActive = String(formData.get("is_active") ?? "") === "true";
  const loaded = await loadOwnedRelay(supabase, org.id, relayId);
  if (loaded.error || !loaded.relay) return { error: loaded.error ?? "Relay not found" };
  if (loaded.relay.status === "ended") return { error: "Ended relays cannot change targets" };

  const { error } = await supabase
    .from("sms_relay_targets")
    .update({ is_active: isActive })
    .eq("id", targetId)
    .eq("relay_id", relayId)
    .eq("organisation_id", org.id);
  if (error) return { error: error.message };
  revalidateRelay(relayId);
  return {};
}
