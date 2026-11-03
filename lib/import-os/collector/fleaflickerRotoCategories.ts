import type { FleaflickerStandingsResponse } from '@/lib/league-import/fleaflicker/types'

export type FleaflickerRotoCategoryRow = {
  teamId: string
  teamName: string
  rank: number | null
  categories: Array<{ id: string; label: string; value: number; rank: number | null; rankPoints: number | null }>
}

/** The roto standings endpoint gives season values, not weekly head-to-head category results. */
export function fleaflickerRotoCategoryRows(body: FleaflickerStandingsResponse): FleaflickerRotoCategoryRow[] {
  return body.divisions.flatMap((division) => division.teams).flatMap((team) => {
    const categories: FleaflickerRotoCategoryRow['categories'] = []
    const seen = new Set<string>()
    for (const raw of team.roto?.statValues ?? []) {
      const id = raw.category?.id
      const value = raw.value?.value
      if (!Number.isSafeInteger(id) || id! < 0 || typeof value !== 'number' || !Number.isFinite(value)) continue
      const key = String(id)
      if (seen.has(key)) continue
      seen.add(key)
      const label = String(raw.category?.abbreviation || raw.category?.nameSingular || `stat ${key}`)
        .trim().slice(0, 40).replace(/[\r\n]/g, ' ')
      categories.push({ id: key, label, value,
        rank: Number.isInteger(raw.rank) && raw.rank! > 0 ? raw.rank! : null,
        rankPoints: typeof raw.rotoPoints?.value === 'number' && Number.isFinite(raw.rotoPoints.value)
          ? raw.rotoPoints.value : null })
    }
    if (categories.length < 2) return []
    const rank = team.roto?.overallRank
    return [{ teamId: String(team.id), teamName: team.name,
      rank: Number.isInteger(rank) && rank! > 0 ? rank! : null, categories }]
  })
}
