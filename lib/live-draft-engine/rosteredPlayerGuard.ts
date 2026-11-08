/**
 * A draft must not hand a team a player another team already holds.
 *
 * 🛑 PICK VALIDATION ONLY EVER CHECKED THE CURRENT DRAFT'S OWN BOARD (`validatePickSubmission`'s
 * duplicate check). In a league whose rosters already exist when a draft runs — a dynasty rookie draft,
 * where last season's rosters are carried onto the new season before the draft opens; a supplemental
 * draft; any later draft — a player on someone's roster could be drafted again. Finalization then put him
 * on a SECOND season roster: one player scoring for two teams. A rookies-only pool catches a veteran only
 * when its warm rookie snapshot happens to say "not a rookie"; a cold snapshot reads "unknown" and lets
 * him through, and an offline board the commissioner types in has no pool check at all. Found by the
 * dynasty season simulation, 2026-11-07.
 *
 * "Rostered" means live (not dropped) on a roster of the league's NEWEST season — the season a draft
 * fills. A brand-new league's startup draft has no season yet, so this is a no-op there.
 *
 * Match on the player id when the pick carries one. Fall back to the name only when it does not (a
 * commissioner typing an offline board): two real players can share a name, so a name match never
 * overrides an id.
 */
import { prisma } from '@/lib/prisma'

export type LeagueRosteredPlayers = {
  /** playerId → the season roster that holds him. */
  byId: Map<string, string>
  /** normalized name → the season roster that holds him (name-only picks). */
  byName: Map<string, string>
}

const EMPTY: LeagueRosteredPlayers = { byId: new Map(), byName: new Map() }

export function normalizeRosteredName(name: string | null | undefined): string {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export async function loadLeagueRosteredPlayers(leagueId: string): Promise<LeagueRosteredPlayers> {
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (!season) return EMPTY
  const rosters = await prisma.redraftRoster.findMany({ where: { seasonId: season.id, leagueId }, select: { id: true } })
  if (rosters.length === 0) return EMPTY
  const rows = await prisma.redraftRosterPlayer.findMany({
    where: { rosterId: { in: rosters.map((r) => r.id) }, droppedAt: null },
    select: { playerId: true, playerName: true, rosterId: true },
  })
  const byId = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const row of rows) {
    if (row.playerId) byId.set(String(row.playerId), row.rosterId)
    const name = normalizeRosteredName(row.playerName)
    if (name) byName.set(name, row.rosterId)
  }
  return { byId, byName }
}

/** The season roster already holding this player, or null. Id first; name only for an id-less pick. */
export function rosteredHolder(
  rostered: LeagueRosteredPlayers,
  player: { playerId?: string | null; playerName?: string | null },
): string | null {
  const id = String(player.playerId ?? '').trim()
  if (id) return rostered.byId.get(id) ?? null
  const name = normalizeRosteredName(player.playerName)
  return name ? rostered.byName.get(name) ?? null : null
}
