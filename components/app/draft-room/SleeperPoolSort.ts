/**
 * D.3 — sort model for the Sleeper-style draft pool table.
 *
 * Sport-aware: stat sort keys resolve through **`findSleeperPoolStatDef`** +
 * **`getStatValueForDraftPlayer`** for non-legacy keys. NFL split keys (`pts`, `ru_att`, …)
 * stay compatible with existing behavior.
 */

import type { NflDraftProjectionSplits } from '@/lib/draft/analytics/nfl-draft-pool-projection-splits'
import type { PlayerDisplayModel } from '@/lib/draft-sports-models/types'
import {
  findSleeperPoolStatDef,
  getStatValueForDraftPlayer,
  type DraftStatColumnOptions,
  type DraftStatPlayerSource,
} from '@/lib/draft-room/draftSportStatColumns'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

/** Minimal player shape this module needs. PlayerPanel.PlayerEntry is a superset. */
export interface PoolSortPlayer {
  name: string
  adp?: number | null
  aiAdp?: number | null
  byeWeek?: number | null
  /** Pool row display (same shape as **`PlayerPanel.PlayerEntry`**). */
  display?: PlayerDisplayModel | null
  nflDraftProjectionSplits?: NflDraftProjectionSplits | null
}

/** Sort state key — includes legacy (`projected`, `name`) and sport stat keys (`pts`, `hr`, …). */
export type PoolSortKey = string

export type PoolSortDirection = 'asc' | 'desc'

export interface PoolSortState {
  key: PoolSortKey
  direction: PoolSortDirection
}

function num(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function defaultSortDirectionForKey(key: PoolSortKey): PoolSortDirection {
  if (key === 'adp' || key === 'aiAdp' || key === 'name' || key === 'bye') return 'asc'
  return 'desc'
}

/** Extract sort value. Pass **`draftSport`** so NBA/MLB/etc. stat keys resolve. */
export function sortValueForKey(
  p: PoolSortPlayer,
  key: PoolSortKey,
  draftSport?: string,
  statOpts?: DraftStatColumnOptions,
): string | number | null {
  switch (key) {
    case 'name':
      return p.name ?? ''
    case 'adp':
      return num(p.adp)
    case 'aiAdp':
      return num(p.aiAdp)
    case 'bye':
      return num(p.byeWeek)
    case 'projected':
      return (
        num(p.display?.stats?.fantasyPointsPerGame ?? null) ??
        num(p.nflDraftProjectionSplits?.projectedPointsPerGame)
      )
    default:
      break
  }

  const sport = draftSport ?? 'NFL'
  const def = findSleeperPoolStatDef(sport, key, statOpts)
  if (def) return getStatValueForDraftPlayer(p as DraftStatPlayerSource, def)

  // NFL legacy paths (also covered by findSleeperPoolStatDef for NFL — defensive fallback)
  if (key === 'pts') return num(p.nflDraftProjectionSplits?.projectedPoints)
  if (key === 'ru_att') return num(p.nflDraftProjectionSplits?.rushing?.att)
  if (key === 'ru_yds') return num(p.nflDraftProjectionSplits?.rushing?.yds)
  if (key === 'ru_td') return num(p.nflDraftProjectionSplits?.rushing?.td)
  if (key === 'rec') return num(p.nflDraftProjectionSplits?.receiving?.rec)
  if (key === 'rec_yds') return num(p.nflDraftProjectionSplits?.receiving?.yds)
  if (key === 'rec_td') return num(p.nflDraftProjectionSplits?.receiving?.td)
  if (key === 'pa_att') return num(p.nflDraftProjectionSplits?.passing?.att)
  if (key === 'pa_yds') return num(p.nflDraftProjectionSplits?.passing?.yds)
  if (key === 'pa_td') return num(p.nflDraftProjectionSplits?.passing?.td)
  if (key === 'pa_int') return num(p.nflDraftProjectionSplits?.passing?.int)

  return null
}

export function comparePoolSort(
  a: string | number | null,
  b: string | number | null,
  direction: PoolSortDirection,
): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'string' && typeof b === 'string') {
    return direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a)
  }
  const an = typeof a === 'number' ? a : Number(a)
  const bn = typeof b === 'number' ? b : Number(b)
  if (!Number.isFinite(an) && !Number.isFinite(bn)) return 0
  if (!Number.isFinite(an)) return 1
  if (!Number.isFinite(bn)) return -1
  return direction === 'asc' ? an - bn : bn - an
}

