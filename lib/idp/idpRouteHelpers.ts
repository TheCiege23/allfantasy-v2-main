/**
 * Shared helpers for `/api/idp/*` routes — roster membership + IDP row parsing.
 */

import { prisma } from '@/lib/prisma'
import { isIdpPosition, normalizeIdpPosition } from '@/lib/idp-kicker-values'
import { rosterPlayerIds } from '@/lib/core-app/myRoster'

/**
 * Every player id appearing on any roster in the league (offense + defense).
 *
 * ⚠ THIS RETURNED AN EMPTY SET FOR EVERY LEAGUE IN PRODUCTION. It guarded on
 * `Array.isArray(playerData)` and skipped anything else — but **0 of 1,094 roster rows are
 * arrays**; they are all objects of the form `{ players: string[], starters: [...], taxi: [...] }`.
 * So the guard skipped every row and the function reported that nobody in any league rosters
 * anybody.
 *
 * The visible symptom was in the caller: `/api/idp/players` defaults to `pool=waiver`, which
 * excludes rostered players by subtracting this set. Subtracting nothing means the waiver pool
 * has been listing players who are already on a roster — as free agents — for every league.
 * It looked like a working feature because a full list of names is exactly what a working
 * waiver pool renders.
 *
 * Parsing now goes through `rosterPlayerIds`, which is also what the Defense Hub and My Team
 * use, so a future change to the blob shape breaks one place instead of three.
 */
export async function getRosteredPlayerIdsInLeague(leagueId: string): Promise<Set<string>> {
  const rows = await prisma.roster.findMany({
    where: { leagueId },
    select: { playerData: true },
  })
  const set = new Set<string>()
  for (const r of rows) for (const id of rosterPlayerIds(r.playerData)) set.add(id)
  return set
}

export type ParsedIdpRosterRow = {
  playerId: string
  name: string
  position: string
  team?: string
}

/** IDP-only rows from Prisma `roster.playerData` JSON (same shape as league shell). */
export function parseIdpRowsFromPlayerData(playerData: unknown): ParsedIdpRosterRow[] {
  if (!Array.isArray(playerData)) return []
  const out: ParsedIdpRosterRow[] = []
  for (const raw of playerData) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const pid = String(o.playerId ?? o.id ?? o.sleeperPlayerId ?? '')
    const pos = String(o.position ?? o.pos ?? '')
    if (!pid || !isIdpPosition(pos)) continue
    out.push({
      playerId: pid,
      name: String(o.name ?? o.playerName ?? pid).slice(0, 120),
      position: pos.toUpperCase(),
      team: typeof o.team === 'string' ? o.team : undefined,
    })
  }
  return out
}

/** Match Sleeper position to UI filter (DL / LB / DB or granular DE, DT, …). */
export function matchesIdpPositionFilter(playerPosition: string, filter: string): boolean {
  const f = filter.trim().toUpperCase()
  if (!f) return true
  const p = playerPosition.toUpperCase()
  if (f === 'DL') return ['DE', 'DT', 'DL'].includes(p)
  if (f === 'DB') return ['CB', 'S', 'SS', 'FS', 'DB'].includes(p)
  if (f === 'LB') return p === 'LB' || p === 'ILB' || p === 'OLB'
  return p === f || normalizeIdpPosition(p) === normalizeIdpPosition(f)
}
