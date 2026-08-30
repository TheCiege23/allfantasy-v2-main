import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLiveAdpByName } from '@/lib/adp/liveAdpFallback'
import { prisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/team-abbrev'

/**
 * /api/draft/players — the pool the draft board is built from.
 *
 * 🛑 THIS USED TO RETURN THE FIRST 400 PLAYERS ALPHABETICALLY, WITH AN ADP EQUAL TO THEIR
 * ALPHABETICAL POSITION.
 *
 *     orderBy: { name: 'asc' },  take: 400
 *     adp: i + 1
 *
 * So `SportsPlayer` has no rank or ADP column to order by (only `yearsExp` and `status`), and
 * with 24,135 NFL rows the pool was an A-to-roughly-C slice — Ja'Marr Chase was not in it.
 * `PlayerPool.tsx` then rendered `{p.adp}` in a column headed ADP, so a drafting manager read
 * a player's position in the alphabet as their average draft position.
 *
 * The board is now driven BY the ADP, which is both the ordering and the number: `adp_data`
 * consensus, read DB-first through lib/adp/liveAdpFallback.ts (in-process cached, ~2,901 NFL
 * names). Ordering by the thing you are reporting is what makes the two agree by construction.
 *
 * ⚠ A PLAYER WITH NO REAL ADP GETS `null`, NEVER A NUMBER. `DraftPlayerRow.adp` is
 * `number | null` for this reason and the UI renders an em dash. A fabricated ADP is worse
 * than a missing one: the missing one is visibly missing.
 */

export const dynamic = 'force-dynamic'

/**
 * How many ADP names to look up in `SportsPlayer` per request. Over-fetch relative to `take`
 * because an ADP row without a matching player row is dropped (it has no id, so it could be
 * neither queued nor drafted), and we still want to fill the board.
 */
const NAME_LOOKUP_MULTIPLIER = 3

const PLAYER_SELECT = {
  externalId: true,
  name: true,
  position: true,
  team: true,
  imageUrl: true,
  status: true,
} as const

type PlayerRow = {
  externalId: string
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
  status: string | null
}

function toResponseRow(r: PlayerRow, sport: string, adp: number | null) {
  return {
    id: r.externalId,
    firstName: '',
    lastName: '',
    fullName: r.name,
    name: r.name,
    position: r.position ?? '',
    team: r.team ?? '',
    sport,
    imageUrl: r.imageUrl,
    status: r.status,
    adp,
    projPts: 0,
    proj: 0,
    byeWeek: null,
    bye: null,
    stats: {},
    isDrafted: false,
    keyStat: '',
  }
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sport = req.nextUrl.searchParams?.get('sport')?.trim() || 'NFL'
  const _draftId = req.nextUrl.searchParams?.get('draftId')?.trim()
  const take = Math.min(600, Number(req.nextUrl.searchParams?.get('limit')) || 400)

  /*
   * Never throws — a fallback that can take down the draft pool is worse than the gap it
   * fills. An empty board means "no ADP for this sport", which the branch below handles by
   * saying so rather than by inventing one.
   */
  const board = await getLiveAdpByName({ sport: sport.toUpperCase() }).catch(
    () => new Map<string, { adp: number; name: string }>(),
  )

  if (board.size > 0) {
    const ranked = [...board.values()].sort((a, b) => a.adp - b.adp)
    const candidates = ranked.slice(0, take * NAME_LOOKUP_MULTIPLIER)

    const rows = (await prisma.sportsPlayer.findMany({
      where: { sport, name: { in: candidates.map((e) => e.name) } },
      select: PLAYER_SELECT,
    })) as PlayerRow[]

    /*
     * Keyed on the SAME normalizer the board is keyed with — `adp_data.player_name` and
     * `SportsPlayer.name` differ in punctuation and generational suffixes often enough that an
     * exact join silently drops real players.
     */
    const byNormalizedName = new Map<string, PlayerRow>()
    for (const r of rows) {
      const key = normalizePlayerName(r.name)
      if (key && !byNormalizedName.has(key)) byNormalizedName.set(key, r)
    }

    const players: ReturnType<typeof toResponseRow>[] = []
    for (const entry of candidates) {
      if (players.length >= take) break
      const row = byNormalizedName.get(normalizePlayerName(entry.name))
      // No player row means no externalId, and the UI keys drafted/queued state on that id.
      if (!row) continue
      players.push(toResponseRow(row, sport, entry.adp))
    }

    return NextResponse.json({ sport, draftId: _draftId ?? null, players })
  }

  /*
   * No ADP board for this sport (only NFL is populated in `adp_data` today). Fall back to the
   * previous player set — but with `adp: null`. The ordering is admittedly arbitrary here;
   * what matters is that it is no longer REPORTED as a draft position.
   */
  const rows = (await prisma.sportsPlayer.findMany({
    where: { sport },
    select: PLAYER_SELECT,
    take,
    orderBy: { name: 'asc' },
  })) as PlayerRow[]

  return NextResponse.json({
    sport,
    draftId: _draftId ?? null,
    players: rows.map((r) => toResponseRow(r, sport, null)),
  })
}
