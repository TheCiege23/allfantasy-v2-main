import { prisma } from '@/lib/prisma'

/**
 * FORWARD-LOOKING SCHEDULE ANSWERS: "when is the next game", "when does the
 * season start".
 *
 * ⚠ NOTHING LOOKED PAST TODAY. The cached-games path queries a single day
 * window — today or yesterday — so the two questions a fantasy user asks most in
 * preseason fell straight through it to a model with no schedule in hand. The
 * rows were always there: production holds 48 NFL and 240 NCAAF games in the
 * next seven days, and a full college schedule out to December.
 *
 * ⚠ THE SAME FIXTURE IS STORED SEVERAL TIMES. Duplicate `SportsGame` rows per
 * fixture differ only in `seasonType`/`status`, so a naive "next 5 games" lists
 * one game five times. Collapsed on pairing plus kickoff, preferring the copy
 * that carries a `seasonType` since that is the one that can be filtered on.
 *
 * ⚠ `seasonType` IS OFTEN NULL, so it is only ever used to NARROW a query, never
 * to exclude. Production carries 1,128 NFL rows with no season type at all
 * against 81 marked `pre` — filtering strictly on it for a general "next game"
 * would hide most of the schedule.
 */

export type UpcomingIntent = {
  kind: 'next-game' | 'season-start'
  sport: string | null
  seasonType: 'pre' | 'regular' | null
}

const SEASON_START_RE =
  /\b(when|what date)\b[^?]*\b(season|year)\b[^?]*\b(start|starts|begin|begins|open|opens|kick(?:s)?\s*off)\b|\bseason\s+(opener|start)\b/i

const NEXT_GAME_RE =
  /\b(next|upcoming|coming up|when\s+(?:is|are|do|does)\b[^?]*\bplay)\b[^?]*\b(game|games|matchup|fixture|kickoff)\b|\bwhen\s+(?:is|are)\s+the\s+next\b|\bnext\s+(game|games)\b/i

/** Read the schedule question out of a message, or null if it is not one. */
export function detectUpcomingIntent(
  message: string,
  resolveSport: (m: string) => string | null,
): UpcomingIntent | null {
  const isNextGame = NEXT_GAME_RE.test(message)

  let sportNamed = resolveSport(message)

  /*
   * "when does college football start?" carries no "season" and no "game", so
   * the two patterns above both miss it — and it is one of the most natural ways
   * to ask. Treated as a season-start question only when a SPORT was actually
   * named, which keeps "when does the draft start?" out of here rather than
   * loosening the pattern until it swallows every "when does X start".
   */
  const bareStart =
    Boolean(sportNamed) &&
    /\bwhen\b[^?]*\b(start|starts|begin|begins|kick(?:s)?\s*off|open|opens)\b/i.test(message)

  const isSeasonStart = SEASON_START_RE.test(message) || bareStart
  if (!isSeasonStart && !isNextGame) return null

  const preseason = /\bpre[-\s]?season\b/i.test(message)
  const regular = /\bregular\s+season\b/i.test(message)

  /*
   * "preseason" with no sport named means the NFL in this product. Guessing is
   * acceptable here ONLY because the answer names the sport it describes, so a
   * wrong guess is visible rather than silent.
   */
  if (!sportNamed && preseason) sportNamed = 'NFL'
  const sport = sportNamed

  return {
    kind: isSeasonStart && !isNextGame ? 'season-start' : 'next-game',
    sport,
    seasonType: preseason ? 'pre' : regular || isSeasonStart ? 'regular' : null,
  }
}

type GameRow = {
  sport: string
  homeTeam: string
  awayTeam: string
  startTime: Date
  seasonType: string | null
  week: number | null
  season: number | null
  venue: string | null
}

/** Collapse duplicate rows for one fixture, keeping the most descriptive copy. */
function dedupe(rows: GameRow[]): GameRow[] {
  const byFixture = new Map<string, GameRow>()
  for (const row of rows) {
    const key = `${row.sport}|${row.awayTeam}|${row.homeTeam}|${new Date(row.startTime).getTime()}`
    const held = byFixture.get(key)
    if (!held || (!held.seasonType && row.seasonType)) byFixture.set(key, row)
  }
  return [...byFixture.values()].sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime))
}

export type UpcomingGamesResult = {
  intent: UpcomingIntent
  games: GameRow[]
  /** True when a season-start question was asked about a season already running. */
  alreadyUnderway: boolean
}

/**
 * Look forward for the games a schedule question is asking about.
 *
 * Returns an empty list rather than widening the search when nothing matches —
 * a schedule answer that quietly changed the question is worse than "I do not
 * have that".
 */
export async function findUpcomingGames(
  intent: UpcomingIntent,
  now: Date = new Date(),
  limit = 5,
): Promise<UpcomingGamesResult> {
  const where: Record<string, unknown> = { startTime: { gt: now } }
  if (intent.sport) where.sport = intent.sport
  if (intent.seasonType) where.seasonType = intent.seasonType

  const rows = (await (prisma as any).sportsGame
    ?.findMany?.({
      where,
      orderBy: { startTime: 'asc' },
      /* Over-fetch: duplicates collapse afterwards and would otherwise eat the limit. */
      take: limit * 4,
      select: {
        sport: true,
        homeTeam: true,
        awayTeam: true,
        startTime: true,
        seasonType: true,
        week: true,
        season: true,
        venue: true,
      },
    })
    .catch(() => [])) ?? []

  const games = dedupe(rows as GameRow[]).slice(0, limit)

  /*
   * A season-start question about a season already under way. Detected by there
   * being a regular-season game for the same season ALREADY PLAYED — answering
   * "the season starts <next game>" would be wrong, and saying nothing would be
   * unhelpful when the honest answer is "it already started".
   */
  let alreadyUnderway = false
  if (intent.kind === 'season-start' && games.length > 0) {
    const season = games[0].season
    if (season != null) {
      const played = await (prisma as any).sportsGame
        ?.count?.({
          where: {
            sport: games[0].sport,
            season,
            seasonType: 'regular',
            startTime: { lt: now },
          },
        })
        .catch(() => 0)
      alreadyUnderway = (played ?? 0) > 0
    }
  }

  return { intent, games, alreadyUnderway }
}
