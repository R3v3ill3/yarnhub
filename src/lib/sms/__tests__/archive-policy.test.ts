import { describe, expect, it } from "vitest";
import { archiveBlockReason } from "../archive-policy";

describe("archiveBlockReason", () => {
  it("treats paused as still live", () => {
    expect(archiveBlockReason("blast", "paused")).toMatch(/Cancel/);
    expect(archiveBlockReason("survey", "paused")).toMatch(/Close/);
    expect(archiveBlockReason("relay", "paused")).toMatch(/End/);
  });

  it("allows archive once the work is finished", () => {
    expect(archiveBlockReason("blast", "sent")).toBeNull();
    expect(archiveBlockReason("blast", "cancelled")).toBeNull();
    expect(archiveBlockReason("survey", "closed")).toBeNull();
    expect(archiveBlockReason("relay", "ended")).toBeNull();
  });
});
