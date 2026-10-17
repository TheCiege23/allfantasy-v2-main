import type { CanonicalWorld, RosterFacts } from '@/lib/decision-os/world/facts'
import { suffixlessCanonicalName } from '@/lib/draft-room/player-canonical-identity'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'

/**
 * Who is rostered where in one league, by name — shared by every Chimmy scenario (trade, waiver,
 * start/sit) so "which player did they mean" has one answer.
 *
 * Pure: the league world and the id → name map arrive already loaded.
 *
 * ⚠ NAMES GO THROUGH `normalizePlayerName`, the one the described-trade grader uses — never a local
 * lowercase. A second normalizer disagreed with the real one on 7% of rows the last time someone
 * wrote one (suffixes and apostrophes), and a name that normalizes differently simply never matches.
 */

export type LocatedPlayer = { playerId: string; rosterId: string; name: string; position: string | null }

export type PlayerNames = Map<string, { name: string | null; position: string | null }>

/** The caller's roster in this league: the one whose team they manage. Null when there is none. */
export function viewerRosterOf(world: CanonicalWorld, userId: string): RosterFacts | null {
  const viewerTeamIds = new Set(world.teams.filter((t) => t.managerUserId === userId).map((t) => t.teamId))
  return world.rosters.find((r) => r.teamId != null && viewerTeamIds.has(r.teamId)) ?? null
}

/** Every rostered player id in the league, once. */
export function allRosteredIds(world: CanonicalWorld): string[] {
  return [...new Set(world.rosters.flatMap((r) => r.playerIds))]
}

export function indexRosterNames(world: CanonicalWorld, names: PlayerNames): Map<string, LocatedPlayer[]> {
  const byName = new Map<string, LocatedPlayer[]>()
  const seenRosters = new Set<string>()
  for (const roster of world.rosters) {
    // Imported and native roster stores can both contain the same team's roster.
    // Collapse only identical player sets for a proven team; conflicting snapshots,
    // unclaimed rows and different teams must still produce ambiguity.
    const playerIds = [...new Set(roster.playerIds)]
    if (roster.teamId != null) {
      const identity = JSON.stringify([roster.teamId, [...playerIds].sort()])
      if (seenRosters.has(identity)) continue
      seenRosters.add(identity)
    }
    for (const playerId of playerIds) {
      const meta = names.get(playerId)
      if (!meta?.name) continue
      const key = normalizePlayerName(meta.name)
      if (!key) continue
      const list = byName.get(key) ?? []
      list.push({ playerId, rosterId: roster.rosterId, name: meta.name, position: meta.position ?? null })
      byName.set(key, list)
    }
  }
  return byName
}

/**
 * The spellings of one extracted name worth trying. `extractPlayerNameCandidates` takes capitalised
 * runs of up to three words, so a sentence that OPENS with a capital verb — "Trade Bijan Robinson
 * for…" — yields "Trade Bijan Robinson" and no "Bijan Robinson". Its two-word halves are tried
 * after the whole run, never instead of it (three-word names exist).
 */
export function nameVariants(candidate: string): string[] {
  const words = candidate.split(/\s+/)
  if (words.length !== 3 || normalizePlayerName(candidate) !== suffixlessCanonicalName(candidate)) return [candidate]
  return [candidate, words.slice(1).join(' '), words.slice(0, 2).join(' ')]
}

/** The first spelling of `raw` that matches rostered players, and those players. */
export function findRosteredByName(
  byName: Map<string, LocatedPlayer[]>,
  raw: string,
): { candidate: string; hits: LocatedPlayer[] } {
  for (const variant of nameVariants(raw)) {
    const found = byName.get(normalizePlayerName(variant)) ?? []
    if (found.length > 0) return { candidate: variant, hits: found }
  }
  // Screenshot display names often omit Jr./Sr. Bridge only an omitted suffix and only
  // when exactly one player identity in this league has that base name.
  for (const variant of nameVariants(raw)) {
    const strict = normalizePlayerName(variant)
    const base = suffixlessCanonicalName(variant)
    if (!base || base !== strict) continue
    const hits = [...byName.entries()].filter(([name]) => suffixlessCanonicalName(name) === base).flatMap(([, players]) => players)
    if (new Set(hits.map(p => p.playerId)).size === 1) return { candidate: variant, hits }
  }
  /*
   * Sleeper's trade card abbreviates the first name: "B. Allen" (2026-09-30). A first initial plus the
   * full surname is bridged only when exactly one player identity in this league fits — "J. Allen" in
   * a league holding Josh Allen the QB and Josh Allen the edge rusher still matches nothing.
   */
  const tokens = normalizePlayerName(raw).split(' ').filter(Boolean)
  const initial = tokens[0]?.replace(/[^a-z]/g, '') ?? ''
  if (tokens.length >= 2 && initial.length === 1) {
    const surname = tokens.slice(1).join(' ')
    const hits = [...byName.entries()]
      .filter(([name]) => {
        const t = name.split(' ')
        return t.length >= 2 && t[0]!.startsWith(initial) && t.slice(1).join(' ') === surname
      })
      .flatMap(([, players]) => players)
    if (hits.length > 0 && new Set(hits.map(p => p.playerId)).size === 1) return { candidate: raw, hits }
  }
  return { candidate: raw, hits: [] }
}

/**
 * Players who can take the field for this roster: everyone rostered EXCEPT injured reserve and taxi.
 *
 * ⚠ A RESERVED PLAYER CANNOT START, SO CANNOT BE IN A "BEST LINEUP". Counting one would let a
 * lineup comparison start a player who is not allowed to play — a plausible number, and wrong.
 */
export function activePlayerIds(roster: RosterFacts): string[] {
  const inactive = new Set([...(roster.reserveIds ?? []), ...(roster.taxiIds ?? [])])
  return roster.playerIds.filter((id) => !inactive.has(id))
}
