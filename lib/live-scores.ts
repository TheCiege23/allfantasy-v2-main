import 'server-only'

import { prisma } from '@/lib/prisma'
import { dedupeGamesByFixture, excludePreseason } from '@/lib/sports/dedupeGames'

export type LiveGameScore = {
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  status: string
  quarter?: string | null
  clock?: string | null
  sport: string
  startTime: Date | null
}

/** Cache-only live scores: checks sportsGame table and never calls providers. */
export async function getLiveScores(sport: string, options?: { hoursBack?: number; limit?: number }): Promise<LiveGameScore[]> {
  const hoursBack = options?.hoursBack ?? 12
  const limit = options?.limit ?? 20
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000)

  try {
    /*
     * ⚠ OVER-FETCH, THEN COLLAPSE, THEN SLICE — IN THAT ORDER.
     *
     * `SportsGame` is unique on (sport, externalId, source), so every provider writing the same
     * fixture gets its own row. Measured 2026-08-30, one NFL game existed THREE times (espn,
     * rolling_insights, thesportsdb) with an identical startTime. Taking `limit` first and
     * mapping straight through therefore returned the same game up to three times AND silently
     * cut the slate to roughly a third of the games asked for — a 20-row request answering with
     * about seven real fixtures.
     *
     * The multiplier is the number of sources that can write one fixture (4: the three above plus
     * espn_live), so `limit` distinct games survive the collapse. Preseason is dropped after
     * fetching, not in the WHERE, because `seasonType` is NULL on 472 of 841 NFL 2026 rows and a
     * SQL filter would have to guess what NULL means — see excludePreseason.
     */
    const SOURCES_PER_FIXTURE = 4
    const rows = await prisma.sportsGame.findMany({
      where: {
        sport: sport.toUpperCase(),
        startTime: { gte: cutoff },
      },
      orderBy: { startTime: 'desc' },
      take: limit * SOURCES_PER_FIXTURE,
    })

    const games = dedupeGamesByFixture(excludePreseason(rows)).games.slice(0, limit)

    if (games.length > 0) {
      return games.map((g) => ({
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        homeScore: g.homeScore ?? 0,
        awayScore: g.awayScore ?? 0,
        status: g.status || 'scheduled',
        quarter: null,
        clock: null,
        sport: g.sport,
        startTime: g.startTime,
      }))
    }
  } catch {}

  return []
}

/** Check if any games are currently live for a sport. */
export async function hasLiveGames(sport: string): Promise<boolean> {
  const scores = await getLiveScores(sport, { hoursBack: 6, limit: 1 })
  return scores.some((g) => g.status.toLowerCase().includes('in progress') || g.status.toLowerCase().includes('live'))
}
