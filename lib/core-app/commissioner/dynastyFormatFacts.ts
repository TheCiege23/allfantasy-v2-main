import { prisma } from '@/lib/prisma'
import { resolveDynastyRolloverSeasons } from '@/lib/season-rollover/dynastyRolloverService'
import type { DynastyFormatFacts } from './formatCards'

type SeasonRow = Parameters<typeof resolveDynastyRolloverSeasons>[0][number]

export type DynastyFormatRows = {
  league: { rosterSize?: number | null; taxiSlots?: number | null }
  /** The saved DynastyLeagueConfig row, or null when the league never saved one. */
  config: { taxiSlots: number; rookieDraftRounds: number; rookieDraftType: string; futurePicksYearsOut: number } | null
  /** A Devy or C2C league's own roster row; its taxi and devy counts override the core dynasty config. */
  devy: { taxiSlots: number; devySlots: number } | null
  seasons: readonly SeasonRow[] | null
}

/** Rows → card facts. Pure: a value the league never saved stays null, so the card never shows a default. */
export function toDynastyFormatFacts(rows: DynastyFormatRows): DynastyFormatFacts {
  const { league, config, devy, seasons } = rows
  // League.taxiSlots defaults to 0, so 0 there means "not imported", not "no taxi squad".
  const leagueTaxi = typeof league.taxiSlots === 'number' && league.taxiSlots > 0 ? league.taxiSlots : null
  const where = seasons ? resolveDynastyRolloverSeasons(seasons) : null
  const rollover: DynastyFormatFacts['rollover'] = !where
    ? null
    : where.started && where.incoming
      ? { state: 'started', season: where.incoming.season }
      : where.seasonOver
        ? { state: 'due', season: where.outgoing.season }
        : { state: 'in_season', season: where.outgoing.season }
  return {
    rosterSize: league.rosterSize ?? null,
    taxiSlots: devy?.taxiSlots ?? config?.taxiSlots ?? leagueTaxi,
    devySlots: devy?.devySlots ?? null,
    rookieDraftRounds: config?.rookieDraftRounds ?? null,
    rookieDraftType: config?.rookieDraftType ?? null,
    futurePicksYearsOut: config?.futurePicksYearsOut ?? null,
    rollover,
  }
}

/**
 * Reads the dynasty card's facts from Postgres. Each read settles on its own: one failing table
 * drops its rows from the card, never the hub. Season rows exist only where AllFantasy runs the league.
 */
export async function loadDynastyFormatFacts(input: {
  leagueId: string
  native: boolean
  variant: 'devy' | 'c2c' | null
  league: DynastyFormatRows['league']
}): Promise<DynastyFormatFacts> {
  const { leagueId, native, variant } = input
  const [config, devy, seasons] = await Promise.all([
    prisma.dynastyLeagueConfig
      .findUnique({
        where: { leagueId },
        select: { taxiSlots: true, rookieDraftRounds: true, rookieDraftType: true, futurePicksYearsOut: true },
      })
      .catch(() => null),
    variant === 'devy'
      ? prisma.devyLeague.findUnique({ where: { leagueId }, select: { taxiSlots: true, devySlots: true } }).catch(() => null)
      : variant === 'c2c'
        ? prisma.c2CLeague.findUnique({ where: { leagueId }, select: { taxiSlots: true, devySlots: true } }).catch(() => null)
        : Promise.resolve(null),
    native
      ? prisma.redraftSeason
          .findMany({
            where: { leagueId },
            orderBy: { createdAt: 'desc' },
            take: 2,
            select: { id: true, season: true, status: true, createdAt: true, currentWeek: true, playoffStartWeek: true, totalWeeks: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
  ])
  return toDynastyFormatFacts({ league: input.league, config, devy, seasons })
}
