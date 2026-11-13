/**
 * Names and positions for ESPN players the league response does not describe.
 *
 * A draft pick carries only `playerId`. The import names it from the CURRENT rosters, so a player
 * drafted and since dropped had no name and no position — 17 of 160 picks in the captured league
 * (contracts/espn/GAPS.md `D-01`). Two ways to fill them, neither of which calls ESPN:
 *
 *   - Team defenses: a D/ST id is `-16000 - proTeamId` (`espnDefenseTeamAbbreviation`, the one
 *     copy of that rule). The id alone gives the position and the team.
 *   - Everyone else: `PlayerIdentityMap.espnId`, NFL only.
 *
 * 🛑 `espnId` IS NOT UNIQUE (lib/core-app/crosswalkRules.ts): two rows sharing one id are two
 * different athletes. An id that maps to more than one name is left unnamed — "unknown" is true,
 * a stranger's name on a draft board is not.
 *
 * Fails soft: a failed read fills nothing, which is exactly the result before this existed.
 */
import { prisma } from '@/lib/prisma'
import { espnDefenseTeamAbbreviation } from './espnTeamDefenseIds'

export type EspnPlayerSummary = { name: string | null; position: string | null; team: string | null }

/** An ESPN team-defense id → its summary, or null for any other id. Pure. */
function espnDefenseSummary(playerId: string): EspnPlayerSummary | null {
  const team = espnDefenseTeamAbbreviation(playerId)
  return team ? { name: `${team} D/ST`, position: 'D/ST', team } : null
}

function isDescribed(summary: EspnPlayerSummary | undefined): boolean {
  return Boolean(summary?.name && summary.position && summary.position !== 'N/A')
}

/**
 * Adds summaries for the ids `directory` cannot describe. Returns how many it added. Ids already
 * described are never overwritten: the league's own data outranks a lookup.
 */
export async function fillEspnPlayerDirectory(
  directory: Map<string, EspnPlayerSummary>,
  playerIds: readonly string[],
): Promise<number> {
  const wanted = [...new Set(playerIds.map((id) => String(id).trim()).filter(Boolean))].filter(
    (id) => !isDescribed(directory.get(id)),
  )
  let added = 0
  const lookup: string[] = []
  for (const id of wanted) {
    const defense = espnDefenseSummary(id)
    if (defense) {
      directory.set(id, defense)
      added += 1
    } else if (/^\d+$/.test(id)) {
      lookup.push(id)
    }
  }
  if (lookup.length === 0) return added

  try {
    const rows = (await prisma.playerIdentityMap.findMany({
      where: { sport: 'NFL', espnId: { in: lookup } },
      select: { espnId: true, canonicalName: true, position: true, currentTeam: true },
    })) as Array<{ espnId: string | null; canonicalName: string; position: string | null; currentTeam: string | null }>
    const byId = new Map<string, typeof rows>()
    for (const row of rows) {
      if (!row.espnId) continue
      byId.set(row.espnId, [...(byId.get(row.espnId) ?? []), row])
    }
    for (const [id, matches] of byId) {
      const names = new Set(matches.map((m) => m.canonicalName.trim()).filter(Boolean))
      if (names.size !== 1) continue
      const row = matches[0]
      directory.set(id, {
        name: row.canonicalName.trim(),
        position: row.position?.trim() || null,
        team: row.currentTeam?.trim() || null,
      })
      added += 1
    }
  } catch {
    // Fill nothing more.
  }
  return added
}
