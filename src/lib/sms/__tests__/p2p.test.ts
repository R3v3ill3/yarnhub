import { describe, expect, it } from "vitest";
import {
  P2P_SEND_CAP,
  filterP2pItems,
  isP2pSendable,
  p2pBodyOverrideToStore,
  p2pItemTemplate,
  pruneP2pSelection,
  renderP2pBody,
  selectNextN,
  type P2pBoardItemLike,
} from "../p2p";

function item(overrides: Partial<P2pBoardItemLike> & { item_id: number }): P2pBoardItemLike {
  return {
    status: "pending",
    worker_name: "Alex Mitchell",
    employer_name: "Woodside Energy",
    phone_e164: "+61412345678",
    sms_opt_out: false,
    ...overrides,
  };
}

describe("p2pItemTemplate", () => {
  it("uses the board template when the override is null/blank", () => {
    expect(p2pItemTemplate("Hi {{first_name}}", null)).toBe("Hi {{first_name}}");
    expect(p2pItemTemplate("Hi {{first_name}}", "   ")).toBe("Hi {{first_name}}");
  });

  it("uses a custom override when present", () => {
    expect(p2pItemTemplate("Hi {{first_name}}", "G'day Sam — just me")).toBe(
      "G'day Sam — just me",
    );
  });
});

describe("p2pBodyOverrideToStore", () => {
  const board = "Hi {{first_name}}, meeting Tuesday. - Offshore Alliance";

  it("stores null when the edit matches the board default", () => {
    expect(p2pBodyOverrideToStore(board, board)).toBeNull();
    expect(p2pBodyOverrideToStore(board, `  ${board}  `)).toBeNull();
  });

  it("stores null for an empty edit (treat as revert)", () => {
    expect(p2pBodyOverrideToStore(board, "   ")).toBeNull();
  });

  it("keeps a customised body, including one with merge fields removed", () => {
    expect(p2pBodyOverrideToStore(board, "Hi Alex, Tuesday still on?")).toBe(
      "Hi Alex, Tuesday still on?",
    );
    expect(p2pBodyOverrideToStore(board, "Hi {{first_name}} — just checking in")).toBe(
      "Hi {{first_name}} — just checking in",
    );
  });
});

describe("renderP2pBody", () => {
  it("resolves known tokens and strips unknown leftovers", () => {
    expect(
      renderP2pBody("Hi {{first_name}}, {{mystery}} — Offshore Alliance", {
        first_name: "Sam",
      }),
    ).toBe("Hi Sam, — Offshore Alliance");
  });

  it("collapses doubled spaces from stripped tokens but keeps newlines", () => {
    expect(renderP2pBody("A {{gone}} B\nC", {})).toBe("A B\nC");
  });
});

describe("filterP2pItems", () => {
  const items = [
    item({ item_id: 1, worker_name: "Alex Mitchell" }),
    item({ item_id: 2, worker_name: "Sam Ngata", employer_name: "Chevron" }),
    item({ item_id: 3, worker_name: "Dana Cole", status: "sent" }),
  ];

  it("matches name case-insensitively", () => {
    expect(
      filterP2pItems(items, { search: "alex", status: "all" }).map((i) => i.item_id),
    ).toEqual([1]);
  });

  it("matches employer", () => {
    expect(
      filterP2pItems(items, { search: "chev", status: "all" }).map((i) => i.item_id),
    ).toEqual([2]);
  });

  it("matches phone digits", () => {
    expect(
      filterP2pItems(items, { search: "61412", status: "all" }),
    ).toHaveLength(3);
  });

  it("filters by status", () => {
    expect(
      filterP2pItems(items, { search: "", status: "sent" }).map((i) => i.item_id),
    ).toEqual([3]);
  });
});

describe("isP2pSendable", () => {
  it("requires a sendable status, a phone, and no opt-out", () => {
    expect(isP2pSendable(item({ item_id: 1 }))).toBe(true);
    expect(isP2pSendable(item({ item_id: 1, status: "sent" }))).toBe(false);
    expect(isP2pSendable(item({ item_id: 1, sms_opt_out: true }))).toBe(false);
    expect(isP2pSendable(item({ item_id: 1, phone_e164: null }))).toBe(false);
  });

  it("failed rows stay retryable (transient provider outages must not retire them)", () => {
    expect(isP2pSendable(item({ item_id: 1, status: "failed" }))).toBe(true);
    expect(
      isP2pSendable(item({ item_id: 1, status: "failed", sms_opt_out: true })),
    ).toBe(false);
  });

  it("never treats terminal/holding statuses as sendable", () => {
    for (const status of ["sending", "queued", "delivered", "skipped", "opted_out", "blocked"]) {
      expect(isP2pSendable(item({ item_id: 1, status }))).toBe(false);
    }
  });
});

describe("selectNextN", () => {
  const items = [
    item({ item_id: 1 }),
    item({ item_id: 2, status: "sent" }),
    item({ item_id: 3 }),
    item({ item_id: 4, sms_opt_out: true }),
    item({ item_id: 5 }),
    item({ item_id: 6 }),
  ];

  it("extends the selection with the next N sendable, unselected items", () => {
    const next = selectNextN(items, new Set([1]), 2);
    expect([...next].sort()).toEqual([1, 3, 5]);
  });

  it("skips non-sendable rows entirely", () => {
    const next = selectNextN(items, new Set(), 10);
    expect([...next].sort()).toEqual([1, 3, 5, 6]);
  });

  it("returns the selection unchanged for n <= 0", () => {
    expect([...selectNextN(items, new Set([3]), 0)]).toEqual([3]);
  });

  it("includes failed rows (retryable)", () => {
    const withFailed = [
      item({ item_id: 1, status: "failed" }),
      item({ item_id: 2, status: "sent" }),
      item({ item_id: 3 }),
    ];
    expect([...selectNextN(withFailed, new Set(), 2)].sort()).toEqual([1, 3]);
  });

  it("never grows past the send cap", () => {
    const many = Array.from({ length: P2P_SEND_CAP + 20 }, (_, i) =>
      item({ item_id: i + 1 }),
    );
    const next = selectNextN(many, new Set(), P2P_SEND_CAP + 20);
    expect(next.size).toBe(P2P_SEND_CAP);
  });
});

describe("pruneP2pSelection", () => {
  it("drops rows that were sent or opted out since selection", () => {
    const items = [
      item({ item_id: 1 }),
      item({ item_id: 2, status: "sent" }),
      item({ item_id: 3, sms_opt_out: true }),
    ];
    const next = pruneP2pSelection(items, new Set([1, 2, 3, 99]));
    expect([...next]).toEqual([1]);
  });
});
