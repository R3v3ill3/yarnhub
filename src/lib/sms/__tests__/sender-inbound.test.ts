import { describe, expect, it } from "vitest";
import {
  HANDSET_SENDER_MESSAGE,
  ONE_WAY_SENDER_MESSAGE,
  classifyProviderSenderType,
  inboundCheckForPhone,
} from "../sender-inbound";

describe("classifyProviderSenderType", () => {
  it("treats dedicated and shared numbers as inbound-capable", () => {
    expect(classifyProviderSenderType("dedicated_number", "61485900180")).toBe("inbound");
    expect(classifyProviderSenderType("shared", "+61400000001")).toBe("inbound");
  });

  it("treats own-mobile as handset and alpha as one-way", () => {
    expect(classifyProviderSenderType("own", "0412345678")).toBe("handset");
    expect(classifyProviderSenderType("alpha", "YARNHUB")).toBe("one_way");
  });
});

describe("inboundCheckForPhone", () => {
  it("rejects handset and alphanumeric senders", () => {
    expect(
      inboundCheckForPhone("+61412345678", [{ sender: "61412345678", type: "own" }]),
    ).toBe(HANDSET_SENDER_MESSAGE);
    expect(inboundCheckForPhone("YARNHUB", [{ sender: "YARNHUB", type: "alpha" }])).toBe(
      ONE_WAY_SENDER_MESSAGE,
    );
  });

  it("allows a dedicated number", () => {
    expect(
      inboundCheckForPhone("+61485900180", [
        { sender: "61485900180", type: "dedicated_number" },
      ]),
    ).toBeNull();
  });
});
