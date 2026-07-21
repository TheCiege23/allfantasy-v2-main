import { NextResponse, type NextRequest } from 'next/server'
import { processWaiverWindow } from '@/lib/redraft/waiverEngine'
import { prisma } from '@/lib/prisma'
import { requireAdminOrBearer } from '@/lib/adminAuth'
import { requireCronAuth } from '@/app/api/cron/_auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Vercel cron invokes the `0 * * * *` schedule with GET and an
 * `Authorization: Bearer $CRON_SECRET` header. This route was POST-only and
 * authenticated via requireAdminOrBearer, which compares the bearer against
 * ADMIN_PASSWORD — not CRON_SECRET. So the schedule failed twice over (405 on the
 * method, and 401 even if it had been a POST). Accept the cron secret here, and
 * keep the admin path for manual/operator runs.
 */
export async function GET(request: NextRequest) {
  if (!requireCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runWaiverProcessing()
}

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
