import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { processWaiverWindow } from '@/lib/redraft/waiverEngine'
import { prisma } from '@/lib/prisma'
import { requireAdminOrBearer } from '@/lib/adminAuth'
import { requireCronAuth } from '@/app/api/cron/_auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Vercel cron sends a GET with `Authorization: Bearer ${CRON_SECRET}`.
 * requireCronAuth accepts that (CRON_SECRET / LEAGUE_CRON_SECRET); admin/bearer
 * is the manual-trigger fallback. requireAdminOrBearer alone rejected the cron
 * because CRON_SECRET !== ADMIN_PASSWORD.
 */
async function authorize(request: Request): Promise<NextResponse | null> {
  if (requireCronAuth(request as unknown as NextRequest)) return null
  const gate = await requireAdminOrBearer(request)
  return gate.ok ? null : gate.res
}

/** Process waivers for every active redraft season, isolating per-season failures. */
async function runAllWaivers() {
  const seasons = await prisma.redraftSeason.findMany({
    where: { status: { in: ['active', 'drafting'] } },
    take: 50,
  })
  const results: { seasonId: string; processed?: unknown[]; error?: string }[] = []
  for (const s of seasons) {
    try {
      const processed = await processWaiverWindow(s.leagueId, s.id)
      results.push({ seasonId: s.id, processed })
    } catch (e) {
      results.push({ seasonId: s.id, error: e instanceof Error ? e.message.slice(0, 200) : String(e) })
    }
  }
  return {
    processedSeasons: results.filter((r) => !r.error).length,
    failedSeasons: results.filter((r) => r.error).length,
    results,
  }
}

// GET is the scheduled Vercel cron entry point.
export async function GET(request: Request) {
  const denied = await authorize(request)
  if (denied) return denied
  return NextResponse.json(await runAllWaivers())
}

// POST preserved for manual/admin triggers.
export async function POST(request: Request) {
  const denied = await authorize(request)
  if (denied) return denied
  return NextResponse.json(await runAllWaivers())
}
