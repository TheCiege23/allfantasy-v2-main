import 'server-only'

import { prisma } from '@/lib/prisma'
import { crosswalkToSleeperIds, sleeperLookupId } from '@/lib/core-app/rosterIdCrosswalk'
import { extractScoringSettings } from '@/lib/projections/leagueScoring'
import { loadLeaguePlayerMetrics, type LeaguePlayerMetrics } from '@/lib/af-projections/leaguePlayerMetrics'
import { authorizeLeagueRead } from '../leagueReadAuthorization'
import {
  defaultLeagueWeekPricingDeps,
  isLeagueWeekRefusal,
  leagueWeekBasis,
  priceLeagueWeek,
  type LeagueWeekBasis,
  type LeagueWeekPricingDeps,
} from '../trade/leagueWeekPricing'
import type { GroundedSlice, GroundingGap } from './packet'

/**
 * "How many points is my roster projected for?" — under THIS league's scoring, for Chimmy (build list #4,
 * re-score 2026-11-17).
 *
 * 🛑 THE PROJECTION SLICE IS ONE FORMAT FOR EVERY LEAGUE. `AFProjectionSnapshot` holds full PPR (plus balanced
 * IDP), and the packet re-scores only defenders and kickers from it — so a quarterback in a 6-point-passing-TD
 * league, or a tight end in a TE-premium one, reached Chimmy labelled "canonical preset, NOT this league", while
 * My Team showed the same player under the league's own rules. Two numbers for one player, and the one in chat
 * was not the user's.
 *
 * So the asker's roster is priced here the way My Team prices it: the week's component line re-scored under the
 * league's rulebook (`computeLeagueProjectedPoints`, through `priceLeagueWeek` — the basis My Team, the trade
 * evaluator's lineup impact and Chimmy's start/sit scenarios already share). One helper, so they cannot drift.
 *
 * ⚠ ROSTER IDS ARE THE PLATFORM'S. A Sleeper roster id is a Sleeper id; an ESPN, Fleaflicker or MFL id reaches the
 * Sleeper-keyed feed only through `crosswalkToSleeperIds`, and an unmapped foreign id resolves to NOTHING
 * (`sleeperLookupId`) — never looked up as though it were a Sleeper id, which priced strangers on My Team once.
 *
 * ⚠ WHAT THIS DOES NOT APPLY, said in the prompt rather than left out: byes and injuries. My Team counts a bye or a
 * ruled-out player as 0; this list is the projection itself.
 *
 * NBA · NHL · MLB · COLLEGE BASKETBALL · SOCCER POINTS LEAGUES (owner's call, 2026-11-20). These sports have no weekly
 * component feed, and their
 * stat names do not match a rulebook's, so re-scoring a component line here would drop stats silently (every rebound,
 * in a default NBA rulebook — `waiverSportBasis.ts`). They are priced instead on the league's own value board, through
 * `loadLeaguePlayerMetrics` — the call My Team makes for the same roster: the board's per-game rate under THIS league's
 * points, times this week's games where the schedule is known. One source, so Chimmy, My Team, the Trade Center and
 * the value answer quote the same per-game number. A CATEGORY league has no points to project: it keeps the canonical
 * rows and says why. Every other sport is `not_requested` — not a gap: the projection slice still carries its numbers.
 *
 * COLLEGE FOOTBALL (2026-11-23) goes through the same read. It has no value board, but `loadLeaguePlayerMetrics`
 * prices NCAAF from AllFantasy's season projections re-scored under the league's rules (`scoreNcaafProjection`),
 * times this week's games — the exact read My Team's `priceLeaguePlayers` makes for an NCAAF roster. Before this
 * an NCAAF league got `not_requested` and Chimmy only had canonical rows labelled "NOT this league". Its rows carry
 * `rateSource: 'season_projection'` so the prompt does not call that a value board.
 */

/** One rostered player, priced for the feed's week under this league's rules. */
export interface RosterLeagueProjection {
  /** The roster's own (platform) id — what the roster slice and the serializer's roster keys use. */
  playerId: string
  playerName: string | null
  position: string | null
  slot: 'starter' | 'bench'
  /** Points under this league's scoring. Null when no line could be priced — never 0 for "unknown". */
  points: number | null
  /** The week priced. Null for a season-rate row whose week is not known. */
  week: number | null
  season: string
  /** Marks the row for the serializer: this number IS this league's, unlike a canonical projection row. */
  leagueScored: true
  /**
   * NBA / NHL / MLB / NCAAB / soccer only: priced from the league value board's per-game rate. Absent on an NFL row, which is a
   * re-scored weekly line. `points` is then `perGame × weekGames` — null when this week's games are not known.
   */
  basis?: 'season_rate'
  /** NCAAF only: the per-game rate is AllFantasy's season projection under this league's rules, not a value board. */
  rateSource?: 'season_projection'
  perGame?: number | null
  weekGames?: number | null
}

