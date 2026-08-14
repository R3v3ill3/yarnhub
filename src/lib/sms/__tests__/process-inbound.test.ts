import { describe, expect, it } from "vitest";
import { terminalDeliveryStatus } from "../process-inbound";

describe("terminalDeliveryStatus", () => {
  it("promotes only delivered and failed/cancelled", () => {
    expect(terminalDeliveryStatus("delivered")).toBe("delivered");
    expect(terminalDeliveryStatus("failed")).toBe("failed");
    expect(terminalDeliveryStatus("cancelled")).toBe("failed");
  });

  it("ignores in-flight statuses so a later delivered cannot be overwritten", () => {
    expect(terminalDeliveryStatus("sent")).toBeNull();
    expect(terminalDeliveryStatus("pending")).toBeNull();
    expect(terminalDeliveryStatus("scheduled")).toBeNull();
    expect(terminalDeliveryStatus("unknown")).toBeNull();
  });
});
