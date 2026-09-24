import { describe, expect, it } from "vitest";
import {
  computeBlastCohortContactIds,
  computeSurveyCohortContactIds,
} from "../reporting-cohorts";

describe("computeBlastCohortContactIds", () => {
  const items = [
    { contact_id: "a", status: "delivered", sent_at: "2026-09-01T00:00:00Z" },
    { contact_id: "b", status: "delivered", sent_at: "2026-09-01T00:00:00Z" },
    { contact_id: "c", status: "failed", sent_at: "2026-09-01T00:00:00Z" },
  ];
  const inbound = new Map([["a", "2026-09-01T01:00:00Z"]]);

  it("splits replied, silent delivered, and failed", () => {
    expect(computeBlastCohortContactIds(items, inbound, "replied")).toEqual(["a"]);
    expect(computeBlastCohortContactIds(items, inbound, "delivered_not_replied")).toEqual(["b"]);
    expect(computeBlastCohortContactIds(items, inbound, "failed")).toEqual(["c"]);
  });
});

describe("computeSurveyCohortContactIds", () => {
  const sessions = [
    { contact_id: "done", state: "completed", first_answer_at: "t" },
    { contact_id: "mid", state: "active", first_answer_at: "t" },
    { contact_id: "quiet", state: "invited", first_answer_at: null },
    { contact_id: "stopped", state: "opted_out", first_answer_at: null },
  ];

  it("keeps opted-out people out of non-responders", () => {
    expect(computeSurveyCohortContactIds(sessions, "completed")).toEqual(["done"]);
    expect(computeSurveyCohortContactIds(sessions, "started_not_completed")).toEqual(["mid"]);
    expect(computeSurveyCohortContactIds(sessions, "non_responders")).toEqual(["quiet"]);
  });
});