type RosterPlayer = { playerId?: unknown; name?: unknown; position?: unknown }

/** The league facts the pricing needs, read once and early so only the pricing waits for the roster. */
export type RosterProjectionBasis =
  | { ok: true; basis: LeagueWeekBasis; platform: string | null; kind?: 'week_line' }
  /** NBA / NHL / MLB / NCAAB / soccer: priced on the league's value board at pricing time (it needs the roster's ids). */
  | { ok: true; kind: 'season_rate'; leagueId: string; sport: string }
  | { ok: false; gap: GroundingGap }

export interface RosterLeagueProjectionDeps extends LeagueWeekPricingDeps {
  loadLeague: (leagueId: string) => Promise<{ sport: string | null; platform: string | null; settings: unknown } | null>
  crosswalk: (platform: string, sport: string, ids: string[]) => Promise<Map<string, string>>
  /** Whether the asker may read this league — `loadLeaguePlayerMetrics` requires its caller to have checked. */
  authorize: (leagueId: string, userId: string) => Promise<boolean>
  /** My Team's own read for the roster, in a board sport: the league value board's per-game rate and the week's games. */
  loadRosterMetrics: (args: { leagueId: string; rosterIds: string[] }) => Promise<LeaguePlayerMetrics | null>
}

export const defaultRosterLeagueProjectionDeps: RosterLeagueProjectionDeps = {
  ...defaultLeagueWeekPricingDeps,
  loadLeague: (leagueId) =>
    prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, platform: true, settings: true } }),
  crosswalk: crosswalkToSleeperIds,
  authorize: async (leagueId, userId) => (await authorizeLeagueRead(leagueId, userId)).authorized,
  loadRosterMetrics: ({ leagueId, rosterIds }) =>
    loadLeaguePlayerMetrics({ leagueId, rosterIds, includeTradeValues: false, limit: rosterIds.length }),
}

/**
 * The sports priced on a per-game rate through `loadLeaguePlayerMetrics`: every board sport (`BOARD_VALUE_SPORTS`),
 * owner's call 2026-11-20, plus college football (its season projections under the league's rules), 2026-11-23.
 */
export const SEASON_RATE_PROJECTION_SPORTS: ReadonlySet<string> = new Set(['NBA', 'NHL', 'MLB', 'NCAAB', 'SOCCER', 'NCAAF'])

const NOT_NFL: GroundingGap = {
  reason: 'not_requested',
  detail: 'League-scored roster projections are computed for NFL and college football leagues and NBA, NHL, MLB, college basketball and soccer points leagues; the projection slice carries this sport.',
  remedy: 'Nothing to do.',
}

const CATEGORY_LEAGUE: GroundingGap = {
  reason: 'not_requested',
  detail:
    'This is a category league: it scores categories, not fantasy points, so there are no league points to project. The Projections rows are AllFantasy’s default scoring, not this league’s.',
  remedy: 'Nothing to do.',
}

function gap(detail: string, remedy: string): GroundingGap {
  return { reason: 'not_computed', detail, remedy }
}

function absent(g: GroundingGap): GroundedSlice<RosterLeagueProjection[]> {
  return { present: false, value: null, asOf: null, servedFrom: null, confidence: null, conclusive: { ok: true }, gap: g }
}

