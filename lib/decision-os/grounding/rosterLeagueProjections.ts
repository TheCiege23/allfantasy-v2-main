import 'server-only'

import { prisma } from '@/lib/prisma'
import { crosswalkToSleeperIds, sleeperLookupId } from '@/lib/core-app/rosterIdCrosswalk'
import { extractScoringSettings } from '@/lib/projections/leagueScoring'
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
 * NFL only, like the weekly feed it reads. Every other sport is `not_requested` — not a gap: the projection slice
 * still carries those sports' numbers.
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
  week: number
  season: string
  /** Marks the row for the serializer: this number IS this league's, unlike a canonical projection row. */
  leagueScored: true
}

type RosterPlayer = { playerId?: unknown; name?: unknown; position?: unknown }

/** The league facts the pricing needs, read once and early so only the pricing waits for the roster. */
export type RosterProjectionBasis =
  | { ok: true; basis: LeagueWeekBasis; platform: string | null }
  | { ok: false; gap: GroundingGap }

export interface RosterLeagueProjectionDeps extends LeagueWeekPricingDeps {
  loadLeague: (leagueId: string) => Promise<{ sport: string | null; platform: string | null; settings: unknown } | null>
  crosswalk: (platform: string, sport: string, ids: string[]) => Promise<Map<string, string>>
}

export const defaultRosterLeagueProjectionDeps: RosterLeagueProjectionDeps = {
  ...defaultLeagueWeekPricingDeps,
  loadLeague: (leagueId) =>
    prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, platform: true, settings: true } }),
  crosswalk: crosswalkToSleeperIds,
}

const NOT_NFL: GroundingGap = {
  reason: 'not_requested',
  detail: 'League-scored roster projections are computed for NFL leagues; the projection slice carries this sport.',
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
  args: { leagueId: string; sport: string },
  deps: Pick<RosterLeagueProjectionDeps, 'loadLeague' | 'latestWeek'> = defaultRosterLeagueProjectionDeps,
): Promise<RosterProjectionBasis> {
  // The packet's own sport first: a non-NFL league costs no query at all.
  if (args.sport.trim().toUpperCase() !== 'NFL') return { ok: false, gap: NOT_NFL }
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
  deps: Pick<RosterLeagueProjectionDeps, 'loadWeekLines' | 'crosswalk'> = defaultRosterLeagueProjectionDeps,
): Promise<GroundedSlice<RosterLeagueProjection[]>> {
  try {
    return await priceRoster(args, deps)
  } catch {
    return absent(gap("Your roster could not be priced under this league's scoring this time.", 'Asking again usually works; My Team shows the same numbers.'))
  }
}

async function priceRoster(
  args: { basis: RosterProjectionBasis; rosterValue: unknown; sport: string },
  deps: Pick<RosterLeagueProjectionDeps, 'loadWeekLines' | 'crosswalk'>,
): Promise<GroundedSlice<RosterLeagueProjection[]>> {
  if (!args.basis.ok) return absent(args.basis.gap)
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
  const rank = (r: RosterLeagueProjection) => (r.slot === 'starter' ? 0 : 1)
  rows.sort((a, b) => rank(a) - rank(b) || (a.slot === 'bench' ? (b.points ?? -1) - (a.points ?? -1) : 0))
  return { present: true, value: rows, asOf: null, servedFrom: 'live', confidence: null, conclusive: { ok: true }, gap: null }
}
