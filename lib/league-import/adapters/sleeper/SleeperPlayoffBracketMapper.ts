import type {
  NormalizedPlayoffBracket,
  NormalizedPlayoffBracketMatchup,
} from '../../types'
import type { SleeperImportPayload, SleeperPlayoffBracketRaw } from './types'

/**
 * Block G — map Sleeper winners/losers bracket rows to `NormalizedPlayoffBracket`.
 *
 * Sleeper bracket row semantics:
 *   - `r` → round, `m` → matchup id
 *   - `t1`, `t2` → team roster IDs (may be null until the feeding matchup resolves)
 *   - `w`, `l` → winner / loser roster IDs (null until the matchup completes)
 *   - `p` → final placement (only on placement matchups)
 *
 * All roster IDs coerce to strings (matching `league_teams.externalId`). A slot that
 * is absent OR non-positive (Sleeper uses 0 / null for "not yet decided") normalizes
 * to `null` so consumers can distinguish "no team" from a real roster id.
 *
 * Rows missing BOTH `r` and `m` are dropped defensively (not a real bracket row).
 */

function coerceInt(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

/** Roster-id slot → string, or null when absent / non-positive (Sleeper's "undecided"). */
function rosterSlot(v: unknown): string | null {
  const n = coerceInt(v)
  if (n == null || n <= 0) return null
  return String(n)
}

function mapRows(
  rows: SleeperPlayoffBracketRaw[] | undefined,
  bracketType: 'winners' | 'losers',
): NormalizedPlayoffBracketMatchup[] {
  if (!Array.isArray(rows) || rows.length === 0) return []
  const out: NormalizedPlayoffBracketMatchup[] = []
  for (const row of rows) {
    if (row == null || typeof row !== 'object') continue
    const round = coerceInt(row.r)
    const matchupId = coerceInt(row.m)
    // A bracket row must have both a round and a matchup id to be meaningful.
    if (round == null || matchupId == null) continue
    const placement = coerceInt(row.p)
    out.push({
      bracket_type: bracketType,
      round,
      matchup_id: matchupId,
      team1_roster_id: rosterSlot(row.t1),
      team2_roster_id: rosterSlot(row.t2),
      winner_roster_id: rosterSlot(row.w),
      loser_roster_id: rosterSlot(row.l),
      placement: placement != null ? placement : null,
    })
  }
  return out
}

/**
 * Build the normalized bracket for the CURRENT imported season. Returns `undefined`
 * when the provider supplied neither bracket (nothing to persist); returns a bracket
 * with `matchups: []` when brackets were fetched but empty (playoffs not started),
 * so the caller can still record coverage.
 */
export function mapSleeperPlayoffBracket(
  source: SleeperImportPayload,
): NormalizedPlayoffBracket | undefined {
  const winners = source.winnersBracket
  const losers = source.losersBracket
  // Provider didn't fetch either bracket → nothing to normalize.
  if (winners === undefined && losers === undefined) return undefined

  const seasonRaw = source.league?.season
  const season = coerceInt(seasonRaw) ?? new Date().getFullYear()

  const matchups = [
    ...mapRows(winners, 'winners'),
    ...mapRows(losers, 'losers'),
  ]

  return { season, matchups }
}
