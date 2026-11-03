import "server-only"

import { prisma } from "@/lib/prisma"
import { matchTeamIdForRoster } from "@/lib/leagues/rosterTeamIdentity"

export type FlagManager = { rosterId: string; managerName: string; teamName: string | null }

type FlagLike = { id: string; leagueId: string; affectedRosterIds: string[]; evidenceJson: unknown }

function evidenceSides(evidenceJson: unknown): { rosterId?: string; teamName?: string; managerName?: string }[] {
  const ev = evidenceJson && typeof evidenceJson === "object" ? (evidenceJson as Record<string, unknown>) : {}
  return [ev.team1, ev.team2].filter((s): s is Record<string, string> => Boolean(s) && typeof s === "object")
}

/**
 * Who each flag is about, by name — the managers, not just the teams or the assets.
 *
 * A collusion flag records `managerName` on each side since the scan started carrying it. Older flags,
 * and tanking flags, only have roster ids, and those ids come from three stores: a native `RedraftRoster`,
 * an imported `Roster`, or a `LeagueTeam`. Each is tried, and an imported roster is joined to its team
 * with the same `matchTeamIdForRoster` the canonical world uses, so the two can never name different
 * people. An id that resolves nowhere is left out rather than guessed.
 */
export async function resolveFlagManagers(flags: readonly FlagLike[]): Promise<Map<string, FlagManager[]>> {
  const out = new Map<string, FlagManager[]>()
  if (flags.length === 0) return out

  const ids = [...new Set(flags.flatMap((f) => f.affectedRosterIds))]
  const leagueIds = [...new Set(flags.map((f) => f.leagueId))]
  const [redraft, rosters, teams] = await Promise.all([
    prisma.redraftRoster.findMany({ where: { id: { in: ids } }, select: { id: true, ownerName: true, teamName: true } }),
    prisma.roster.findMany({ where: { id: { in: ids } }, select: { id: true, leagueId: true, platformUserId: true, playerData: true } }),
    prisma.leagueTeam.findMany({
      where: { leagueId: { in: leagueIds } },
      select: { id: true, leagueId: true, externalId: true, ownerName: true, teamName: true, platformUserId: true, claimedByUserId: true },
    }),
  ])

  const lookup = (leagueId: string, id: string): { managerName: string; teamName: string | null } | null => {
    const r = redraft.find((x) => x.id === id)
    if (r?.ownerName?.trim()) return { managerName: r.ownerName.trim(), teamName: r.teamName?.trim() || null }
    const leagueTeams = teams.filter((t) => t.leagueId === leagueId)
    let team = leagueTeams.find((t) => t.id === id || t.externalId === id)
    if (!team) {
      const roster = rosters.find((x) => x.id === id)
      const teamId = roster ? matchTeamIdForRoster(roster, leagueTeams) : null
      team = teamId ? leagueTeams.find((t) => t.id === teamId) : undefined
    }
    return team?.ownerName?.trim() ? { managerName: team.ownerName.trim(), teamName: team.teamName?.trim() || null } : null
  }

  for (const flag of flags) {
    const sides = evidenceSides(flag.evidenceJson)
    out.set(
      flag.id,
      flag.affectedRosterIds.flatMap((rosterId) => {
        const side = sides.find((s) => s.rosterId === rosterId)
        const stored = side?.managerName?.trim()
        if (stored) return [{ rosterId, managerName: stored, teamName: side?.teamName?.trim() || null }]
        const found = lookup(flag.leagueId, rosterId)
        return found ? [{ rosterId, ...found }] : []
      }),
    )
  }
  return out
}
