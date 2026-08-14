import { describe, expect, it } from "vitest";
import {
  GENERIC_MEMBER_CONTEXT,
  chooseBridgeMember,
  composeForwardBody,
  composeTargetReplyBody,
  decideMemberForward,
  matchPhoneInList,
  matchRelayTarget,
  renderRelayTemplate,
  resolveRelayDirection,
  type BridgeCandidate,
  type RelayTargetLike,
} from "@/lib/sms/relay-engine";

function target(overrides: Partial<RelayTargetLike> = {}): RelayTargetLike {
  return {
    target_id: 1,
    phone_e164: "+61411222333",
    display_name: "MP's office",
    is_active: true,
    ...overrides,
  };
}

describe("matchRelayTarget / resolveRelayDirection", () => {
  const targets = [
    target(),
    target({ target_id: 2, phone_e164: "+61499888777", display_name: null }),
  ];

  it("matches +614… / 614… / 04… forms of a target number", () => {
    for (const from of ["+61411222333", "61411222333", "0411222333"]) {
      expect(matchRelayTarget(targets, from)?.target_id).toBe(1);
    }
  });

  it("resolves a target sender to target_to_member with the target attached", () => {
    const decision = resolveRelayDirection(targets, "0499888777");
    expect(decision.direction).toBe("target_to_member");
    if (decision.direction === "target_to_member") {
      expect(decision.target.target_id).toBe(2);
    }
  });

  it("treats any non-target sender as a member", () => {
    expect(resolveRelayDirection(targets, "+61400000001").direction).toBe(
      "member_to_target",
    );
  });

  it("ignores INACTIVE targets — a deactivated target no longer bridges", () => {
    const deactivated = [target({ is_active: false })];
    expect(resolveRelayDirection(deactivated, "+61411222333").direction).toBe(
      "member_to_target",
    );
  });

  it("handles null/empty from", () => {
    expect(matchRelayTarget(targets, null)).toBeNull();
    expect(matchRelayTarget(targets, "")).toBeNull();
  });
});

describe("matchPhoneInList (own-number target guard)", () => {
  const ownNumbers = [
    { number_id: 1, phone_e164: "+61485900180" },
    { number_id: 2, phone_e164: "+61485900181" },
  ];

  it("flags a platform number in any submitted form", () => {
    for (const phone of ["+61485900180", "61485900180", "0485900180"]) {
      expect(matchPhoneInList(ownNumbers, phone)?.number_id).toBe(1);
    }
  });

  it("passes genuinely external numbers", () => {
    expect(matchPhoneInList(ownNumbers, "+61411222333")).toBeNull();
  });

  it("falls back to exact digit match for non-AU-mobile shapes", () => {
    const shortcodes = [{ phone_e164: "1776" }];
    expect(matchPhoneInList(shortcodes, "1776")).not.toBeNull();
    expect(matchPhoneInList(shortcodes, "1777")).toBeNull();
  });

  it("handles null/empty input", () => {
    expect(matchPhoneInList(ownNumbers, null)).toBeNull();
    expect(matchPhoneInList(ownNumbers, "")).toBeNull();
  });
});

describe("chooseBridgeMember (the bridging map)", () => {
  function cand(overrides: Partial<BridgeCandidate> = {}): BridgeCandidate {
    return {
      relay_message_id: 1,
      member_worker_id: 42,
      member_phone_e164: "+61400100014",
      forwarded_at: "2026-08-11T01:00:00Z",
      ...overrides,
    };
  }

  it("picks the most recently FORWARDED member", () => {
    const chosen = chooseBridgeMember([
      cand({ relay_message_id: 1, forwarded_at: "2026-08-11T01:00:00Z" }),
      cand({
        relay_message_id: 2,
        member_phone_e164: "+61400100099",
        forwarded_at: "2026-08-11T03:00:00Z",
      }),
    ]);
    expect(chosen?.member_phone_e164).toBe("+61400100099");
  });

  it("never bridges to a member whose message was not actually forwarded", () => {
    const chosen = chooseBridgeMember([
      cand({ relay_message_id: 9, forwarded_at: null }),
      cand({ relay_message_id: 1, forwarded_at: "2026-08-11T01:00:00Z" }),
    ]);
    expect(chosen?.relay_message_id).toBe(1);
  });

  it("breaks forwarded_at ties on the higher relay_message_id", () => {
    const chosen = chooseBridgeMember([
      cand({ relay_message_id: 1 }),
      cand({ relay_message_id: 5, member_phone_e164: "+61400100055" }),
    ]);
    expect(chosen?.relay_message_id).toBe(5);
  });

  it("returns null when no member has ever been forwarded", () => {
    expect(chooseBridgeMember([])).toBeNull();
    expect(chooseBridgeMember([cand({ forwarded_at: null })])).toBeNull();
    expect(
      chooseBridgeMember([cand({ member_phone_e164: null })]),
    ).toBeNull();
  });
});

