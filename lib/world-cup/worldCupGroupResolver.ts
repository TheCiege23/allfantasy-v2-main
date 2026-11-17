export type WorldCupGroupStanding = {
  group: string
  teamId: string
  teamName: string
  points: number
  goalDifference: number
  goalsFor: number
  fairPlayPoints?: number | null
}

type WorldCupThirdPlaceQualifier = {
  group: string
  teamId: string
  teamName: string
  points: number
  goalDifference: number
  goalsFor: number
}

type WorldCupRoundOf32SlotResolution = {
  slotKey: string
  teamId: string | null
  teamName: string
  source: "group_winner" | "group_runner_up" | "best_third" | "placeholder"
}

type WorldCupGroupResolverResult = {
  slots: WorldCupRoundOf32SlotResolution[]
  qualifiers: WorldCupThirdPlaceQualifier[]
  warnings: string[]
}

function compareStanding(a: WorldCupGroupStanding, b: WorldCupGroupStanding) {
  if (b.points !== a.points) return b.points - a.points
  if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference
  if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor
  const fairA = a.fairPlayPoints ?? Number.POSITIVE_INFINITY
  const fairB = b.fairPlayPoints ?? Number.POSITIVE_INFINITY
  if (fairA !== fairB) return fairA - fairB
  return a.teamName.localeCompare(b.teamName)
}

export function rankWorldCupGroupTeams(standings: WorldCupGroupStanding[]): WorldCupGroupStanding[] {
  return [...standings].sort(compareStanding)
}

export function getBestThirdPlaceTeams(groups: Record<string, WorldCupGroupStanding[]>): WorldCupThirdPlaceQualifier[] {
  const thirds: WorldCupThirdPlaceQualifier[] = []
  for (const [group, rows] of Object.entries(groups)) {
    const ranked = rankWorldCupGroupTeams(rows)
    const third = ranked[2]
    if (!third) continue
    thirds.push({
      group,
      teamId: third.teamId,
      teamName: third.teamName,
      points: third.points,
      goalDifference: third.goalDifference,
      goalsFor: third.goalsFor,
    })
  }
  return thirds.sort((a, b) => compareStanding({ ...a, fairPlayPoints: null }, { ...b, fairPlayPoints: null }))
}

const DEFAULT_PLACEHOLDER_MAP: Array<{ slotKey: string; rank: "winner" | "runner_up" | "best_third"; group?: string }> = [
  { slotKey: "A1", rank: "winner", group: "A" },
  { slotKey: "B2", rank: "runner_up", group: "B" },
  { slotKey: "C1", rank: "winner", group: "C" },
  { slotKey: "D2", rank: "runner_up", group: "D" },
  { slotKey: "E1", rank: "winner", group: "E" },
  { slotKey: "F2", rank: "runner_up", group: "F" },
  { slotKey: "G1", rank: "winner", group: "G" },
  { slotKey: "H2", rank: "runner_up", group: "H" },
  { slotKey: "I1", rank: "winner", group: "I" },
  { slotKey: "J2", rank: "runner_up", group: "J" },
  { slotKey: "K1", rank: "winner", group: "K" },
  { slotKey: "L2", rank: "runner_up", group: "L" },
  { slotKey: "TBD1", rank: "best_third" },
  { slotKey: "TBD2", rank: "best_third" },
  { slotKey: "TBD3", rank: "best_third" },
  { slotKey: "TBD4", rank: "best_third" },
]

export function resolveWorldCupRoundOf32Slots(
  groups: Record<string, WorldCupGroupStanding[]>,
  mappingTable?: Array<{ slotKey: string; rank: "winner" | "runner_up" | "best_third"; group?: string }>
): WorldCupGroupResolverResult {
  const warnings: string[] = []
  const slots: WorldCupRoundOf32SlotResolution[] = []
  const map = mappingTable ?? DEFAULT_PLACEHOLDER_MAP
  const bestThird = getBestThirdPlaceTeams(groups)
  let thirdIdx = 0

  for (const row of map) {
    if (row.rank === "best_third") {
      const team = bestThird[thirdIdx++]
      if (!team) {
        warnings.push("Not enough third-place teams to resolve all best-third slots")
        slots.push({
          slotKey: row.slotKey,
          teamId: null,
          teamName: row.slotKey,
          source: "placeholder",
        })
      } else {
        slots.push({
          slotKey: row.slotKey,
          teamId: team.teamId,
          teamName: team.teamName,
          source: "best_third",
        })
      }
      continue
    }

    const group = row.group
    if (!group || !groups[group]) {
      warnings.push(`Missing standings for group ${group ?? "unknown"}`)
      slots.push({ slotKey: row.slotKey, teamId: null, teamName: row.slotKey, source: "placeholder" })
      continue
    }

    const ranked = rankWorldCupGroupTeams(groups[group])
    const team = row.rank === "winner" ? ranked[0] : ranked[1]
    if (!team) {
      warnings.push(`Missing ${row.rank} for group ${group}`)
      slots.push({ slotKey: row.slotKey, teamId: null, teamName: row.slotKey, source: "placeholder" })
      continue
    }

    slots.push({
      slotKey: row.slotKey,
      teamId: team.teamId,
      teamName: team.teamName,
      source: row.rank === "winner" ? "group_winner" : "group_runner_up",
    })
  }

  if (!mappingTable) {
    warnings.push("TODO: Insert official FIFA 2026 best-third mapping table when published")
  }

  return { slots, qualifiers: bestThird, warnings }
}
