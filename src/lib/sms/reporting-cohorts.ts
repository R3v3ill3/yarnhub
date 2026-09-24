export type BlastCohort = "replied" | "delivered_not_replied" | "failed";

export type SurveyCohort = "completed" | "started_not_completed" | "non_responders";

export const BLAST_COHORT_LABELS: Record<BlastCohort, string> = {
  replied: "replied",
  delivered_not_replied: "delivered, no reply",
  failed: "failed",
};

export const SURVEY_COHORT_LABELS: Record<SurveyCohort, string> = {
  completed: "completed",
  started_not_completed: "started, not completed",
  non_responders: "non-responders",
};

export interface BlastCohortItem {
  contact_id: string;
  status: string;
  sent_at: string | null;
}

/**
 * Replied means this contact has inbound traffic at or after the item's
 * send time. Delivered-with-no-reply uses delivery status and the same stamp.
 */
export function computeBlastCohortContactIds(
  items: BlastCohortItem[],
  lastInboundByContact: Map<string, string>,
  cohort: BlastCohort,
): string[] {
  const out = new Set<string>();
  for (const item of items) {
    if (cohort === "failed") {
      if (item.status === "failed") out.add(item.contact_id);
      continue;
    }
    const inboundAt = lastInboundByContact.get(item.contact_id);
    const replied =
      item.sent_at != null &&
      inboundAt != null &&
      Date.parse(inboundAt) >= Date.parse(item.sent_at);
    if (cohort === "replied") {
      if (replied) out.add(item.contact_id);
    } else if (item.status === "delivered" && !replied) {
      out.add(item.contact_id);
    }
  }
  return [...out];
}

export interface SurveyCohortSession {
  contact_id: string;
  state: string;
  first_answer_at: string | null;
}

/**
 * Non-responders exclude opted-out sessions. A STOP is a response, and
 * a follow-up list must not re-target people who opted out.
 */
export function computeSurveyCohortContactIds(
  sessions: SurveyCohortSession[],
  cohort: SurveyCohort,
): string[] {
  const out = new Set<string>();
  for (const session of sessions) {
    if (cohort === "completed") {
      if (session.state === "completed") out.add(session.contact_id);
    } else if (cohort === "started_not_completed") {
      if (session.first_answer_at != null && session.state !== "completed") {
        out.add(session.contact_id);
      }
    } else if (session.first_answer_at == null && session.state !== "opted_out") {
      out.add(session.contact_id);
    }
  }
  return [...out];
}