export function applyPoolSort<T extends PoolSortPlayer>(
  list: readonly T[],
  state: PoolSortState,
  draftSport?: string,
  statOpts?: DraftStatColumnOptions,
): T[] {
  const out = [...list]
  out.sort((a, b) => {
    const cmp = comparePoolSort(
      sortValueForKey(a, state.key, draftSport, statOpts),
      sortValueForKey(b, state.key, draftSport, statOpts),
      state.direction,
    )
    if (cmp !== 0) return cmp
    const tieKey = state.key === 'aiAdp' ? 'aiAdp' : 'adp'
    const tieA = tieKey === 'aiAdp' ? num(a.aiAdp) : num(a.adp)
    const tieB = tieKey === 'aiAdp' ? num(b.aiAdp) : num(b.adp)
    const tieCmp = comparePoolSort(tieA, tieB, 'asc')
    if (tieCmp !== 0) return tieCmp
    return (a.name ?? '').localeCompare(b.name ?? '')
  })
  return out
}

export function nextSortState(current: PoolSortState, requested: PoolSortKey): PoolSortState {
  if (current.key === requested) {
    return { key: requested, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  }
  return { key: requested, direction: defaultSortDirectionForKey(requested) }
}

/**
 * Map visible column key → sort key. **`avg`** on NFL/NCAAF maps to **`projected`** (PPG).
 * Unknown stat column keys pass through (e.g. NBA **`pts`** → **`pts`**).
 */
export function sortKeyForColumn(columnKey: string, draftSport?: string): PoolSortKey | null {
  if (columnKey === 'actions') return null
  if (columnKey === 'player') return 'name'
  if (columnKey === 'rk') return 'adp'
  if (columnKey === 'adp') return 'adp'
  if (columnKey === 'aiAdp') return 'aiAdp'
  if (columnKey === 'bye') return 'bye'
  if (columnKey === 'avg') {
    const s = draftSport ? normalizeToSupportedSport(draftSport) : 'NFL'
    if (s === 'NFL' || s === 'NCAAF') return 'projected'
    return 'avg'
  }
  return columnKey
}

export function ariaSortValue(
  columnKey: string,
  state: PoolSortState,
  draftSport?: string,
): 'ascending' | 'descending' | 'none' {
  const sortKey = sortKeyForColumn(columnKey, draftSport)
  if (!sortKey) return 'none'
  if (sortKey !== state.key) return 'none'
  return state.direction === 'asc' ? 'ascending' : 'descending'
}

/** @deprecated Use **`defaultSortDirectionForKey`** — kept for tests importing the old name. */
export const DEFAULT_SORT_DIRECTIONS: Record<string, PoolSortDirection> = {
  adp: 'asc',
  aiAdp: 'asc',
  name: 'asc',
  bye: 'asc',
  projected: 'desc',
  pts: 'desc',
  ru_att: 'desc',
  ru_yds: 'desc',
  ru_td: 'desc',
  rec: 'desc',
  rec_yds: 'desc',
  rec_td: 'desc',
  pa_att: 'desc',
  pa_yds: 'desc',
  pa_td: 'desc',
  pa_int: 'desc',
}

/** @deprecated Prefer **`sortKeyForColumn(col, draftSport)` — static map valid for NFL-only. */
export const COLUMN_TO_SORT_KEY: Record<string, PoolSortKey | null> = {
  rk: 'adp',
  player: 'name',
  adp: 'adp',
  aiAdp: 'aiAdp',
  bye: 'bye',
  pts: 'pts',
  avg: 'projected',
  ru_att: 'ru_att',
  ru_yds: 'ru_yds',
  ru_td: 'ru_td',
  rec: 'rec',
  rec_yds: 'rec_yds',
  rec_td: 'rec_td',
  pa_att: 'pa_att',
  pa_yds: 'pa_yds',
  pa_td: 'pa_td',
  pa_int: 'pa_int',
  actions: null,
}
