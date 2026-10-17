/**
 * Why an NCAAF starter has no CFBD game row this week — and whether that is a real 0 or missing data.
 *
 * 🛑 CFBD `/games/players` LISTS ONLY PLAYERS WHO RECORDED A STAT. A receiver who ran routes and
 * caught nothing, an injured starter, and a player whose school had a bye all produce NO row — and so
 * does a game the ingest never brought in. The weekly sync used to treat all four alike, as "missing",
 * and the finalizer counts a missing starter against its 80% coverage floor. Measured on production
 * 2026-09-28 (weeks 2-4, 12-team lineups drawn from the CFBD pool): coverage was 78-87% for managed
 * teams and ~27% for autopicked ones — and EVERY missing starter was a bye or a school whose final
 * game WAS ingested. Not one was a data gap. Weeks were refusing to seal over zeros, not over outages.
 *
 * So a starter with no row is:
 *   bye          his school has no game this week                        -> a real 0
 *   no_stat      his school's game is final AND the ingest has its rows  -> a real 0
 *   pending      his school's game is not final yet                      -> missing (wait)
 *   not_ingested his school's game is final but no row came in for it    -> missing (a data gap:
 *                exactly what the coverage floor exists to catch)
 *   unmatched    his school is not on the season's CFBD schedule         -> missing (cannot tell)
 *
 * Schools are matched exactly as the lineup lock matches them (`cfbdScheduleTeamKeys`): exact school
 * first, the loose form only where no two schools on the season's schedule share it.
 */
import type { PrismaClient } from '@prisma/client'
import { cfbdScheduleTeamKeys } from '@/lib/sports-data/collegeTeamNames'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'

export type NcaafNoRowVerdict = 'bye' | 'no_stat' | 'pending' | 'not_ingested' | 'unmatched'

/** Verdicts under which a starter with no CFBD row scores a real 0 this week. */
export const NCAAF_ZERO_VERDICTS: ReadonlySet<NcaafNoRowVerdict> = new Set(['bye', 'no_stat'])

type ScheduleRow = { homeTeam: string | null; awayTeam: string | null; week: number | null; externalId: string | null; status: string | null }

export async function loadNcaafWeekParticipation(
  db: Pick<PrismaClient, 'sportsGame' | 'playerGameStat'>,
  args: { season: number; week: number },
): Promise<(team: string | null | undefined) => NcaafNoRowVerdict> {
  const season = (await db.sportsGame.findMany({
    where: { sport: 'NCAAF', source: 'cfbd', season: args.season, seasonType: 'regular' },
    select: { homeTeam: true, awayTeam: true, week: true, externalId: true, status: true },
  })) as ScheduleRow[]

  const schoolsByLoose = new Map<string, Set<string>>()
  for (const g of season) {
    for (const t of [g.homeTeam, g.awayTeam]) {
      const { exact, loose } = cfbdScheduleTeamKeys(t)
      if (loose) schoolsByLoose.set(loose, (schoolsByLoose.get(loose) ?? new Set()).add(exact))
    }
  }
  const keysFor = (team: string | null | undefined): string[] => {
    const { exact, loose } = cfbdScheduleTeamKeys(team)
    return [exact ? `x:${exact}` : '', loose && (schoolsByLoose.get(loose)?.size ?? 0) <= 1 ? `l:${loose}` : ''].filter(Boolean)
  }

  const onSchedule = new Set<string>()
  const weekGameByKey = new Map<string, ScheduleRow>()
  for (const g of season) {
    for (const t of [g.homeTeam, g.awayTeam]) {
      for (const k of keysFor(t)) {
        onSchedule.add(k)
        if (g.week === args.week) weekGameByKey.set(k, g)
      }
    }
  }

  const weekGameIds = [...new Set([...weekGameByKey.values()].map((g) => String(g.externalId ?? '').trim()).filter(Boolean))]
  const ingestedRows = weekGameIds.length
    ? ((await db.playerGameStat.findMany({
        where: {
          sportType: { in: ['NCAAF', 'ncaaf'] },
          season: args.season,
          weekOrRound: args.week,
          gameId: { in: weekGameIds.flatMap((id) => [`cfbd:${id}`, id]) },
        },
        distinct: ['gameId'],
        select: { gameId: true },
      })) as Array<{ gameId: string }>)
    : []
  const ingested = new Set(ingestedRows.map((r) => String(r.gameId).replace(/^cfbd:/, '')))

  return (team) => {
    const keys = keysFor(team).filter((k) => onSchedule.has(k))
    if (keys.length === 0) return 'unmatched'
    const game = keys.map((k) => weekGameByKey.get(k)).find(Boolean)
    if (!game) return 'bye'
    if (normalizeGameStatus(game.status) !== 'final') return 'pending'
    return ingested.has(String(game.externalId ?? '').trim()) ? 'no_stat' : 'not_ingested'
  }
}
