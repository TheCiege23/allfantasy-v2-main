import 'server-only'
import { prisma } from '@/lib/prisma'
import { aggregateNcaafWeek } from '@/lib/scoring-runtime/ncaafStatNormalization'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { loadCfbWeeksForNflWeek, loadNflWeekWindow } from '@/lib/c2c/campusWeeks'

/**
 * College points for the college half of the C2C / Devy roster page, for this NFL week.
 *
 * TWO SOURCES, ONE PER PLAYER, LIVE FIRST:
 *
 * 1. Rolling Insights box lines (`source: rolling_insights_live`), written during games by the live
 *    tick and reconciled nightly (PR #4008). They are keyed on the identity id
 *    (`PlayerIdentityMap.id`, reached through the player's `rollingInsightsId`) and selected by GAME
 *    DATE inside this NFL week's window. RI's college week numbers need not match CFBD's: the
 *    fixture labels 2026-10-03 week 5.
 * 2. CFBD rows (`cfbd-weekly`), keyed on the CFBD athlete id and selected by the college week(s)
 *    inside this NFL week. CFBD writes a week about 36h after it ends, so it is the fallback for a
 *    player RI has no scorable line for, never the live number.
 *
 * A player whose RI lines score is scored from them alone. Adding both sources would double-count
 * the same game.
 *
 * Scored with the college football defaults, the same scorer native C2C campus scoring uses.
 * ⚠ AN ESTIMATE, NOT FANTRAX'S NUMBER: the league's own Fantrax scoring settings are not stored with
 * the snapshot, and the page says so.
 */

export type CollegePoints = {
  cfbWeeks: number[]
  /** Fantrax player id → points. A player with no game line this week is absent, not 0. */
  points: Record<string, number>
  /** Whether ANY college stats exist for this week from either source: false means they have not arrived yet. */
  statsOnFile: boolean
  /** True when at least one rostered player's number came from the live Rolling Insights lines. */
  live: boolean
}

const round2 = (n: number) => Math.round(n * 100) / 100
const NCAAF_KEYS = ['NCAAF', 'ncaaf']
const RI_SOURCE = 'rolling_insights_live'

/** `game_date` is a DATE column: compare on whole UTC days covering the window. */
const dayFloor = (ms: number) => new Date(new Date(ms).toISOString().slice(0, 10) + 'T00:00:00Z')

/** Group game rows by the Fantrax player they belong to. */
function groupByPlayer(rows: Array<{ playerId: string; normalizedStatMap: unknown }>, toFantrax: (playerId: string) => string | undefined) {
  const out = new Map<string, unknown[]>()
  for (const row of rows) {
    const id = toFantrax(row.playerId)
    if (!id) continue
    out.set(id, [...(out.get(id) ?? []), row.normalizedStatMap])
  }
  return out
}

export async function loadCollegePoints(args: {
  season: number
  nflWeek: number
  players: Array<{ id: string; cfbdId: string | null; rollingInsightsId: string | null; position: string | null }>
}): Promise<CollegePoints> {
  const [cfbWeeks, window] = await Promise.all([
    loadCfbWeeksForNflWeek(prisma, { season: args.season, nflWeek: args.nflWeek }).catch(() => [] as number[]),
    loadNflWeekWindow(prisma, { season: args.season, nflWeek: args.nflWeek }).catch(() => null),
  ])

  // Rolling Insights: rollingInsightsId → identity id → this week's lines.
  const riIds = [...new Set(args.players.map((p) => p.rollingInsightsId).filter((id): id is string => !!id))]
  const identities = riIds.length && window
    ? await prisma.playerIdentityMap
        .findMany({ where: { sport: 'NCAAF', rollingInsightsId: { in: riIds } }, select: { id: true, rollingInsightsId: true } })
        .catch(() => [])
    : []
  const identityByRi = new Map(identities.map((i) => [i.rollingInsightsId!, i.id]))
  const dateRange = window ? { gte: dayFloor(window.start), lt: dayFloor(window.end) } : null

  const byCfbd = new Map<string, string>()
  for (const p of args.players) if (p.cfbdId) byCfbd.set(p.cfbdId, p.id)

  const [riRows, riAny, cfbdRows, cfbdAny] = await Promise.all([
    identities.length && dateRange
      ? prisma.playerGameStat.findMany({
          where: { playerId: { in: identities.map((i) => i.id) }, sportType: { in: NCAAF_KEYS }, source: RI_SOURCE, gameDate: dateRange },
          select: { playerId: true, normalizedStatMap: true },
        })
      : Promise.resolve([]),
    dateRange
      ? prisma.playerGameStat.findFirst({ where: { sportType: { in: NCAAF_KEYS }, source: RI_SOURCE, gameDate: dateRange }, select: { id: true } })
      : Promise.resolve(null),
    byCfbd.size && cfbWeeks.length
      ? prisma.playerGameStat.findMany({
          where: { playerId: { in: [...byCfbd.keys()] }, sportType: { in: NCAAF_KEYS }, season: args.season, weekOrRound: { in: cfbWeeks } },
          select: { playerId: true, normalizedStatMap: true },
        })
      : Promise.resolve([]),
    cfbWeeks.length
      ? prisma.playerGameStat.findFirst({
          where: { sportType: { in: NCAAF_KEYS }, season: args.season, weekOrRound: { in: cfbWeeks }, NOT: { source: RI_SOURCE } },
          select: { id: true },
        })
      : Promise.resolve(null),
  ])

  const fantraxByIdentity = new Map<string, string>()
  for (const p of args.players) {
    const identityId = p.rollingInsightsId ? identityByRi.get(p.rollingInsightsId) : undefined
    if (identityId) fantraxByIdentity.set(identityId, p.id)
  }
  const riByPlayer = groupByPlayer(riRows, (playerId) => fantraxByIdentity.get(playerId))
  const cfbdByPlayer = groupByPlayer(cfbdRows, (playerId) => byCfbd.get(playerId))

  const scorer = buildLeagueStatScorer({ sport: 'NCAAF', settings: null })
  const points: Record<string, number> = {}
  let live = false
  if (scorer) {
    for (const p of args.players) {
      // Live lines first; if they do not score (none, or a normalizer that cannot read them yet), CFBD.
      const riWeek = riByPlayer.has(p.id) ? aggregateNcaafWeek(riByPlayer.get(p.id)!) : null
      const week = riWeek && riWeek.gamesCounted > 0 ? riWeek : cfbdByPlayer.has(p.id) ? aggregateNcaafWeek(cfbdByPlayer.get(p.id)!) : null
      if (!week || week.gamesCounted === 0) continue
      points[p.id] = round2(scorer(week.stats, p.position))
      if (week === riWeek) live = true
    }
  }
  return { cfbWeeks, points, statsOnFile: riAny != null || cfbdAny != null, live }
}
