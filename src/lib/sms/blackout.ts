/**
 * Blackout-window calculation for bulk SMS (brief §7.2 / decision 6).
 *
 * Default send window: 09:00–20:00 in the list's IANA timezone
 * (default Australia/Perth). Bulk sends outside the window are held
 * until it reopens unless the list carries a recorded
 * blackout_override. One-to-one replies (Phase 2) are never blocked.
 *
 * Pure module — unit tested in __tests__/blackout.test.ts. Uses
 * Intl.DateTimeFormat (no tz library). On the two DST-switch days a
 * next-window estimate can drift by an hour; the dispatcher re-checks
 * `isWithinSendWindow` at actual send time, so no message is sent
 * inside the blackout regardless.
 */

export const SEND_WINDOW_START_HOUR = 9;
export const SEND_WINDOW_END_HOUR = 20;
export const DEFAULT_SMS_TIMEZONE = "Australia/Perth";

/**
 * True when `tz` is an IANA timezone this runtime can evaluate. Guards
 * list create/update — an invalid stored timezone would otherwise make
 * every dispatch window check for that list throw forever.
 */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    // Intl can render midnight as 24 with hour12:false in some engines.
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Minutes since local midnight in the given timezone. */
export function minutesOfDay(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone);
  return p.hour * 60 + p.minute;
}

/** True when `date` falls inside the 09:00–20:00 send window in `timeZone`. */
export function isWithinSendWindow(
  date: Date,
  timeZone: string = DEFAULT_SMS_TIMEZONE
): boolean {
  const m = minutesOfDay(date, timeZone);
  return m >= SEND_WINDOW_START_HOUR * 60 && m < SEND_WINDOW_END_HOUR * 60;
}

/**
 * The next instant the send window is open: `date` itself when already
 * inside the window, else the upcoming 09:00 local.
 */
export function nextWindowOpen(
  date: Date,
  timeZone: string = DEFAULT_SMS_TIMEZONE
): Date {
  if (isWithinSendWindow(date, timeZone)) return date;
  const p = getZonedParts(date, timeZone);
  const nowMinutes = p.hour * 60 + p.minute;
  const openMinutes = SEND_WINDOW_START_HOUR * 60;
  let deltaMinutes: number;
  if (nowMinutes < openMinutes) {
    // Before 09:00 today.
    deltaMinutes = openMinutes - nowMinutes;
  } else {
    // At/after 20:00 — 09:00 tomorrow.
    deltaMinutes = 24 * 60 - nowMinutes + openMinutes;
  }
  // Drop seconds so the result lands on the minute boundary.
  return new Date(date.getTime() - p.second * 1000 + deltaMinutes * 60 * 1000);
}

/**
 * The close (20:00 local) of the window `date`'s send should happen in:
 * today's close when inside the window, else the close of the next
 * window. Used to stamp `sms_list_items.send_before` at queue time.
 */
export function windowClose(
  date: Date,
  timeZone: string = DEFAULT_SMS_TIMEZONE
): Date {
  const open = nextWindowOpen(date, timeZone);
  const p = getZonedParts(open, timeZone);
  const nowMinutes = p.hour * 60 + p.minute;
  const closeMinutes = SEND_WINDOW_END_HOUR * 60;
  const deltaMinutes = closeMinutes - nowMinutes;
  return new Date(open.getTime() - p.second * 1000 + deltaMinutes * 60 * 1000);
}

/**
 * `send_before` stamp for a message queued at `queuedAt` (or its
 * scheduled time when later): the close of the applicable send window.
 * With blackout_override there is no window — the stamp is 24h out,
 * purely as a staleness guard.
 */
export function computeSendBefore(
  queuedAt: Date,
  timeZone: string = DEFAULT_SMS_TIMEZONE,
  blackoutOverride = false
): Date {
  if (blackoutOverride) {
    return new Date(queuedAt.getTime() + 24 * 60 * 60 * 1000);
  }
  return windowClose(queuedAt, timeZone);
}