/** The league's rulebook and the feed's week, or why the roster cannot be priced. Never throws. */
export async function loadRosterProjectionBasis(
  args: { leagueId: string; sport: string; userId?: string | null },
  deps: Pick<RosterLeagueProjectionDeps, 'loadLeague' | 'latestWeek' | 'authorize'> = defaultRosterLeagueProjectionDeps,
): Promise<RosterProjectionBasis> {
  const sport = args.sport.trim().toUpperCase()
  if (SEASON_RATE_PROJECTION_SPORTS.has(sport)) {
    // `loadLeaguePlayerMetrics` reads the league as given; the asker's access is checked first, as the packet's
    // league-metrics slice does. A sync throw must not escape (this promise is awaited by the packet build).
    const allowed = args.userId
      ? await Promise.resolve().then(() => deps.authorize(args.leagueId, args.userId as string)).catch(() => false)
      : false
    if (!allowed) {
      return { ok: false, gap: gap('Access to this league could not be confirmed, so your roster was not priced under its scoring.', 'Asking again usually works.') }
    }
    return { ok: true, kind: 'season_rate', leagueId: args.leagueId, sport }
  }
  // The packet's own sport first: any other non-NFL league costs no query at all.
  if (sport !== 'NFL') return { ok: false, gap: NOT_NFL }
  // ⚠ A dependency that throws SYNCHRONOUSLY escapes `.catch`; this promise is awaited by the packet build, so
  // it must never reject.
  const league = await Promise.resolve()
    .then(() => deps.loadLeague(args.leagueId))
    .catch(() => null)
  if (!league) {
    return { ok: false, gap: gap('This league could not be read, so its roster could not be priced under its scoring.', 'Asking again usually works.') }
  }
  // `extractScoringSettings` returns null for a settings blob with no rulebook — never the raw blob, whose
  // `num_teams` would otherwise read as a scoring rule.
  const basis = await leagueWeekBasis({ sport: league.sport ?? args.sport, scoringSettings: extractScoringSettings(league.settings) }, deps)
  if (isLeagueWeekRefusal(basis)) {
    if (basis.refuse === 'sport_not_supported') return { ok: false, gap: NOT_NFL }
    return {
      ok: false,
      gap: gap(
        `This league's roster could not be priced under its own scoring: ${basis.detail}.`,
        basis.refuse === 'no_scoring_rules'
          ? 'Re-import the league so its scoring settings are stored.'
          : 'The weekly projections compute daily; a cold feed fills on the next run.',
      ),
    }
  }
  return { ok: true, basis, platform: league.platform }
}

function rosterPlayers(rosterValue: unknown): Array<{ id: string; name: string | null; position: string | null; slot: 'starter' | 'bench' }> {
  if (!rosterValue || typeof rosterValue !== 'object') return []
  const v = rosterValue as { starters?: unknown; bench?: unknown }
  const out: Array<{ id: string; name: string | null; position: string | null; slot: 'starter' | 'bench' }> = []
  const seen = new Set<string>()
  for (const [slot, group] of [['starter', v.starters], ['bench', v.bench]] as const) {
    if (!Array.isArray(group)) continue
    for (const p of group as RosterPlayer[]) {
      const id = typeof p?.playerId === 'string' ? p.playerId.trim() : ''
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push({
        id,
        name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : null,
        position: typeof p.position === 'string' && p.position.trim() ? p.position.trim().toUpperCase() : null,
        slot,
      })
    }
  }
  return out
}

/**
 * The roster priced under the league's scoring: starters first, then the bench by points. Never throws.
 *
 * Present when at least one player was priced. A player with no line stays in the list with `points: null`, so
 * "no projection" is stated per player instead of the player silently missing.
 */
export async function priceRosterForLeague(
  args: { basis: RosterProjectionBasis; rosterValue: unknown; sport: string },
  deps: Pick<RosterLeagueProjectionDeps, 'loadWeekLines' | 'crosswalk' | 'loadRosterMetrics'> = defaultRosterLeagueProjectionDeps,
): Promise<GroundedSlice<RosterLeagueProjection[]>> {
  try {
    return await priceRoster(args, deps)
  } catch {
    return absent(gap("Your roster could not be priced under this league's scoring this time.", 'Asking again usually works; My Team shows the same numbers.'))
  }
}

const rankRows = (rows: RosterLeagueProjection[]) => {
  const rank = (r: RosterLeagueProjection) => (r.slot === 'starter' ? 0 : 1)
  rows.sort((a, b) => rank(a) - rank(b) || (a.slot === 'bench' ? (b.points ?? b.perGame ?? -1) - (a.points ?? a.perGame ?? -1) : 0))
  return rows
}

const presentRows = (rows: RosterLeagueProjection[]): GroundedSlice<RosterLeagueProjection[]> => ({
  present: true, value: rows, asOf: null, servedFrom: 'live', confidence: null, conclusive: { ok: true }, gap: null,
})

