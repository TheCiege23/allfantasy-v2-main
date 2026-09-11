/**
 * DB-first reads for `game_odds`.
 *
 * 🛑 NOTHING IN THIS FILE CALLS A PROVIDER, ON ANY PATH — not as a fallback, not
 * on a cache miss. That is what makes it safe for a request path to import, and
 * it is the reason the odds fetch stays in `lib/api-sports.ts` (which the
 * DB-first guard allowlists on a documented caller census). A miss here returns
 * null and the surface renders without odds; it does not reach for the vendor
 * while a user waits.
 *
 * The writer is `syncAPISportsGameOddsToDb`, driven every 6h by
 * `/api/cron/import-schedules?odds=1`. Root CLAUDE.md's `ingestCFBDStats` example
 * is the reason those shipped together: a table nothing refreshes is worse than
 * the live call it replaced, because it fails silently and looks correct.
 *
 * ⚠ ALWAYS CHECK `isStale` BEFORE PRESENTING A NUMBER. Odds are the one feed
 * where a stale value is actively misleading rather than merely old — a spread
 * from before a starting QB was ruled out will look perfectly reasonable and be
 * completely wrong. `readGameOdds` reports staleness rather than hiding rows, so
 * a caller can choose between "show it, marked" and "show nothing"; silently
 * dropping expired rows would leave a surface unable to tell "no line" from
 * "line we failed to refresh".
 */

import { prisma } from '@/lib/prisma'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { pickPrimaryBookmaker, type NormalizedGameOdds } from './normalizeApiSportsOdds'

/**
 * What a consumer of this module is allowed to see.
 *
 * 🛑 FORECAST FIELDS ONLY — NO PRICES, AND NO BOOKMAKER NAME. This is a product
 * boundary and it is enforced by the type rather than by a convention someone has
 * to remember.
 *
 * AllFantasy uses the betting market as the best available FORECAST of how a game
 * will go: how many points an offence is expected to score (`impliedHomeTotal`),
 * and how likely a team is to win (`homeWinProbability`, with the vig already
 * removed at ingest). Those are projection inputs. It is deliberately NOT a
 * gambling product, so the things that only mean something to a bettor never leave
 * this module:
 *
 *   - `moneylineHome` / `moneylineAway`, `spreadHomeOdd`/`spreadAwayOdd`,
 *     `overOdd`/`underOdd` — these are PRICES. Their only legitimate use is
 *     computing the vig-free probability, which already happened at ingest, so no
 *     reader needs them.
 *   - `bookmakerName` — naming a sportsbook in a UI is the clearest marker of a
 *     betting product and is where affiliate relationships usually enter.
 *     `bookmakerId` stays, so two books can still be told apart without branding
 *     either of them.
 *
 * `spreadHome` and `totalPoints` DO stay: they are the game-script inputs (is this
 * team likely to be trailing and throwing?) and they are what the implied totals
 * are derived from, so hiding them would make the derived numbers unexplainable.
 *
 * ⚠ Present them as market-implied projections, never as a betting card. See the
 * repo notes on the odds feed for the wider framing.
 */
export interface GameOddsRow {
  gameExternalId: string
  sport: string
  source: string
  bookmakerId: number
  season: number | null
  week: number | null
  spreadHome: number | null
  totalPoints: number | null
  impliedHomeTotal: number | null
  impliedAwayTotal: number | null
  homeWinProbability: number | null
  fetchedAt: Date
  expiresAt: Date
}

/**
 * The row as stored, prices included. Internal to this module.
 *
 * The prices are read for ONE reason: `pickPrimaryBookmaker` scores a quote on how
 * complete it is, and "did this book price both sides of the moneyline" is part of
 * that. They are dropped in `assemble` before anything is returned.
 */
interface PricedRow extends GameOddsRow {
  bookmakerName: string
  moneylineHome: number | null
  moneylineAway: number | null
}

export interface GameOddsResult {
  /** The most complete bookmaker quote for this game, or null when nothing parsed. */
  primary: GameOddsRow | null
  /** Every bookmaker on file, so a caller can compare or build its own consensus. */
  books: GameOddsRow[]
  /** True when the primary row is past its TTL. See the file header — do not ignore. */
  isStale: boolean
  /** Age of the primary row, or null when there is no row at all. */
  ageMs: number | null
}

const EMPTY: GameOddsResult = { primary: null, books: [], isStale: false, ageMs: null }

const SELECT = {
  gameExternalId: true,
  sport: true,
  source: true,
  bookmakerId: true,
  bookmakerName: true,
  season: true,
  week: true,
  spreadHome: true,
  totalPoints: true,
  moneylineHome: true,
  moneylineAway: true,
  impliedHomeTotal: true,
  impliedAwayTotal: true,
  homeWinProbability: true,
  fetchedAt: true,
  expiresAt: true,
} as const

