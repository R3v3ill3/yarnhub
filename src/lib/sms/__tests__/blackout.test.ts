import { describe, expect, it } from "vitest";
import {
  computeSendBefore,
  isValidTimeZone,
  isWithinSendWindow,
  minutesOfDay,
  nextWindowOpen,
  windowClose,
} from "../blackout";

// Perth is UTC+8 year-round (no DST). Sydney is UTC+10 in winter.
const PERTH = "Australia/Perth";
const SYDNEY = "Australia/Sydney";

/** UTC instant helper. */
function utc(iso: string): Date {
  return new Date(iso);
}

describe("minutesOfDay", () => {
  it("converts a UTC instant into local minutes", () => {
    // 02:30 UTC = 10:30 Perth.
    expect(minutesOfDay(utc("2026-08-10T02:30:00Z"), PERTH)).toBe(10 * 60 + 30);
    // 02:30 UTC = 12:30 Sydney (winter, UTC+10).
    expect(minutesOfDay(utc("2026-08-10T02:30:00Z"), SYDNEY)).toBe(12 * 60 + 30);
  });
});

describe("isWithinSendWindow", () => {
  it("inside the window", () => {
    // 10:30 Perth
    expect(isWithinSendWindow(utc("2026-08-10T02:30:00Z"), PERTH)).toBe(true);
    // 19:59 Perth
    expect(isWithinSendWindow(utc("2026-08-10T11:59:00Z"), PERTH)).toBe(true);
    // 09:00 Perth exactly — open boundary inclusive
    expect(isWithinSendWindow(utc("2026-08-10T01:00:00Z"), PERTH)).toBe(true);
  });

  it("outside the window", () => {
    // 20:00 Perth exactly — close boundary exclusive
    expect(isWithinSendWindow(utc("2026-08-10T12:00:00Z"), PERTH)).toBe(false);
    // 08:59 Perth
    expect(isWithinSendWindow(utc("2026-08-10T00:59:00Z"), PERTH)).toBe(false);
    // 23:30 Perth
    expect(isWithinSendWindow(utc("2026-08-10T15:30:00Z"), PERTH)).toBe(false);
  });

  it("same instant differs by timezone", () => {
    // 22:30 UTC = 06:30 Perth (blocked) = 08:30 Sydney (blocked);
    // 23:30 UTC = 07:30 Perth (blocked) = 09:30 Sydney (open).
    expect(isWithinSendWindow(utc("2026-08-09T23:30:00Z"), PERTH)).toBe(false);
    expect(isWithinSendWindow(utc("2026-08-09T23:30:00Z"), SYDNEY)).toBe(true);
  });
});

describe("nextWindowOpen", () => {
  it("returns the input when already inside the window", () => {
    const d = utc("2026-08-10T02:30:00Z"); // 10:30 Perth
    expect(nextWindowOpen(d, PERTH).getTime()).toBe(d.getTime());
  });

  it("before 09:00 → 09:00 same day", () => {
    // 06:15 Perth → 09:00 Perth = 01:00 UTC
    const open = nextWindowOpen(utc("2026-08-09T22:15:00Z"), PERTH);
    expect(open.toISOString()).toBe("2026-08-10T01:00:00.000Z");
  });

  it("after 20:00 → 09:00 next day", () => {
    // 21:30 Perth (13:30 UTC) → next 09:00 Perth = 01:00 UTC next day
    const open = nextWindowOpen(utc("2026-08-10T13:30:00Z"), PERTH);
    expect(open.toISOString()).toBe("2026-08-11T01:00:00.000Z");
  });

  it("drops stray seconds", () => {
    const open = nextWindowOpen(utc("2026-08-10T13:30:42Z"), PERTH);
    expect(open.getUTCSeconds()).toBe(0);
  });
});

describe("windowClose", () => {
  it("inside window → today's 20:00 local", () => {
    // 10:30 Perth → close 20:00 Perth = 12:00 UTC
    const close = windowClose(utc("2026-08-10T02:30:00Z"), PERTH);
    expect(close.toISOString()).toBe("2026-08-10T12:00:00.000Z");
  });

  it("after hours → next day's 20:00 local", () => {
    // 21:30 Perth → close of next window = 20:00 Perth tomorrow
    const close = windowClose(utc("2026-08-10T13:30:00Z"), PERTH);
    expect(close.toISOString()).toBe("2026-08-11T12:00:00.000Z");
  });

  it("Sydney window closes at 10:00 UTC in winter", () => {
    const close = windowClose(utc("2026-08-10T02:30:00Z"), SYDNEY);
    expect(close.toISOString()).toBe("2026-08-10T10:00:00.000Z");
  });
});

describe("isValidTimeZone", () => {
  it("accepts real IANA zones", () => {
    expect(isValidTimeZone("Australia/Perth")).toBe(true);
    expect(isValidTimeZone("Australia/Sydney")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("rejects garbage and empty values", () => {
    expect(isValidTimeZone("Australia/Perthh")).toBe(false);
    expect(isValidTimeZone("not a zone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("computeSendBefore", () => {
  it("stamps the applicable window close", () => {
    const stamp = computeSendBefore(utc("2026-08-10T02:30:00Z"), PERTH);
    expect(stamp.toISOString()).toBe("2026-08-10T12:00:00.000Z");
  });

  it("override → 24h staleness guard, no window", () => {
    const at = utc("2026-08-10T13:30:00Z");
    const stamp = computeSendBefore(at, PERTH, true);
    expect(stamp.getTime()).toBe(at.getTime() + 24 * 60 * 60 * 1000);
  });
});
