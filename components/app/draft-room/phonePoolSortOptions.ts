import { buildSleeperPoolStatColumnDefs, type DraftStatColumnOptions } from '@/lib/draft-room/draftSportStatColumns'
import { sortKeyForColumn, type PoolSortKey } from './SleeperPoolSort'

/**
 * What a phone can sort the player pool by — the same keys the desktop table's column headers sort
 * by (`sortKeyForColumn`), so a sort chosen on one layout means the same on the other.
 *
 * The desktop table has had sortable headers for a long time; the phone card list had filters and
 * no sort at all. That is the r/fantasyhockey complaint about drafting on Yahoo's 2026 app: "you
 * weren't able to sort by average points per game last year". For NHL the list now includes GP and
 * FP/G (last season, this league's scoring) — see `NHL_SKATER` in draftSportStatColumns.ts.
 */
export interface PhonePoolSortOption {
  key: PoolSortKey
  label: string
}

export function phonePoolSortOptions(sport: string, statOpts: DraftStatColumnOptions, useAiAdp: boolean): PhonePoolSortOption[] {
  const out: PhonePoolSortOption[] = [{ key: useAiAdp ? 'aiAdp' : 'adp', label: useAiAdp ? 'AI ADP' : 'ADP' }]
  const seen = new Set(out.map((o) => o.key))
  for (const def of buildSleeperPoolStatColumnDefs(sport, statOpts)) {
    const key = sortKeyForColumn(def.key, sport)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ key, label: def.label })
  }
  if (!seen.has('name')) out.push({ key: 'name', label: 'Name' })
  return out
}
