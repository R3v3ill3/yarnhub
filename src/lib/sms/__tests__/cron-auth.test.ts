import { describe, expect, it } from "vitest";
import { authorizeCronRequest } from "../cron-auth";

describe("authorizeCronRequest", () => {
  it("rejects a missing secret", () => {
    expect(authorizeCronRequest("Bearer secret", undefined)).toBe("misconfigured");
  });

  it("rejects a bad bearer token", () => {
    expect(authorizeCronRequest("Bearer other", "secret")).toBe("unauthorized");
    expect(authorizeCronRequest(null, "secret")).toBe("unauthorized");
  });

  it("accepts the configured bearer token", () => {
    expect(authorizeCronRequest("Bearer secret", "secret")).toBe("ok");
  });
});