/*
 * `pickPrimaryBookmaker` scores on the NormalizedGameOdds shape, which carries
 * more fields than a DB row needs to. Rather than widen the read's `select` just
 * to satisfy a type, project the three fields the scorer actually reads. Keeping
 * one ranking implementation matters more than the shim: two copies of "which
 * quote is best" would drift, and the SQL-vs-JS normalizer incident in root
 * CLAUDE.md is exactly what that costs.
 */
function toScorable(row: PricedRow): NormalizedGameOdds {
  return {
    bookmakerId: row.bookmakerId,
    bookmakerName: row.bookmakerName,
    spreadHome: row.spreadHome,
    spreadHomeOdd: null,
    spreadAwayOdd: null,
    moneylineHome: row.moneylineHome,
    moneylineAway: row.moneylineAway,
    totalPoints: row.totalPoints,
    overOdd: null,
    underOdd: null,
    impliedHomeTotal: row.impliedHomeTotal,
    impliedAwayTotal: row.impliedAwayTotal,
    homeWinProbability: row.homeWinProbability,
    unrecognizedBets: [],
  }
}

/**
 * Drop every field a bettor would want and a fantasy surface would not.
 * This is the single place prices are removed, so there is one gate rather than a
 * rule each caller has to remember.
 */
function toPublic(row: PricedRow): GameOddsRow {
  const { bookmakerName: _name, moneylineHome: _mh, moneylineAway: _ma, ...forecast } = row
  return forecast
}

function assemble(rows: PricedRow[], now: Date): GameOddsResult {
  if (!rows.length) return EMPTY
  const ranked = pickPrimaryBookmaker(rows.map(toScorable))
  const primary = ranked ? rows.find((r) => r.bookmakerId === ranked.bookmakerId) ?? rows[0] : rows[0]
  return {
    primary: toPublic(primary),
    books: rows.map(toPublic),
    isStale: primary.expiresAt.getTime() < now.getTime(),
    ageMs: now.getTime() - primary.fetchedAt.getTime(),
  }
}

/** Odds for one game, keyed on the PROVIDER's game id (`SportsGame.externalId`). */
export async function readGameOdds(
  sport: string,
  gameExternalId: string,
  opts: { source?: string } = {},
): Promise<GameOddsResult> {
  if (!sport || !gameExternalId) return EMPTY

  const rows = (await prisma.gameOdds.findMany({
    where: {
      sport,
      gameExternalId,
      ...(opts.source ? { source: opts.source } : {}),
    },
    select: SELECT,
  })) as PricedRow[]

  return assemble(rows, new Date())
}

/**
 * A whole week's slate in one query, returned as gameExternalId → odds.
 *
 * This is the shape lineup and matchup surfaces want: they already hold a week's
 * games and need the line for each. Doing it per game would be N round trips for
 * a page that renders one table.
 */
export async function readWeekOdds(
  sport: string,
  season: number,
  week: number,
  opts: { source?: string } = {},
): Promise<Map<string, GameOddsResult>> {
  const out = new Map<string, GameOddsResult>()
  if (!sport || !Number.isFinite(season) || !Number.isFinite(week)) return out

  const rows = (await prisma.gameOdds.findMany({
    where: {
      sport,
      season,
      week,
      ...(opts.source ? { source: opts.source } : {}),
    },
    select: SELECT,
  })) as PricedRow[]

  const byGame = new Map<string, PricedRow[]>()
  for (const row of rows) {
    const list = byGame.get(row.gameExternalId) ?? []
    list.push(row)
    byGame.set(row.gameExternalId, list)
  }

  const now = new Date()
  for (const [gameId, group] of byGame) out.set(gameId, assemble(group, now))
  return out
}

/**
 * One team's game environment for a week — the shape fantasy actually consumes.
 *
 * Everything here is stated from THIS TEAM's point of view, because that is the
 * question a lineup surface asks ("is my guy's offence expected to score?") and
 * because a home-perspective spread silently inverted for half the league is
 * exactly the kind of plausible-but-wrong number this feed is built to avoid.
 */
export interface TeamMarketContext {
  team: string
  opponent: string | null
  isHome: boolean
  /** Points THIS team is implied to score. The headline number for fantasy. */
  impliedTeamTotal: number | null
  /** Spread from THIS team's perspective; negative = favoured. */
  spread: number | null
  /** The game's total, shared by both teams. */
  gameTotal: number | null
  /** Vig-free probability THIS team wins. */
  winProbability: number | null
  /** True when the underlying quote is past its TTL — see the file header. */
  isStale: boolean
}

