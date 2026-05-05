/**
 * Optional numeric/stat filters for draft pool rows — complements **`DraftPlayerSearchResolver`** (text/position).
 */

export type DraftPoolNumericRow = {
  name: string
  position: string
  projectedPoints?: number | null
  age?: number | null
  byeWeek?: number | null
  tackles?: number | null
  sacks?: number | null
}

export function filterByProjectedPointsAtLeast<T extends DraftPoolNumericRow>(
  rows: T[],
  min: number | null | undefined,
): T[] {
  if (min == null || !Number.isFinite(min)) return rows
  return rows.filter((r) => {
    const v = r.projectedPoints
    return v != null && Number.isFinite(v) && v >= min
  })
}

export function filterByAgeAtMost<T extends DraftPoolNumericRow>(rows: T[], maxAge: number | null | undefined): T[] {
  if (maxAge == null || !Number.isFinite(maxAge)) return rows
  return rows.filter((r) => {
    const v = r.age
    return v != null && Number.isFinite(v) && v <= maxAge
  })
}

export function filterByByeWeek<T extends DraftPoolNumericRow>(
  rows: T[],
  bye: number | null | undefined,
): T[] {
  if (bye == null || !Number.isFinite(bye)) return rows
  return rows.filter((r) => r.byeWeek === bye)
}

export function filterByIdpStatAtLeast<T extends DraftPoolNumericRow>(
  rows: T[],
  stat: 'tackles' | 'sacks',
  min: number | null | undefined,
): T[] {
  if (min == null || !Number.isFinite(min)) return rows
  return rows.filter((r) => {
    const v = stat === 'tackles' ? r.tackles : r.sacks
    return v != null && Number.isFinite(v) && v >= min
  })
}

export {
  filterDraftPlayersByStat,
  type StatColumnFilter,
  type StatColumnFilterOp,
} from '@/lib/draft-room/draftSportStatColumns'
