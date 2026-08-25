import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * How many taxi-squad years a player has used, and how many are left.
 *
 * ⚠ THIS IS A DERIVED NUMBER AND IT IS ALLOWED TO SAY "I DON'T KNOW".
 *
 * There is no column anywhere recording how long a player has sat on a taxi
 * squad. The only real per-season evidence is `RosterSnapshot` — a season-end
 * row per league, whose `rosterPlayers` entries each carry a `bucket` of
 * starter / bench / reserve / taxi. Counting the distinct seasons a player
 * appears there with `bucket: 'taxi'` is the honest reconstruction.
 *
 * It is honest, but it is not complete, and the gaps matter because getting
 * this wrong costs a real roster spot:
 *
 *   - Snapshots only exist for Sleeper leagues whose historical backfill ran.
 *   - The backfill SKIPS a season that already has a snapshot, so the current
 *     season's row is frozen at import time rather than kept current.
 *   - A league with no `previous_league_id` chain has exactly one season on
 *     file, which is indistinguishable from a player's first taxi year.
 *
 * So: when there are no snapshots, or the league never recorded a taxi-years
 * limit, this returns `null` and the screen says the number is unavailable.
 * A confidently wrong "1 year left" is how someone loses a player to a
 * deadline they thought they had time to beat.
 *
 * The devy/C2C tables (`DevyTaxiSlot.taxiYearsCurrent`, `taxiYearsUsed`) look
 * like they answer this and do not — nothing ever increments them past the 1
 * written at creation, so reading them would produce a permanent "year 1".
 */

export type TaxiTenure = {
  /** Distinct prior seasons this player was on the taxi squad. */
  yearsUsed: number
  /** From `League.taxiYearsLimit`. */
  yearsAllowed: number
  /** Never negative — a league can shorten the limit under a sitting player. */
  yearsRemaining: number
}

type SnapshotPlayer = { id?: unknown; bucket?: unknown }

/** Season-end snapshots are written with this period. */
const SEASON_END = 0

/**
 * Build a per-player tenure map for one league.
 *
 * Returns null when the question cannot be answered at all — the caller
 * renders an explicit absence rather than a default.
 */
export async function getTaxiTenure(
  leagueId: string,
  playerIds: string[],
): Promise<Map<string, TaxiTenure> | null> {
  if (playerIds.length === 0) return null

  const league = await prisma.league
    .findUnique({ where: { id: leagueId }, select: { taxiYearsLimit: true } })
    .catch(() => null)

  const yearsAllowed = league?.taxiYearsLimit ?? null
  // No recorded limit means no arithmetic to do. Defaulting to Sleeper's usual
  // 2 would be a guess about someone else's league rules.
  if (yearsAllowed == null || yearsAllowed <= 0) return null

  const snapshots = await prisma.rosterSnapshot
    .findMany({
      where: { leagueId, weekOrPeriod: SEASON_END },
      select: { season: true, rosterPlayers: true },
    })
    .catch(() => [])

  // No history at all — every answer would be "year 1", which is a claim, not
  // a reading.
  if (snapshots.length === 0) return null

  const wanted = new Set(playerIds)
  /** playerId -> set of seasons seen on taxi */
  const seasonsOnTaxi = new Map<string, Set<number>>()

  for (const snap of snapshots) {
    const players = Array.isArray(snap.rosterPlayers)
      ? (snap.rosterPlayers as SnapshotPlayer[])
      : []
    for (const entry of players) {
      if (!entry || typeof entry !== 'object') continue
      const id = entry.id == null ? '' : String(entry.id)
      if (!id || !wanted.has(id)) continue
      if (String(entry.bucket ?? '').toLowerCase() !== 'taxi') continue
      // `season` is nullable on this table. A row that cannot say which season
      // it belongs to cannot contribute a distinct year — counting it would
      // either double-count with a real season or invent one.
      if (snap.season == null) continue
      let set = seasonsOnTaxi.get(id)
      if (!set) {
        set = new Set<number>()
        seasonsOnTaxi.set(id, set)
      }
      set.add(snap.season)
    }
  }

  const out = new Map<string, TaxiTenure>()
  for (const id of playerIds) {
    const yearsUsed = seasonsOnTaxi.get(id)?.size ?? 0
    out.set(id, {
      yearsUsed,
      yearsAllowed,
      // Clamped: a league that cuts its limit from 3 to 2 under a player who
      // already used 3 produces a negative, and "-1 years left" is nonsense.
      yearsRemaining: Math.max(0, yearsAllowed - yearsUsed),
    })
  }
  return out
}
