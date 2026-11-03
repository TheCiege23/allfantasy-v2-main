export type CategoryMatchupInput = {
  teamId1: string
  teamId2: string | null
  categories1?: Record<string, number>
  categories2?: Record<string, number>
}

export type ImportedCategoryPair = {
  roster1: string
  roster2: string
  categories1: Record<string, number>
  categories2: Record<string, number>
}

export function importedCategoryCacheKey(provider: string, leagueId: string, season: number, week: number): string {
  return `imported_category_matchup:${provider}:${leagueId}:${season}:${week}`
}

export function yahooRosterId(teamKey: string): string | null {
  const raw = teamKey.split('.t.')[1] ?? teamKey
  if (!raw.trim()) return null
  const n = Number(raw.trim())
  return Number.isSafeInteger(n) && n >= 0 ? String(n) : null
}

/** Keep only pairings for which the provider supplied matching, finite stat totals on both sides. */
export function verifiedCategoryPairs(
  matchups: readonly CategoryMatchupInput[],
  toRoster: (id: string) => string | null,
): ImportedCategoryPair[] {
  const pairs: ImportedCategoryPair[] = []
  for (const match of matchups) {
    const roster1 = toRoster(match.teamId1)
    const roster2 = match.teamId2 ? toRoster(match.teamId2) : null
    if (!roster1 || !roster2 || roster1 === roster2 || !match.categories1 || !match.categories2) continue
    const keys1 = Object.keys(match.categories1).sort()
    const keys2 = Object.keys(match.categories2).sort()
    if (keys1.length < 2 || keys1.length > 40 || keys1.join(',') !== keys2.join(',') ||
      keys1.some((key) => !/^[A-Za-z0-9_. -]{1,40}$/.test(key) || !Number.isFinite(match.categories1![key]) || !Number.isFinite(match.categories2![key]))) continue
    pairs.push({ roster1, roster2, categories1: match.categories1, categories2: match.categories2 })
  }
  return pairs
}

export function parseImportedCategoryPairs(value: unknown): ImportedCategoryPair[] {
  if (!Array.isArray(value)) return []
  return value.filter((pair): pair is ImportedCategoryPair => {
    if (!pair || typeof pair !== 'object' || typeof pair.roster1 !== 'string' || typeof pair.roster2 !== 'string') return false
    return verifiedCategoryPairs([{ teamId1: pair.roster1, teamId2: pair.roster2,
      categories1: pair.categories1, categories2: pair.categories2 }], (id) => id).length === 1
  })
}
