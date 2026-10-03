import 'server-only'

import { prisma } from '@/lib/prisma'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { findSportsPlayersByLeagueIds } from '@/lib/player-identity/findSportsPlayerByLeagueId'

export type AutoCoachRosterPlayer = {
  /** The roster id — what `excludedPlayerIds` stores and what the engine compares against. */
  id: string
  name: string
  position: string | null
  team: string | null
  leagueNames: string[]
}

/**
 * The players a user could exclude from AutoCoach: everyone on their starters + bench in the
 * leagues they have an AutoCoach row for.
 *
 * It replaces a free-text "player id" box in the old panel, which nobody could fill in. Ids are the
 * ROSTER's ids — the same ones `runAutoCoachForLeague` compares `excludedPlayerIds` against — and
 * names come from `findSportsPlayersByLeagueIds`, the lookup the engine itself uses, so a player
 * shown here is the player the exclusion will protect.
 *
 * DB reads only. Bounded by the user's AutoCoach leagues, which is a handful.
 */
export async function listAutoCoachRosterPlayers(
  userId: string,
  leagues: ReadonlyArray<{ id: string; name: string | null; sport: string }>,
): Promise<AutoCoachRosterPlayer[]> {
  const byId = new Map<string, AutoCoachRosterPlayer>()

  for (const league of leagues) {
    const roster = await prisma.roster.findFirst({
      where: { leagueId: league.id, platformUserId: userId },
      select: { playerData: true },
    })
    if (!roster) continue

    const sections = getNormalizedLineupSections(roster.playerData)
    const rows = [...sections.starters, ...sections.bench]
    const ids = rows.map((r) => String(r.id ?? '').trim()).filter(Boolean)
    if (ids.length === 0) continue

    const lookup = await findSportsPlayersByLeagueIds(String(league.sport), ids)
    for (const raw of rows) {
      const id = String(raw.id ?? '').trim()
      if (!id) continue
      const sp = lookup.get(id)
      const leagueName = league.name ?? 'League'
      const existing = byId.get(id)
      if (existing) {
        if (!existing.leagueNames.includes(leagueName)) existing.leagueNames.push(leagueName)
        continue
      }
      byId.set(id, {
        id,
        name: sp?.name ?? (typeof raw.name === 'string' && raw.name ? raw.name : id),
        position: sp?.position ?? (typeof raw.position === 'string' ? raw.position : null),
        team: sp?.team ?? null,
        leagueNames: [leagueName],
      })
    }
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}
