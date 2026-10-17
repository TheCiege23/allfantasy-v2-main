import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { runWorldCupBracketLockReminders } from "@/lib/world-cup/worldCupLockReminderCron"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  // Shared cron gate, which FAILS CLOSED. This used to be
  // `if (cronSecret && secret !== cronSecret)`, so an unset CRON_SECRET let
  // anyone trigger the reminder sends. wc-cron.yml sends the same Bearer header.
  if (!requireCronAuth(request, "CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await runWorldCupBracketLockReminders()
  return NextResponse.json({ ok: true, ...result })
}
