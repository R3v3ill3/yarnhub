import { describe, expect, it } from "vitest";
import {
  decideInboundLeg,
  isLiveSurveySessionState,
  liveSurveySessionsConflict,
} from "../inbound";
import { P2P_SEND_CAP } from "../p2p";
import { isLiveRelayStatus } from "../relay-runtime";
import {
  filterInboxSafeSenders,
  filterRelaySenders,
  filterSurveySenders,
  inboxUnsafePurposeError,
  surveySenderPurposeWarning,
  surveySenderSortKey,
} from "../sender-purpose";

describe("inbound precedence", () => {
  it("is STOP → live survey by member phone → live relay by to-number → inbox", () => {
    expect(
      decideInboundLeg({ isStop: true, hasLiveSurvey: true, hasLiveRelay: true }),
    ).toBe("stop");
    expect(
      decideInboundLeg({ isStop: false, hasLiveSurvey: true, hasLiveRelay: true }),
    ).toBe("survey");
    expect(
      decideInboundLeg({ isStop: false, hasLiveSurvey: false, hasLiveRelay: true }),
    ).toBe("relay");
    expect(
      decideInboundLeg({ isStop: false, hasLiveSurvey: false, hasLiveRelay: false }),
    ).toBe("inbox");
  });

  it("never lets a live relay steal a STOP or a live survey answer", () => {
    expect(
      decideInboundLeg({ isStop: true, hasLiveSurvey: false, hasLiveRelay: true }),
    ).toBe("stop");
    expect(
      decideInboundLeg({ isStop: false, hasLiveSurvey: true, hasLiveRelay: false }),
    ).toBe("survey");
  });
});

describe("survey uniqueness (org + phone while invited/active)", () => {
  it("treats invited and active as live, and queued/completed/expired as not", () => {
    expect(isLiveSurveySessionState("invited")).toBe(true);
    expect(isLiveSurveySessionState("active")).toBe(true);
    expect(isLiveSurveySessionState("queued")).toBe(false);
    expect(isLiveSurveySessionState("completed")).toBe(false);
    expect(isLiveSurveySessionState("expired")).toBe(false);
    expect(isLiveSurveySessionState("opted_out")).toBe(false);
  });

  it("flags two live sessions on the same org phone", () => {
    expect(
      liveSurveySessionsConflict([
        { organisation_id: "org-a", phone_e164: "+61411111111", state: "invited" },
        { organisation_id: "org-a", phone_e164: "+61411111111", state: "active" },
      ]),
    ).toBe(true);
  });

  it("allows a live session plus a queued/completed row on the same phone", () => {
    expect(
      liveSurveySessionsConflict([
        { organisation_id: "org-a", phone_e164: "+61411111111", state: "active" },
        { organisation_id: "org-a", phone_e164: "+61411111111", state: "queued" },
        { organisation_id: "org-a", phone_e164: "+61411111111", state: "completed" },
      ]),
    ).toBe(false);
  });

  it("scopes uniqueness to the organisation, not globally by phone", () => {
    expect(
      liveSurveySessionsConflict([
        { organisation_id: "org-a", phone_e164: "+61411111111", state: "active" },
        { organisation_id: "org-b", phone_e164: "+61411111111", state: "invited" },
      ]),
    ).toBe(false);
  });
});

describe("one live relay per dedicated number", () => {
  it("treats active and paused as live, ended as free", () => {
    expect(isLiveRelayStatus("active")).toBe(true);
    expect(isLiveRelayStatus("paused")).toBe(true);
    expect(isLiveRelayStatus("ended")).toBe(false);
  });
});

describe("P2P / blast sender belt", () => {
  it("rejects survey and relay senders and caps P2P at 50", () => {
    expect(P2P_SEND_CAP).toBe(50);
    expect(inboxUnsafePurposeError("survey")).toBeTruthy();
    expect(inboxUnsafePurposeError("relay")).toBeTruthy();
    expect(inboxUnsafePurposeError("inbox")).toBeNull();
    expect(inboxUnsafePurposeError("spare")).toBeNull();
    expect(
      filterInboxSafeSenders([
        { purpose: "inbox" },
        { purpose: "survey" },
        { purpose: "relay" },
        { purpose: "spare" },
      ]).map((s) => s.purpose),
    ).toEqual(["inbox", "spare"]);
  });
});

describe("survey sender picker", () => {
  it("excludes relay, prefers survey, and warns on inbox", () => {
    const senders = [
      { purpose: "relay" },
      { purpose: "inbox" },
      { purpose: "survey" },
      { purpose: "spare" },
    ];
    expect(filterSurveySenders(senders).map((s) => s.purpose)).toEqual([
      "inbox",
      "survey",
      "spare",
    ]);
    expect(surveySenderSortKey({ purpose: "survey" })).toBeLessThan(
      surveySenderSortKey({ purpose: "inbox" }),
    );
    expect(surveySenderPurposeWarning("inbox")).toBeTruthy();
    expect(surveySenderPurposeWarning("survey")).toBeNull();
    expect(filterRelaySenders(senders).map((s) => s.purpose)).toEqual(["relay"]);
  });
});
