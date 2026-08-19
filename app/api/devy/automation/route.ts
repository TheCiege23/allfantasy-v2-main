import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { prisma } from '@/lib/prisma'
import { processDevyToRookieTransition } from '@/lib/devy/rosterEngine'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Daily: taxi lock deadlines, placeholder NFL-entry sync (wire to player pool when available).
 */
async function run(_req: NextRequest) {
  const leagues = await prisma.devyLeague.findMany()
  let taxiLocked = 0
  const now = Date.now()

  for (const L of leagues) {
    if (L.taxiLockDeadline && L.taxiLockDeadline.getTime() < now) {
      const r = await prisma.devyTaxiSlot.updateMany({
        where: { leagueId: L.leagueId },
        data: { isLocked: true },
      })
      taxiLocked += r.count
    }
  }

  // When platform marks NCAA players as `graduatedToNFL`, promote devy rows (best-effort).
  let transitions = 0
  const candidates = await prisma.devyDevySlot.findMany({
    where: { hasEnteredNFL: false },
    take: 50,
  })
  for (const slot of candidates) {
    const p = await prisma.player.findFirst({
      where: { id: slot.playerId, graduatedToNFL: true },
    })
    if (!p) continue
    try {
      await processDevyToRookieTransition(slot.leagueId, slot.playerId, new Date().getFullYear(), 'nfl_draft')
      transitions++
    } catch {
      // Missing roster state or capacity edge cases — leave for commissioner tools.
    }
  }

  // NOTE: devy intel enrichment deliberately does NOT run here. This whole
  // route tree (app/api/devy) is excluded from the production build by
  // scripts/vercel-next-build.cjs to stay under Vercel's 2048-route cap, so
  // this handler 404s in production and is not a vercel.json cron target.
  // Enrichment runs from /api/cron/import-players, which is both built and
  // scheduled.

  return NextResponse.json({
    ok: true,
    leaguesChecked: leagues.length,
    taxiLockedRows: taxiLocked,
    transitionsRun: transitions,
  })
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return run(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return run(req)
}
