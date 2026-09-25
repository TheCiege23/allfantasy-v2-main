/**
 * One row per provider league-season. A league imported twice (a re-import, or the same league
 * reached through two import doors) holds two `leagues` rows with the same provider id, and
 * summing both double-counts a season's wins. Rows without a provider id are kept as-is.
 */
export function dedupeImportedLeagueRows<
  T extends { id: string; platform: string | null; platformLeagueId: string | null; season: number },
>(rows: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const row of rows) {
    const providerId = row.platformLeagueId?.trim()
    const key = providerId
      ? `${(row.platform ?? '').toLowerCase()}|${providerId}|${row.season}`
      : `row|${row.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}
