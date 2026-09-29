import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { computeUserPlayerExposure } from '@/lib/shared-services/game-day/UserPlayerExposureService'
import { indexBySleeperId } from '@/lib/player-identity/externalIdNamespace'

export const dynamic = 'force-dynamic'

// Per-user in-memory cache of the (expensive) cross-league exposure computation.
// `computeUserPlayerExposure` reads every roster the user owns; the query `q` is only
// an in-memory filter, so the underlying result is identical across keystrokes. Caching
// it for a short window stops a fast typist from re-fanning-out over Postgres on each
// keystroke — the same connection-exhaustion shape as the #246 activity fix. Per-instance
// only (serverless), which is exactly where the rapid repeats land.
type ExposureResult = Awaited<ReturnType<typeof computeUserPlayerExposure>>
const EXPOSURE_CACHE = new Map<string, { at: number; data: ExposureResult }>()
const EXPOSURE_TTL_MS = 60_000

/**
 * Live cross-league player search — "which of MY leagues is this player on?"
 *
 * Reuses the existing `computeUserPlayerExposure` engine (real roster reads
 * across every linked league) and enriches player identity from the
 * `sportsPlayer` catalog (roster rows often carry only a Sleeper id, no name).
 * Powers the Nocturne dashboard's Global player search. Auth-gated; a user only
 * ever sees exposure across their own leagues.
 *
 * NOTE: per-league injury/projected points are not yet available from the
 * exposure engine (returned null there) — this route returns the real,
 * available shape (leagueCount + starter/bench/IR breakdown + exposure %),
 * never fabricated per-league numbers.
 */
export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = typeof session?.user?.id === 'string' ? session.user.id.trim() : ''
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 8), 1), 25)

  try {
    let cached = EXPOSURE_CACHE.get(userId)
    if (!cached || Date.now() - cached.at > EXPOSURE_TTL_MS) {
      cached = { at: Date.now(), data: await computeUserPlayerExposure({ userId }) }
      EXPOSURE_CACHE.set(userId, cached)
    }
    const { exposures, connectedLeagueCount } = cached.data
    if (exposures.length === 0) {
      return NextResponse.json({ players: [], connectedLeagueCount })
    }

    // Enrich identity from the catalog. 🛑 Only an NFL Sleeper-space id is asked as a Sleeper id: a
    // native NHL roster's Rolling Insights ids, and a foreign platform's own, are numbers that ARE
    // Sleeper ids for somebody else (1332 on the production NHL roster is Sleeper's Ifeanyi Momah),
    // and the catalog name overrode the roster's own correct one. Everyone else keeps the roster's
    // name, or is matched by our own row id, which cannot collide.
    const isNflSleeperId = (e: (typeof exposures)[number]) => e.idSpace === 'sleeper' && e.sport === 'NFL'
    const ids = exposures.map((e) => e.playerId).filter(Boolean)
    const sleeperIds = exposures.filter(isNflSleeperId).map((e) => e.playerId).filter(Boolean)
    const catalog = await prisma.sportsPlayer
      .findMany({
        where: { OR: [{ sleeperId: { in: sleeperIds } }, { id: { in: ids } }] },
        select: { id: true, sleeperId: true, source: true, name: true, position: true, team: true },
      })
      .catch(() => [] as Array<{ id: string; sleeperId: string | null; source: string; name: string | null; position: string | null; team: string | null }>)

    type Identity = { name: string | null; position: string | null; team: string | null }
    const identityOf = (p: (typeof catalog)[number]): Identity => ({ name: p.name, position: p.position, team: p.team })
    const byOurId = new Map<string, Identity>(catalog.map((p) => [p.id, identityOf(p)]))
    const bySleeperId = new Map<string, Identity>()
    for (const [sleeperId, p] of indexBySleeperId(catalog)) bySleeperId.set(sleeperId, identityOf(p))

    const enriched = exposures.map((e) => {
      const cat = (isNflSleeperId(e) ? bySleeperId.get(e.playerId) : undefined) ?? byOurId.get(e.playerId)
      return {
        playerId: e.playerId,
        name: cat?.name ?? e.playerName ?? null,
        position: cat?.position ?? e.position ?? null,
        team: cat?.team ?? null,
        leagueCount: e.leagueCount,
        rosterCount: e.rosterCount,
        startingCount: e.startingCount,
        benchCount: e.benchCount,
        irTaxiCount: e.irTaxiCount,
        exposurePercent: e.exposurePercent,
      }
    })

    const filtered = q
      ? enriched.filter((p) => (p.name ?? '').toLowerCase().includes(q))
      : enriched
    // Most-exposed first; drop identity-less rows when the user is searching.
    const ranked = filtered
      .filter((p) => (q ? Boolean(p.name) : true))
      .sort((a, b) => b.leagueCount - a.leagueCount || (b.name ? 1 : 0) - (a.name ? 1 : 0))
      .slice(0, limit)

    return NextResponse.json({ players: ranked, connectedLeagueCount })
  } catch (error) {
    console.error('[players/my-exposure] failed:', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