/**
 * A week's market context keyed by TEAM abbreviation.
 *
 * Joins `game_odds` to `SportsGame` on the provider's game id, then states each
 * game twice — once per side, each from that side's perspective. A caller holding
 * a roster has team codes, not game ids, so doing the flip here means it happens
 * once, in a tested place, rather than in every surface.
 *
 * DB-only, like everything else in this module: two queries, no provider call.
 */
export async function readWeekMarketContextByTeam(
  sport: string,
  season: number,
  week: number,
  opts: { source?: string } = {},
): Promise<Map<string, TeamMarketContext>> {
  const out = new Map<string, TeamMarketContext>()
  if (!sport || !Number.isFinite(season) || !Number.isFinite(week)) return out

  const source = opts.source ?? 'api_sports'
  const [oddsByGame, games] = await Promise.all([
    readWeekOdds(sport, season, week, { source }),
    prisma.sportsGame.findMany({
      where: { sport, season, week, source },
      select: { externalId: true, homeTeam: true, awayTeam: true },
    }),
  ])

  for (const game of games) {
    const entry = oddsByGame.get(String(game.externalId))
    const q = entry?.primary
    if (!q) continue

    const stale = entry!.isStale
    const homeProb = q.homeWinProbability

    /*
     * 🛑 KEY ON THE CANONICAL CODE, BECAUSE THIS COLUMN IS NOT ALWAYS A CODE.
     * `syncAPISportsGamesToDb` writes
     *     teamNameToAbbrev(g.teams.home.name) || g.teams.home.name
     * so when the abbreviation table misses, the FULL TEAM NAME is stored instead.
     * A caller holding roster team codes would then never match that row, and the
     * miss is silent — the player is simply dropped from the result with no error
     * and no data gap.
     *
     * Measured 2026-09-11: zero NFL rows currently carry a long value, and the two
     * vocabularies agree on all 32 codes, so this is dormant rather than broken
     * today. It fires on a relocation, a rename, or NCAAF, whose hundreds of
     * colleges the abbreviation table does not begin to cover.
     *
     * `normalizeTeamAbbrev` also folds the known aliases (JAC->JAX, WSH->WAS,
     * LA->LAR, OAK->LV), and returns the upper-cased input for anything it does not
     * recognise — so junk codes stay junk and still compare equal on both sides,
     * provided the caller normalizes too.
     */
    const homeKey = normalizeTeamAbbrev(game.homeTeam) ?? game.homeTeam
    const awayKey = normalizeTeamAbbrev(game.awayTeam) ?? game.awayTeam

    if (game.homeTeam) {
      out.set(homeKey, {
        team: homeKey,
        opponent: awayKey ?? null,
        isHome: true,
        impliedTeamTotal: q.impliedHomeTotal,
        spread: q.spreadHome,
        gameTotal: q.totalPoints,
        winProbability: homeProb,
        isStale: stale,
      })
    }

    if (game.awayTeam) {
      out.set(awayKey, {
        team: awayKey,
        opponent: homeKey ?? null,
        isHome: false,
        impliedTeamTotal: q.impliedAwayTotal,
        // Mirrored, not copied. A -3.5 home line is +3.5 for the away side.
        spread: q.spreadHome == null ? null : -q.spreadHome,
        gameTotal: q.totalPoints,
        // Two-way market, vig already removed, so the complement is the away price.
        winProbability: homeProb == null ? null : Math.round((1 - homeProb) * 10000) / 10000,
        isStale: stale,
      })
    }
  }

  return out
}

/**
 * Freshness of the odds table itself, for health surfaces.
 *
 * ⚠ Read THIS, not any accessor on the adapter. Root CLAUDE.md records
 * `getValuationCacheAgeMs` reporting "unknown age" for data that was fresh, because
 * a surface migrated to the DB layer while still asking the fetch module's
 * in-process Map how old its cache was. The adapter has no in-process odds cache at
 * all, so the same mistake here would report a permanent unknown that nothing
 * type-checks.
 */
export async function getGameOddsFreshness(
  sport: string,
  opts: { source?: string } = {},
): Promise<{ newestFetchedAt: Date | null; ageMs: number | null; rowCount: number }> {
  const where = { sport, ...(opts.source ? { source: opts.source } : {}) }
  const [newest, rowCount] = await Promise.all([
    prisma.gameOdds.findFirst({
      where,
      select: { fetchedAt: true },
      orderBy: { fetchedAt: 'desc' },
    }),
    prisma.gameOdds.count({ where }),
  ])

  if (!newest) return { newestFetchedAt: null, ageMs: null, rowCount }
  return {
    newestFetchedAt: newest.fetchedAt,
    ageMs: Date.now() - newest.fetchedAt.getTime(),
    rowCount,
  }
}