/** NBA / NHL / MLB / NCAAB / soccer: the roster on the league value board, through My Team's own read. */
async function priceRosterFromBoard(
  basis: { leagueId: string; sport: string },
  rosterValue: unknown,
  deps: Pick<RosterLeagueProjectionDeps, 'loadRosterMetrics'>,
): Promise<GroundedSlice<RosterLeagueProjection[]>> {
  const players = rosterPlayers(rosterValue)
  if (players.length === 0) {
    return absent(gap('No rostered players were found for you in this league, so there is nothing to price.', 'Re-sync the league if your roster should be here.'))
  }
  const data = await Promise.resolve()
    .then(() => deps.loadRosterMetrics({ leagueId: basis.leagueId, rosterIds: players.map((p) => p.id) }))
    .catch(() => null)
  if (!data || data.sport !== basis.sport) {
    return absent(gap("This league's value board could not be read, so your roster was not priced under its scoring.", 'Asking again usually works; My Team shows the same numbers.'))
  }
  if (data.unit !== 'fantasy points') return absent(CATEGORY_LEAGUE)
  const byRoster = new Map(data.rows.flatMap((r) => (r.rosterPlayerId ? [[r.rosterPlayerId, r] as const] : [])))
  const college = basis.sport === 'NCAAF'
  const rows: RosterLeagueProjection[] = players.map((p) => {
    const hit = byRoster.get(p.id)
    const perGame = hit && Number.isFinite(hit.perGame) ? hit.perGame : null
    return {
      playerId: p.id,
      playerName: p.name ?? hit?.playerName ?? null,
      position: p.position ?? (hit?.position || null),
      slot: p.slot,
      points: perGame != null && typeof hit?.weekly === 'number' ? hit.weekly : null,
      week: data.week,
      season: String(data.season),
      leagueScored: true,
      basis: 'season_rate',
      ...(college ? { rateSource: 'season_projection' as const } : {}),
      perGame,
      weekGames: hit?.weekGames ?? null,
    }
  })
  if (!rows.some((r) => r.perGame != null)) {
    if (college) {
      return absent(gap(
        'None of your rostered players has an AllFantasy season projection, so none could be priced under this league’s scoring.',
        'A player the projections do not carry stays unpriced.',
      ))
    }
    return absent(
      gap(
        "None of your rostered players is on this league's value board, so none could be priced under its scoring.",
        'The board is built from AllFantasy’s season projections; a player it does not carry stays unpriced.',
      ),
    )
  }
  return presentRows(rankRows(rows))
}

async function priceRoster(
  args: { basis: RosterProjectionBasis; rosterValue: unknown; sport: string },
  deps: Pick<RosterLeagueProjectionDeps, 'loadWeekLines' | 'crosswalk' | 'loadRosterMetrics'>,
): Promise<GroundedSlice<RosterLeagueProjection[]>> {
  if (!args.basis.ok) return absent(args.basis.gap)
  if (args.basis.kind === 'season_rate') return priceRosterFromBoard(args.basis, args.rosterValue, deps)
  const { basis, platform } = args.basis
  const players = rosterPlayers(args.rosterValue)
  if (players.length === 0) {
    return absent(gap('No rostered players were found for you in this league, so there is nothing to price.', 'Re-sync the league if your roster should be here.'))
  }

  const ids = players.map((p) => p.id)
  const crosswalk = platform
    ? await Promise.resolve().then(() => deps.crosswalk(platform, 'NFL', ids)).catch(() => new Map<string, string>())
    : new Map<string, string>()
  const sleeperOf = new Map<string, string>()
  const positions = new Map<string, string | null>()
  for (const p of players) {
    const sid = sleeperLookupId(platform, p.id, crosswalk, 'NFL')
    if (!sid) continue
    sleeperOf.set(p.id, sid)
    positions.set(sid, p.position)
  }
  const priced = sleeperOf.size ? await priceLeagueWeek(basis, [...sleeperOf.values()], positions, deps) : new Map()

  const rows: RosterLeagueProjection[] = players.map((p) => {
    const sid = sleeperOf.get(p.id)
    const hit = sid ? priced.get(sid) : undefined
    return {
      playerId: p.id,
      playerName: p.name,
      position: p.position ?? (hit?.position || null),
      slot: p.slot,
      points: hit?.projectedPoints ?? null,
      week: basis.week.week,
      season: basis.week.season,
      leagueScored: true,
    }
  })
  if (!rows.some((r) => r.points != null)) {
    return absent(
      gap(
        "None of your rostered players has a weekly projection line that could be scored under this league's rules.",
        'The weekly projections compute daily; a player the feed does not carry stays unpriced.',
      ),
    )
  }
  return presentRows(rankRows(rows))
}
