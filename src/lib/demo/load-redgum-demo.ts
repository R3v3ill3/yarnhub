import type { SupabaseClient } from "@supabase/supabase-js";
import { demoId } from "@/lib/demo/demo-id";
import { isAcmaFictionMobile } from "@/lib/demo/fiction-phones";
import {
  buildRedgumPlan,
  DEMO_PROVIDER_CIPHERTEXT,
  type RedgumDemoPlan,
} from "@/lib/demo/redgum-bargaining";

type Admin = SupabaseClient;

async function must(
  label: string,
  query: PromiseLike<{ error: { message: string } | null }>,
) {
  const result = await query;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

function ids(rows: Array<Record<string, unknown>>, key = "id"): string[] {
  return rows.map((row) => String(row[key]));
}

async function removePlan(admin: Admin, plan: RedgumDemoPlan, deletePlaceholder: boolean) {
  const deliveryIds = ids(plan.deliveryEvents);
  const sendLogIds = ids(plan.sendLogs);
  const answerIds = ids(plan.answers);
  const sessionIds = ids(plan.sessions);
  const questionIds = ids(plan.questions);
  const surveyIds = ids(plan.surveys);
  const relayMessageIds = ids(plan.relayMessages);
  const relayTargetIds = ids(plan.relayTargets);
  const relayIds = ids(plan.relays);
  const p2pItemIds = ids(plan.p2pItems);
  const noteIds = ids(plan.notes);
  const messageIds = ids(plan.messages);
  const conversationIds = ids(plan.conversations);
  const p2pIds = ids(plan.p2pSends);
  const blastItemIds = ids(plan.blastItems);
  const blastIds = ids(plan.blasts);
  const listIds = ids(plan.lists);
  const cannedIds = ids(plan.canned);
  const contactIds = ids(plan.contacts);
  const numberIds = ids(plan.numbers);

  if (deliveryIds.length) {
    await must("clear delivery", admin.from("sms_delivery_events").delete().in("id", deliveryIds));
  }
  if (sendLogIds.length) {
    await must("clear send log", admin.from("sms_send_log").delete().in("id", sendLogIds));
  }
  if (answerIds.length) {
    await must("clear answers", admin.from("sms_survey_answers").delete().in("id", answerIds));
  }
  if (sessionIds.length) {
    await must("clear sessions", admin.from("sms_survey_sessions").delete().in("id", sessionIds));
  }
  if (questionIds.length) {
    await must("clear questions", admin.from("sms_survey_questions").delete().in("id", questionIds));
  }
  if (surveyIds.length) {
    await must("clear surveys", admin.from("sms_surveys").delete().in("id", surveyIds));
  }
  if (relayMessageIds.length) {
    await must("clear relay messages", admin.from("sms_relay_messages").delete().in("id", relayMessageIds));
  }
  if (relayTargetIds.length) {
    await must("clear relay targets", admin.from("sms_relay_targets").delete().in("id", relayTargetIds));
  }
  if (relayIds.length) {
    await must("clear relays", admin.from("sms_relays").delete().in("id", relayIds));
  }
  if (p2pItemIds.length) {
    await must("clear p2p items", admin.from("sms_p2p_send_items").delete().in("id", p2pItemIds));
  }
  if (noteIds.length) {
    await must("clear notes", admin.from("sms_conversation_notes").delete().in("id", noteIds));
  }
  if (messageIds.length) {
    await must("clear messages", admin.from("sms_messages").delete().in("id", messageIds));
  }
  if (conversationIds.length) {
    await must("clear conversations", admin.from("sms_conversations").delete().in("id", conversationIds));
  }
  if (p2pIds.length) {
    await must("clear p2p", admin.from("sms_p2p_sends").delete().in("id", p2pIds));
  }
  if (blastItemIds.length) {
    await must("clear blast items", admin.from("sms_blast_items").delete().in("id", blastItemIds));
  }
  if (blastIds.length) {
    await must("clear blasts", admin.from("sms_blasts").delete().in("id", blastIds));
  }
  if (listIds.length) {
    await must("clear list members", admin.from("contact_list_members").delete().in("list_id", listIds));
    await must("clear lists", admin.from("contact_lists").delete().in("id", listIds));
  }
  if (cannedIds.length) {
    await must("clear canned", admin.from("sms_canned_replies").delete().in("id", cannedIds));
  }
  if (contactIds.length) {
    await must("clear contacts", admin.from("contacts").delete().in("id", contactIds));
  }
  if (numberIds.length) {
    await must("clear numbers", admin.from("sms_numbers").delete().in("id", numberIds));
  }

  if (deletePlaceholder && plan.provider) {
    const { data: existing } = await admin
      .from("provider_accounts")
      .select("id, credentials_ciphertext")
      .eq("id", plan.provider.id)
      .maybeSingle();
    if (existing?.credentials_ciphertext === DEMO_PROVIDER_CIPHERTEXT) {
      await must(
        "clear placeholder provider",
        admin.from("provider_accounts").delete().eq("id", plan.provider.id),
      );
    }
  }
}

async function insertAll(admin: Admin, plan: RedgumDemoPlan, providerAccountId: string) {
  const numbers = plan.numbers.map((row) => ({
    ...row,
    provider_account_id: providerAccountId,
  }));
  await must("numbers", admin.from("sms_numbers").insert(numbers));
  await must("contacts", admin.from("contacts").insert(plan.contacts));
  await must("lists", admin.from("contact_lists").insert(plan.lists));
  await must("list members", admin.from("contact_list_members").insert(plan.listMembers));
  await must("canned", admin.from("sms_canned_replies").insert(plan.canned));
  await must("blasts", admin.from("sms_blasts").insert(plan.blasts));
  await must("blast items", admin.from("sms_blast_items").insert(plan.blastItems));
  await must("send log", admin.from("sms_send_log").insert(plan.sendLogs));
  await must("delivery", admin.from("sms_delivery_events").insert(plan.deliveryEvents));
  await must("conversations", admin.from("sms_conversations").insert(plan.conversations));
  await must("messages", admin.from("sms_messages").insert(plan.messages));
  await must("notes", admin.from("sms_conversation_notes").insert(plan.notes));
  await must("p2p", admin.from("sms_p2p_sends").insert(plan.p2pSends));
  await must("p2p items", admin.from("sms_p2p_send_items").insert(plan.p2pItems));
  await must("surveys", admin.from("sms_surveys").insert(plan.surveys));
  await must("questions", admin.from("sms_survey_questions").insert(plan.questions));
  await must("sessions", admin.from("sms_survey_sessions").insert(plan.sessions));
  await must("answers", admin.from("sms_survey_answers").insert(plan.answers));
  await must("relays", admin.from("sms_relays").insert(plan.relays));
  await must("relay targets", admin.from("sms_relay_targets").insert(plan.relayTargets));
  await must("relay messages", admin.from("sms_relay_messages").insert(plan.relayMessages));
}

export async function loadRedgumDemo(
  admin: Admin,
  orgId: string,
  userId: string,
): Promise<{ contacts: number; threads: number }> {
  const plan = buildRedgumPlan(orgId, userId);
  const phones = [
    ...plan.senderPhones,
    ...plan.contacts.map((row) => String(row.phone_e164)),
    ...plan.relayTargets.map((row) => String(row.phone_e164)),
  ];
  if (phones.some((phone) => !isAcmaFictionMobile(phone))) {
    throw new Error("Demo plan included a phone outside the ACMA fiction range");
  }

  const { data: taken } = await admin
    .from("sms_numbers")
    .select("id, phone_e164, organisation_id")
    .in("phone_e164", plan.senderPhones);
  const blocked = (taken ?? []).filter(
    (row) => row.organisation_id !== orgId && !plan.numbers.some((n) => n.id === row.id),
  );
  if (blocked.length > 0) {
    throw new Error(
      "The fiction sender numbers are already registered on another organisation, so this demo cannot be loaded here.",
    );
  }

  const { data: account } = await admin
    .from("provider_accounts")
    .select("id")
    .eq("organisation_id", orgId)
    .maybeSingle();

  let providerAccountId = account?.id as string | undefined;
  if (!providerAccountId && plan.provider) {
    await must("provider", admin.from("provider_accounts").insert(plan.provider));
    providerAccountId = plan.provider.id;
  }
  if (!providerAccountId) {
    throw new Error("No provider account available for demo numbers");
  }

  await removePlan(admin, plan, false);
  try {
    await insertAll(admin, plan, providerAccountId);
  } catch (err) {
    await removePlan(admin, plan, false).catch(() => undefined);
    throw err;
  }

  return { contacts: plan.contacts.length, threads: plan.conversations.length };
}

export async function removeRedgumDemo(admin: Admin, orgId: string, userId: string) {
  const plan = buildRedgumPlan(orgId, userId);
  await removePlan(admin, plan, true);
}

export function redgumDemoContactId(orgId: string): string {
  return demoId(orgId, "contact:priya");
}
