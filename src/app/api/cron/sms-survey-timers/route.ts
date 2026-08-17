import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeCronRequest } from "@/lib/sms/cron-auth";
import { processSurveyTimers } from "@/lib/sms/survey-timers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function run(request: Request) {
  const auth = authorizeCronRequest(request.headers.get("authorization"));
  if (auth === "misconfigured") {
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  }
  if (auth === "unauthorized") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await processSurveyTimers(createAdminClient());
    return NextResponse.json(summary);
  } catch (err) {
    console.error("sms-survey-timers failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Survey timers failed" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
