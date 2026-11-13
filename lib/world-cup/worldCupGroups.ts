export const WORLD_CUP_GROUP_KEYS = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
] as const

export type WorldCupGroupKey = (typeof WORLD_CUP_GROUP_KEYS)[number]

export type WorldCupGroupDefinition = {
  groupKey: WorldCupGroupKey
  displayName: string
  sortOrder: number
}

export type WorldCupValidationResult =
  | { ok: true }
  | { ok: false; error: string }

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length
}

export function validateWorldCupGroupRanking(teamIds: readonly string[]): WorldCupValidationResult {
  if (teamIds.length !== 4) {
    return { ok: false, error: "World Cup group rankings require exactly 4 teams." }
  }
  if (teamIds.some((teamId) => typeof teamId !== "string" || teamId.trim().length === 0)) {
    return { ok: false, error: "World Cup group rankings require valid team IDs." }
  }
  if (hasDuplicates(teamIds)) {
    return { ok: false, error: "World Cup group rankings cannot contain duplicate teams." }
  }
  return { ok: true }
}

export function validateWorldCupThirdPlaceSelections(
  groupKeysOrTeamIds: readonly string[]
): WorldCupValidationResult {
  if (groupKeysOrTeamIds.length !== 8) {
    return { ok: false, error: "World Cup third-place selections require exactly 8 teams." }
  }
  if (groupKeysOrTeamIds.some((value) => typeof value !== "string" || value.trim().length === 0)) {
    return { ok: false, error: "World Cup third-place selections require valid IDs." }
  }
  if (hasDuplicates(groupKeysOrTeamIds)) {
    return { ok: false, error: "World Cup third-place selections cannot contain duplicates." }
  }
  return { ok: true }
}

export function buildWorldCupGroupDefinitions(): WorldCupGroupDefinition[] {
  return WORLD_CUP_GROUP_KEYS.map((groupKey, index) => ({
    groupKey,
    displayName: `Group ${groupKey}`,
    sortOrder: index + 1,
  }))
}
