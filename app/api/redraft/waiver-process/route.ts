import { NextResponse, type NextRequest } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { processWaiverWindow } from '@/lib/redraft/waiverEngine'
import { prisma } from '@/lib/prisma'
import { requireAdminOrBearer } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  const gate = await requireAdminOrBearer(request)
  if (!gate.ok) return gate.res

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
  if (!requireCronAuth(request as unknown as NextRequest)) {
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
