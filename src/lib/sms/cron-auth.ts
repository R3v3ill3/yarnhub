export type CronAuthResult = "ok" | "unauthorized" | "misconfigured";

/** Vercel cron sends `Authorization: Bearer <CRON_SECRET>`. */
export function authorizeCronRequest(
  authHeader: string | null,
  secret: string | undefined = process.env.CRON_SECRET,
): CronAuthResult {
  if (!secret) return "misconfigured";
  if (authHeader !== `Bearer ${secret}`) return "unauthorized";
  return "ok";
}
