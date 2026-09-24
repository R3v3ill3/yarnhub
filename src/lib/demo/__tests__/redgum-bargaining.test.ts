import { describe, expect, it } from "vitest";
import { isAcmaFictionMobile } from "@/lib/demo/fiction-phones";
import { buildRedgumPlan, P2P_STEPS, REDGUM_BLAST_BODY } from "@/lib/demo/redgum-bargaining";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

describe("Redgum bargaining demo", () => {
  const plan = buildRedgumPlan(ORG, USER, new Date("2026-09-20T04:00:00.000Z"));

  it("uses only ACMA fiction mobiles", () => {
    const phones = [
      ...plan.senderPhones,
      ...plan.contacts.map((row) => String(row.phone_e164)),
      ...plan.relayTargets.map((row) => String(row.phone_e164)),
      ...plan.messages.map((row) => String(row.phone_e164)),
    ];
    expect(phones.length).toBeGreaterThan(20);
    expect(phones.every((phone) => isAcmaFictionMobile(phone))).toBe(true);
  });

  it("keeps four distinct outreach steps and does not queue them", () => {
    expect(plan.p2pSends).toHaveLength(4);
    expect(plan.p2pSends.map((row) => row.body_template)).toEqual(
      P2P_STEPS.map((step) => step.template),
    );
    expect(plan.p2pSends.every((row) => row.status === "sent")).toBe(true);
    expect(plan.p2pItems.every((row) => row.status === "sent")).toBe(true);
    const priya = plan.messages.filter(
      (row) =>
        row.conversation_id === plan.conversations.find((c) => String(c.phone_e164).endsWith("570157"))?.id &&
        row.direction === "outbound",
    );
    const bodies = priya.map((row) => String(row.body)).join("\n");
    expect(bodies).toContain("two minutes");
    expect(bodies).toContain("short-crewed");
    expect(bodies).toContain("Forty people");
    expect(bodies).toContain("classification and shift");
  });

  it("records the refusal blast and a hypothetical petition link", () => {
    expect(plan.blasts[0]?.name).toBe("Management refuses to bargain");
    expect(plan.blasts[0]?.status).toBe("sent");
    expect(String(plan.blasts[0]?.body)).toContain("refused to bargain");
    expect(REDGUM_BLAST_BODY).toContain("https://example.com/redgum-majority-support");
    const statuses = plan.blastItems.map((row) => row.status);
    expect(statuses).toContain("sent");
    expect(statuses).toContain("failed");
    expect(statuses).toContain("opted_out");
    expect(plan.sendLogs.some((row) => row.status === "queued")).toBe(false);
  });

  it("spreads the log-of-claims survey across the funnel without a live send", () => {
    expect(plan.surveys[0]?.title).toBe("Log of claims — Redgum Resources");
    expect(plan.surveys[0]?.status).toBe("paused");
    expect(plan.questions.map((row) => row.qtype)).toEqual(["yes_no", "choice", "scale", "yes_no"]);
    const states = plan.sessions.map((row) => row.state);
    for (const state of ["completed", "active", "invited", "expired", "opted_out", "undeliverable"]) {
      expect(states).toContain(state);
    }
    const live = plan.sessions.filter((row) => row.state === "invited" || row.state === "active");
    const phones = live.map((row) => row.phone_e164);
    expect(new Set(phones).size).toBe(phones.length);
    expect(plan.answers.some((row) => row.parsed_value === "safety")).toBe(true);
  });

  it("relays member pressure to a fictional HR manager, already delivered", () => {
    expect(plan.relays[0]?.name).toBe("Members to HR — bargain properly");
    expect(plan.relays[0]?.status).toBe("active");
    expect(plan.relayTargets[0]?.display_name).toContain("HR");
    expect(plan.relayMessages.length).toBeGreaterThanOrEqual(4);
    expect(plan.relayMessages.every((row) => row.forward_status === "delivered")).toBe(true);
    expect(
      plan.relayMessages.some((row) => String(row.forwarded_body).includes("bargain")),
    ).toBe(true);
  });

  it("rebuilds the same ids for the same organisation", () => {
    const again = buildRedgumPlan(ORG, USER);
    expect(again.contacts[0]?.id).toBe(plan.contacts[0]?.id);
    expect(again.contacts[0]?.id).not.toBe(buildRedgumPlan(USER, USER).contacts[0]?.id);
  });
});
