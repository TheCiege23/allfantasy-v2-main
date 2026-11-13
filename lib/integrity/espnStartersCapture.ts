/**
 * Who each imported ESPN team STARTED each week — the rules, pure, so they are tested rather than trusted.
 *
 * Nothing in the database records a past ESPN week's lineup: `Roster.playerData.starters` is the CURRENT
 * lineup and every sync overwrites it (contracts/espn/GAPS.md, `S-01`). What makes it recordable anyway is
 * ESPN's own rule: a player's lineup slot LOCKS when his game kicks off. So a roster the provider returned
 * AFTER his kickoff, still inside that week, shows the slot he was actually played in — and that reading
 * can never change again. That is the whole method:
 *
 *   - A player is captured as started / not started only from a roster FETCHED AFTER HIS KICKOFF and no
 *     later than the week's end, and then frozen. A fetch from before his kickoff is never frozen: the
 *     manager could still move him, so it is not a fact about the week.
 *   - A player with no game (a bye) has no lock; he keeps the latest in-week read, so the week's record
 *     is his slot as of the last sync before the week ended. A bye STARTER is exactly the signal the
 *     integrity audit wants, and the latest in-week read is the best the stored data can say.
 *   - A fetch outside the week is ignored entirely: after its end the roster may already be next week's,
 *     and before its start it is last week's.
 *
 * `fetchedAt` is when the provider last returned this roster. The sync advances `Roster.updatedAt` on
 * every successful read, changed or not (applySleeperLeagueSync, which serves every provider), and the
 * caller takes the EARLIER of that and `League.lastSyncedAt`, so a local write cannot pass for a fetch.
 */

import type { SnapshotPlayer, SnapshotSlot } from './lineupIntegrityScore'

export type SnapshotPlayerMap = Record<string, SnapshotPlayer>

/** How long after the week's last kickoff its lineups are still that week's. Games end well inside it. */
export const WEEK_END_GRACE_MS = 6 * 3_600_000

export function weekEnd(lastKickoff: Date): Date {
  return new Date(lastKickoff.getTime() + WEEK_END_GRACE_MS)
}

/**
 * Next snapshot for one team. `current` is this read (with `started` set from the stored lineup);
 * `kickoffById` the player's game kickoff this week (absent = no game). Returns `changed` false when
 * nothing would be written.
 */
export function captureStarters(input: {
  prior: SnapshotPlayerMap | null
  current: SnapshotPlayerMap
  kickoffById: ReadonlyMap<string, Date>
  fetchedAt: Date
  /** The previous week's end: a roster read before it is last week's lineup. */
  weekStartsAt: Date
  weekEndsAt: Date
}): { players: SnapshotPlayerMap; changed: boolean; ignored: boolean } {
  const prior = input.prior ?? {}
  // A roster read outside the week says nothing about it: before, it is last week's; after, maybe next week's.
  const t = input.fetchedAt.getTime()
  if (t > input.weekEndsAt.getTime() || t < input.weekStartsAt.getTime()) return { players: { ...prior }, changed: false, ignored: true }

  const players: SnapshotPlayerMap = { ...prior }
  let changed = input.prior == null
  const fetchedIso = input.fetchedAt.toISOString()
  for (const [id, now] of Object.entries(input.current)) {
    const before = prior[id]
    if (before?.frozenAt) continue // locked at kickoff and read after it: final
    const kickoff = input.kickoffById.get(id)
    const lockedInThisRead = kickoff != null && input.fetchedAt.getTime() >= kickoff.getTime()
    const entry: SnapshotPlayer = lockedInThisRead
      ? // Projection, status and bye as known BEFORE kickoff when we had them; the slot from this
        // post-kickoff read, because only a post-kickoff read is the slot he was played in.
        { ...(before ?? now), started: now.started ?? null, frozenAt: fetchedIso }
      : { ...now, frozenAt: null }
    if (!before || !same(before, entry)) {
      players[id] = entry
      changed = true
    }
  }
  return { players, changed, ignored: false }
}

function same(a: SnapshotPlayer, b: SnapshotPlayer): boolean {
  const keys: Array<keyof SnapshotPlayer> = ['name', 'position', 'proj', 'status', 'bye', 'team', 'frozenAt', 'started']
  return keys.every((k) => (a[k] ?? null) === (b[k] ?? null))
}

/**
 * The week's starters for the integrity scorer, and whether the record is COMPLETE: the week has ended
 * and every player who had a game was captured after his kickoff. An incomplete week must not be scored —
 * a missing capture is not "not started".
 */
export function weekStarters(players: SnapshotPlayerMap, kickoffById: ReadonlyMap<string, Date>, now: Date, weekEndsAt: Date): {
  starterIds: string[]
  complete: boolean
  uncaptured: string[]
} {
  const uncaptured = Object.keys(players).filter((id) => kickoffById.has(id) && !players[id]!.frozenAt)
  return {
    starterIds: Object.keys(players).filter((id) => players[id]!.started === true),
    complete: now.getTime() > weekEndsAt.getTime() && uncaptured.length === 0,
    uncaptured,
  }
}

/** Template rows (lib/league/importedLineupTemplate.ts) → one snapshot seat per starting slot. */
export function snapshotSlotsFromTemplate(rows: ReadonlyArray<{ slotName: string; allowedPositions: string[]; starterCount: number }> | null): SnapshotSlot[] | null {
  if (!rows) return null
  const seats = rows.flatMap((r) => Array.from({ length: Math.max(0, r.starterCount) }, () => ({ slot: r.slotName, eligible: [...r.allowedPositions] })))
  return seats.length ? seats : null
}