describe("renderRelayTemplate / composeForwardBody", () => {
  const context = {
    first_name: "Alex",
    last_name: "Mitchell",
    employer_name: "Woodside Energy",
  };

  it("resolves worker merge fields", () => {
    expect(
      renderRelayTemplate(
        "Message from {{first_name}} {{last_name}} ({{employer_name}}):",
        context,
      ),
    ).toBe("Message from Alex Mitchell (Woodside Energy):");
  });

  it("strips unresolved tokens — a literal {{x}} must never reach a target", () => {
    expect(renderRelayTemplate("Hi {{unknown_token}} there", context)).toBe(
      "Hi there",
    );
  });

  it("renders the generic context for unmatched workers", () => {
    expect(
      renderRelayTemplate(
        "Message from {{first_name}} {{last_name}}:",
        GENERIC_MEMBER_CONTEXT,
      ),
    ).toBe("Message from A member :");
  });

  it("composes prefix + member message + suffix, dropping empty parts", () => {
    expect(
      composeForwardBody({
        prefixTemplate: "From {{first_name}}:",
        suffixTemplate: "— via Offshore Alliance",
        memberBody: "We want the EBA voted on.",
        context,
      }),
    ).toBe("From Alex:\nWe want the EBA voted on.\n— via Offshore Alliance");

    expect(
      composeForwardBody({
        prefixTemplate: null,
        suffixTemplate: null,
        memberBody: "  bare message  ",
        context,
      }),
    ).toBe("bare message");
  });
});

describe("composeTargetReplyBody", () => {
  it("prefixes the target display name when set", () => {
    expect(composeTargetReplyBody("MP's office", "Thanks, noted.")).toBe(
      "MP's office: Thanks, noted.",
    );
  });

  it("passes through untouched when no display name is set", () => {
    expect(composeTargetReplyBody(null, " Thanks. ")).toBe("Thanks.");
    expect(composeTargetReplyBody("  ", "Thanks.")).toBe("Thanks.");
  });
});

describe("decideMemberForward (the decision ladder)", () => {
  const base = {
    relayStatus: "active" as const,
    moderationRequired: false,
    quietHoursRespected: true,
    withinWindow: true,
  };

  it("forwards now on an active relay inside the window", () => {
    expect(decideMemberForward(base).kind).toBe("forward_now");
  });

  it("pause beats everything", () => {
    expect(
      decideMemberForward({
        ...base,
        relayStatus: "paused",
        moderationRequired: true,
        withinWindow: false,
      }).kind,
    ).toBe("held_paused");
  });

  it("moderation beats quiet hours (approval re-checks the window)", () => {
    expect(
      decideMemberForward({
        ...base,
        moderationRequired: true,
        withinWindow: false,
      }).kind,
    ).toBe("pending_moderation");
  });

  it("quiet hours defer when the window is closed", () => {
    expect(
      decideMemberForward({ ...base, withinWindow: false }).kind,
    ).toBe("deferred_quiet_hours");
  });

  it("ignores the window when quiet hours are not respected", () => {
    expect(
      decideMemberForward({
        ...base,
        quietHoursRespected: false,
        withinWindow: false,
      }).kind,
    ).toBe("forward_now");
  });
});
