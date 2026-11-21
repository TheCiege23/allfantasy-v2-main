import 'server-only'
import { prisma } from '@/lib/prisma'
import { aggregateNcaafWeek } from '@/lib/scoring-runtime/ncaafStatNormalization'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { loadCfbWeeksForNflWeek } from '@/lib/c2c/campusWeeks'

/**
 * College points for the college half of the C2C / Devy roster page, for the college week(s) inside
 * this NFL week.
 *
 * Read from the stored college game rows (`player_game_stats`, NCAAF), keyed on the CFBD athlete id the
 * identity resolver carries for each Fantrax player, and scored with the college football defaults.
 * This is the same evidence and the same scorer the native C2C campus scoring uses
 * (lib/c2c/campusScoring.ts).
 *
 * ⚠ IT IS AN ESTIMATE, NOT FANTRAX'S NUMBER. The league's own Fantrax scoring settings are not stored
 * with the snapshot, so a custom scoring rule (TE premium, say) is not applied. The page says so.
 *
 * ⚠ AND IT IS ONLY AS FRESH AS THE ROWS. Measured 2026-11-21: college week 10 has ~8,200 rows, and
 * week 11 has one. `statsOnFile: false` is how the page tells "no stats yet" apart from "scored 0".
 */

export type CollegePoints = {
  cfbWeeks: number[]
  /** Fantrax player id → points. A player with no game row this week is absent, not 0. */
  points: Record<string, number>
  /** Whether ANY college stats exist for these weeks: false means the stats have not arrived yet. */
  statsOnFile: boolean
}

const round2 = (n: number) => Math.round(n * 100) / 100

export async function loadCollegePoints(args: {
  season: number
  nflWeek: number
  players: Array<{ id: string; cfbdId: string | null; position: string | null }>
}): Promise<CollegePoints> {
  const cfbWeeks = await loadCfbWeeksForNflWeek(prisma, { season: args.season, nflWeek: args.nflWeek }).catch(() => [] as number[])
  if (cfbWeeks.length === 0) return { cfbWeeks, points: {}, statsOnFile: false }

  const byCfbd = new Map<string, { id: string; position: string | null }>()
  for (const p of args.players) if (p.cfbdId) byCfbd.set(p.cfbdId, { id: p.id, position: p.position })

  const [rows, anyRow] = await Promise.all([
    byCfbd.size
      ? prisma.playerGameStat.findMany({
          where: { playerId: { in: [...byCfbd.keys()] }, sportType: { in: ['NCAAF', 'ncaaf'] }, season: args.season, weekOrRound: { in: cfbWeeks } },
          select: { playerId: true, weekOrRound: true, normalizedStatMap: true },
        })
      : Promise.resolve([]),
    prisma.playerGameStat.findFirst({
      where: { sportType: { in: ['NCAAF', 'ncaaf'] }, season: args.season, weekOrRound: { in: cfbWeeks } },
      select: { id: true },
    }),
  ])

  // CFBD id → college week → that week's game rows
  const grouped = new Map<string, Map<number, unknown[]>>()
  for (const row of rows) {
    if (row.weekOrRound == null) continue
    const weeks = grouped.get(row.playerId) ?? new Map<number, unknown[]>()
    weeks.set(row.weekOrRound, [...(weeks.get(row.weekOrRound) ?? []), row.normalizedStatMap])
    grouped.set(row.playerId, weeks)
  }

  const scorer = buildLeagueStatScorer({ sport: 'NCAAF', settings: null })
  const points: Record<string, number> = {}
  if (scorer) {
    for (const [cfbdId, weeks] of grouped) {
      const who = byCfbd.get(cfbdId)
      if (!who) continue
      let total = 0
      let counted = false
      for (const weekRows of weeks.values()) {
        const week = aggregateNcaafWeek(weekRows)
        if (week.gamesCounted > 0) {
          total += scorer(week.stats, who.position)
          counted = true
        }
      }
      if (counted) points[who.id] = round2(total)
    }
  }
  return { cfbWeeks, points, statsOnFile: anyRow != null }
}
