import { NextResponse, type NextRequest } from 'next/server'
import { processWaiverWindow } from '@/lib/redraft/waiverEngine'
import { prisma } from '@/lib/prisma'
import { requireAdminOrBearer } from '@/lib/adminAuth'
import { requireCronAuth } from '@/app/api/cron/_auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// This branch added its own cron GET here; #284 landed an equivalent one further down
// (kept), so both would have exported `GET` from the same module. Dropped this copy —
// main's is the shipped, reviewed version and does the same work inline.
// `runWaiverProcessing()` stays: POST still calls it.

export async function POST(request: Request) {
  const gate = await requireAdminOrBearer(request)
  if (!gate.ok) return gate.res

  return runWaiverProcessing()
}

async function runWaiverProcessing() {
  const seasons = await prisma.redraftSeason.findMany({
    where: { status: { in: ['active', 'drafting'] } },
    take: 20,
  })
  const results: { seasonId: string; processed: unknown[] }[] = []
  for (const s of seasons) {
    const processed = await processWaiverWindow(s.leagueId, s.id)
    results.push({ seasonId: s.id, processed })
  }
  return NextResponse.json({ results })
}

/**
 * Vercel Cron issues a GET (`vercel.json`: "0 * * * *"), but this route only exported POST,
 * so every hourly run returned 405 and no waiver window was ever processed on schedule.
 *
 * POST keeps its existing `requireAdminOrBearer` gate untouched. GET is gated on
 * `requireCronAuth`, which is what Vercel's scheduler actually presents — and which already
 * accepts BRACKET_ADMIN_SECRET/ADMIN_PASSWORD, so this adds only the cron secrets.
 */
export async function GET(request: Request) {
  // Name CRON_SECRET explicitly, matching #289 — a bare call resolves LEAGUE_CRON_SECRET
  // first (it IS set in prod) and 401s against Vercel's `Bearer $CRON_SECRET`.
  if (!requireCronAuth(request as unknown as NextRequest, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const seasons = await prisma.redraftSeason.findMany({
    where: { status: { in: ['active', 'drafting'] } },
    take: 20,
  })
  const results: { seasonId: string; processed: unknown[] }[] = []
  for (const s of seasons) {
    const processed = await processWaiverWindow(s.leagueId, s.id)
    results.push({ seasonId: s.id, processed })
  }
  return NextResponse.json({ results })
}
