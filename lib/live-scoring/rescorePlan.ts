/**
 * Live Scoring — incremental rescore planner (Phase 6).
 *
 * The audited cron rescored every active season (sync → recalc all matchups →
 * recompute all standings) on every tick. This pure planner computes the *minimal*
 * work for a set of changed players: only the rosters that start them, only the
 * matchups those rosters are in, and standings only when a finalized matchup is
 * affected. Reusable by every league concept's live pipeline.
 */

export type RescoreRosterInput = {
  rosterId: string
  /** The matchup this roster is part of for the active week (null = bye/none). */
  matchupId: string | null
  /** Player ids whose scores count toward this roster's matchup total (starters). */
  scoringPlayerIds: readonly string[]
}

export type RescoreMatchupInput = {
  matchupId: string
  /** Canonical status; standings only move when an affected matchup is `final`. */
  status: 'upcoming' | 'live' | 'final'
}

export type RescorePlan = {
  affectedRosterIds: string[]
  affectedMatchupIds: string[]
  /** True when a finalized matchup is affected (a result — i.e. standings — moved). */
  standingsImpacted: boolean
  /** True when nothing changed (caller can skip all writes/broadcasts). */
  noop: boolean
}

/**
 * Plan the minimal rescore for `changedPlayerIds`. Pure and deterministic.
 *
 * A roster is affected only if one of its *scoring* (starter) players changed —
 * a bench player's stat change never moves a matchup total, so it is skipped.
 * Standings are flagged only when an affected matchup is already `final`, since a
 * live matchup's provisional score does not change W/L/standings yet.
 */
export function planIncrementalRescore(input: {
  changedPlayerIds: readonly string[]
  rosters: readonly RescoreRosterInput[]
  matchups?: readonly RescoreMatchupInput[]
}): RescorePlan {
  const changed = new Set(input.changedPlayerIds)
  if (changed.size === 0) {
    return { affectedRosterIds: [], affectedMatchupIds: [], standingsImpacted: false, noop: true }
  }

  const affectedRosterIds = new Set<string>()
  const affectedMatchupIds = new Set<string>()

  for (const roster of input.rosters) {
    const hit = roster.scoringPlayerIds.some((id) => changed.has(id))
    if (!hit) continue
    affectedRosterIds.add(roster.rosterId)
    if (roster.matchupId) affectedMatchupIds.add(roster.matchupId)
  }

  const statusByMatchup = new Map<string, RescoreMatchupInput['status']>()
  for (const m of input.matchups ?? []) statusByMatchup.set(m.matchupId, m.status)

  let standingsImpacted = false
  for (const matchupId of affectedMatchupIds) {
    if (statusByMatchup.get(matchupId) === 'final') {
      standingsImpacted = true
      break
    }
  }

  const noop = affectedRosterIds.size === 0
  return {
    affectedRosterIds: [...affectedRosterIds],
    affectedMatchupIds: [...affectedMatchupIds],
    standingsImpacted,
    noop,
  }
}

/**
 * Stable, key-order-insensitive serialization of a stat line. Critical because
 * Postgres JSONB does NOT preserve key order, so a stat line read back from the DB
 * can have different key order than a freshly-built provider object — a naive
 * `JSON.stringify` would falsely flag an unchanged player as changed and trigger a
 * needless rescore. Sorting keys (recursively) makes the comparison canonical.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

/**
 * Diff two stat snapshots to find which players actually changed (stat correction
 * safe + idempotent). Returns the player ids whose stat line differs — compared
 * with a stable, key-order-insensitive serialization so an unchanged player never
 * falsely diffs. Drives {@link planIncrementalRescore} so an unchanged provider
 * poll does zero downstream work.
 */
export function diffChangedPlayers(
  previous: ReadonlyMap<string, unknown>,
  next: ReadonlyMap<string, unknown>,
): string[] {
  const changed: string[] = []
  for (const [playerId, nextStat] of next) {
    const prevStat = previous.get(playerId)
    if (prevStat === undefined || stableStringify(prevStat) !== stableStringify(nextStat)) {
      changed.push(playerId)
    }
  }
  return changed
}
