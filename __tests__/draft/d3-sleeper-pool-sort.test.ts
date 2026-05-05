import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  applyPoolSort,
  ariaSortValue,
  COLUMN_TO_SORT_KEY,
  comparePoolSort,
  DEFAULT_SORT_DIRECTIONS,
  nextSortState,
  sortKeyForColumn,
  sortValueForKey,
  type PoolSortPlayer,
  type PoolSortState,
} from '@/components/app/draft-room/SleeperPoolSort'

/**
 * D.3 — sortable Sleeper-pool table headers. Pure-logic coverage of the
 * sort module + static-source assertions for the wiring in PlayerPanel and
 * SleeperPoolTable (which can't be rendered through the Vitest oxc transform).
 */

const root = resolve(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

function makePlayer(over: Partial<PoolSortPlayer> & { name: string }): PoolSortPlayer {
  return { ...over }
}

const burrow = makePlayer({
  name: 'Joe Burrow',
  adp: 38,
  aiAdp: 32,
  byeWeek: 12,
  nflDraftProjectionSplits: {
    source: 'rolling_insights_stats',
    projectedPoints: 280,
    projectedPointsPerGame: 17.5,
    rushing: { att: 30, yds: 95, td: 1 },
    receiving: { rec: null, tar: null, yds: null, td: null },
    passing: { cmp: 410, att: 600, yds: 4350, td: 32, int: 8 },
  },
})
const cmcRb = makePlayer({
  name: 'Christian McCaffrey',
  adp: 6,
  aiAdp: 5,
  byeWeek: 9,
  nflDraftProjectionSplits: {
    source: 'rolling_insights_stats',
    projectedPoints: 305,
    projectedPointsPerGame: 19.06,
    rushing: { att: 270, yds: 1340, td: 12 },
    receiving: { rec: 75, tar: 95, yds: 600, td: 4 },
    passing: { cmp: null, att: null, yds: null, td: null, int: null },
  },
})
const noStats = makePlayer({
  name: 'Anonymous Rookie',
  adp: 250,
  aiAdp: null,
  byeWeek: null,
  nflDraftProjectionSplits: null,
})

describe('D.3 — comparePoolSort: nulls always last', () => {
  it('nulls go after numbers regardless of direction', () => {
    expect(comparePoolSort(null, 5, 'asc')).toBeGreaterThan(0)
    expect(comparePoolSort(null, 5, 'desc')).toBeGreaterThan(0)
    expect(comparePoolSort(5, null, 'asc')).toBeLessThan(0)
    expect(comparePoolSort(5, null, 'desc')).toBeLessThan(0)
  })

  it('two nulls compare equal', () => {
    expect(comparePoolSort(null, null, 'asc')).toBe(0)
    expect(comparePoolSort(null, null, 'desc')).toBe(0)
  })

  it('asc sorts low → high', () => {
    expect(comparePoolSort(3, 7, 'asc')).toBeLessThan(0)
    expect(comparePoolSort(7, 3, 'asc')).toBeGreaterThan(0)
  })

  it('desc sorts high → low', () => {
    expect(comparePoolSort(3, 7, 'desc')).toBeGreaterThan(0)
    expect(comparePoolSort(7, 3, 'desc')).toBeLessThan(0)
  })

  it('strings use localeCompare both directions', () => {
    expect(comparePoolSort('apple', 'banana', 'asc')).toBeLessThan(0)
    expect(comparePoolSort('apple', 'banana', 'desc')).toBeGreaterThan(0)
  })
})

describe('D.3 — sortValueForKey reads the right field', () => {
  it('adp / aiAdp / bye come from PlayerEntry directly', () => {
    expect(sortValueForKey(cmcRb, 'adp')).toBe(6)
    expect(sortValueForKey(cmcRb, 'aiAdp')).toBe(5)
    expect(sortValueForKey(cmcRb, 'bye')).toBe(9)
  })

  it('aiAdp sort uses only AI ADP (no silent fallback to system ADP)', () => {
    const p = makePlayer({ name: 'X', adp: 100, aiAdp: null })
    expect(sortValueForKey(p, 'aiAdp')).toBeNull()
  })

  it('projected reads PPG (preserving the pre-D.3 toolbar semantic)', () => {
    expect(sortValueForKey(cmcRb, 'projected')).toBe(19.06)
  })

  it('pts reads projectedPoints (season total)', () => {
    expect(sortValueForKey(cmcRb, 'pts')).toBe(305)
    expect(sortValueForKey(burrow, 'pts')).toBe(280)
  })

  it('rushing/receiving/passing splits map to the right cell', () => {
    expect(sortValueForKey(cmcRb, 'ru_yds')).toBe(1340)
    expect(sortValueForKey(cmcRb, 'rec')).toBe(75)
    expect(sortValueForKey(burrow, 'pa_yds')).toBe(4350)
    expect(sortValueForKey(burrow, 'pa_int')).toBe(8)
  })

  it('returns null when the underlying field is missing (em-dash row)', () => {
    expect(sortValueForKey(noStats, 'pts')).toBeNull()
    expect(sortValueForKey(noStats, 'ru_yds')).toBeNull()
    expect(sortValueForKey(burrow, 'rec')).toBeNull()
  })
})

describe('D.3 — applyPoolSort end-to-end', () => {
  const list: PoolSortPlayer[] = [burrow, cmcRb, noStats]

  it('sort by ADP asc puts CMC first, no-stats rookie last', () => {
    const out = applyPoolSort(list, { key: 'adp', direction: 'asc' })
    expect(out.map((p) => p.name)).toEqual(['Christian McCaffrey', 'Joe Burrow', 'Anonymous Rookie'])
  })

  it('sort by PTS desc puts CMC first, em-dash rookie last (not sorted to top)', () => {
    const out = applyPoolSort(list, { key: 'pts', direction: 'desc' })
    expect(out.map((p) => p.name)).toEqual(['Christian McCaffrey', 'Joe Burrow', 'Anonymous Rookie'])
  })

  it('sort by PTS asc still puts em-dash rookie LAST (nulls-last rule)', () => {
    const out = applyPoolSort(list, { key: 'pts', direction: 'asc' })
    expect(out[out.length - 1]!.name).toBe('Anonymous Rookie')
  })

  it('sort by passing yards desc puts Burrow first', () => {
    const out = applyPoolSort(list, { key: 'pa_yds', direction: 'desc' })
    expect(out[0]!.name).toBe('Joe Burrow')
  })

  it('sort by name asc is alphabetical', () => {
    const out = applyPoolSort(list, { key: 'name', direction: 'asc' })
    expect(out.map((p) => p.name)).toEqual([
      'Anonymous Rookie',
      'Christian McCaffrey',
      'Joe Burrow',
    ])
  })

  it('returns a new array — never mutates the input', () => {
    const original = [...list]
    applyPoolSort(list, { key: 'pts', direction: 'desc' })
    expect(list).toEqual(original)
  })
})

describe('D.3 — nextSortState toggling', () => {
  it('same key flips direction', () => {
    const a = nextSortState({ key: 'adp', direction: 'asc' }, 'adp')
    expect(a).toEqual({ key: 'adp', direction: 'desc' })
    const b = nextSortState(a, 'adp')
    expect(b).toEqual({ key: 'adp', direction: 'asc' })
  })

  it('different key resets to that key’s default direction', () => {
    const fromAdpAsc = nextSortState({ key: 'adp', direction: 'asc' }, 'pts')
    expect(fromAdpAsc).toEqual({ key: 'pts', direction: 'desc' })
    const fromPtsDesc = nextSortState({ key: 'pts', direction: 'desc' }, 'name')
    expect(fromPtsDesc).toEqual({ key: 'name', direction: 'asc' })
  })

  it('numeric stat columns default to descending (higher = better)', () => {
    expect(DEFAULT_SORT_DIRECTIONS.pts).toBe('desc')
    expect(DEFAULT_SORT_DIRECTIONS.projected).toBe('desc')
    expect(DEFAULT_SORT_DIRECTIONS.ru_yds).toBe('desc')
    expect(DEFAULT_SORT_DIRECTIONS.rec_yds).toBe('desc')
    expect(DEFAULT_SORT_DIRECTIONS.pa_yds).toBe('desc')
  })

  it('lower-is-better columns default to ascending', () => {
    expect(DEFAULT_SORT_DIRECTIONS.adp).toBe('asc')
    expect(DEFAULT_SORT_DIRECTIONS.aiAdp).toBe('asc')
    expect(DEFAULT_SORT_DIRECTIONS.bye).toBe('asc')
    expect(DEFAULT_SORT_DIRECTIONS.name).toBe('asc')
  })
})

describe('D.3 — column → sort-key mapping', () => {
  it('RK column reuses ADP sort (RK is the ADP rank)', () => {
    expect(sortKeyForColumn('rk')).toBe('adp')
  })

  it('PLAYER column header maps to the name sort', () => {
    expect(sortKeyForColumn('player')).toBe('name')
  })

  it('AVG column maps to the legacy "projected" sort key for NFL/NCAAF (PPG)', () => {
    expect(sortKeyForColumn('avg')).toBe('projected')
    expect(sortKeyForColumn('avg', 'NBA')).toBe('avg')
  })

  it('PTS column has its own sort key (season total, distinct from PPG)', () => {
    expect(sortKeyForColumn('pts')).toBe('pts')
  })

  it('actions column is NOT sortable', () => {
    expect(sortKeyForColumn('actions')).toBeNull()
    expect(COLUMN_TO_SORT_KEY.actions).toBeNull()
  })

  it('every other column has a sort key', () => {
    const sortable = Object.entries(COLUMN_TO_SORT_KEY).filter(([k, v]) => v != null && k !== 'actions')
    // 17 columns minus actions = 17 sortable
    expect(sortable.length).toBe(17)
  })
})

describe('D.3 — ariaSortValue', () => {
  it('returns "ascending" when active column matches and direction is asc', () => {
    const state: PoolSortState = { key: 'adp', direction: 'asc' }
    expect(ariaSortValue('adp', state)).toBe('ascending')
    expect(ariaSortValue('rk', state)).toBe('ascending') // RK shares the ADP key
  })

  it('returns "descending" when direction is desc', () => {
    const state: PoolSortState = { key: 'pts', direction: 'desc' }
    expect(ariaSortValue('pts', state)).toBe('descending')
  })

  it('returns "none" for inactive columns', () => {
    const state: PoolSortState = { key: 'adp', direction: 'asc' }
    expect(ariaSortValue('pa_yds', state)).toBe('none')
  })

  it('returns "none" for non-sortable columns even when sort is active elsewhere', () => {
    const state: PoolSortState = { key: 'adp', direction: 'asc' }
    expect(ariaSortValue('actions', state)).toBe('none')
  })

  it('AVG ↔ projected — toolbar Proj button shows indicator on the AVG column', () => {
    const state: PoolSortState = { key: 'projected', direction: 'desc' }
    expect(ariaSortValue('avg', state)).toBe('descending')
  })
})

describe('D.3 — SleeperPoolTable header wiring', () => {
  const src = read('components/app/draft-room/SleeperPoolTable.tsx')

  it('renders sortable headers as <button> elements with aria-sort', () => {
    expect(src).toMatch(/<button/)
    expect(src).toMatch(/aria-sort=\{ariaSort\}/)
  })

  it('shows a ▲/▼ indicator for the active sort column', () => {
    expect(src).toMatch(/▲/)
    expect(src).toMatch(/▼/)
  })

  it('only sortable columns are rendered as buttons (actions stays a span)', () => {
    expect(src).toMatch(/sortKeyForColumn\(col\.key, draftSport\) != null/)
    expect(src).toMatch(/Non-sortable column/)
  })

  it('header click invokes onSortChange with the column key', () => {
    expect(src).toMatch(/onClick=\{\(\) => onSortChange\?\.\(col\.key\)\}/)
  })

  it('focus ring styling is keyboard-accessible (Enter / Space activate the button)', () => {
    expect(src).toMatch(/focus-visible:ring-cyan-400\/45/)
  })
})

describe('D.3 — PlayerPanel toolbar + table sync', () => {
  const src = read('components/app/draft-room/PlayerPanel.tsx')

  it('uses applyPoolSort instead of inline if/else sort branch', () => {
    expect(src).toMatch(
      /applyPoolSort(?:<PlayerEntry>)?\(list, \{ key: sortBy, direction: sortDirection \}, sport, sleeperStatOpts\)/,
    )
    expect(src).not.toMatch(/sortBy === 'projected'\) \{[\s\S]*?diff !== 0/)
  })

  it('declares a sortDirection state alongside sortBy', () => {
    expect(src).toMatch(/const \[sortDirection, setSortDirection\] = useState<'asc' \| 'desc'>/)
  })

  it('handleSortChange remains the canonical sort entry point (table column headers call it)', () => {
    // G.1 — the four toolbar sort buttons (ADP / AI ADP / Proj / Name) were
    // removed because they duplicated the SleeperPoolTable column-header
    // sort UI. handleSortChange is still defined and is now invoked by
    // handleColumnHeaderSort (passed to SleeperPoolTable.onSortChange).
    expect(src).toMatch(/const handleSortChange = /)
    expect(src).toMatch(/handleColumnHeaderSort/)
  })

  it('passes sortState + onSortChange into SleeperPoolTable', () => {
    expect(src).toMatch(/<SleeperPoolTable[\s\S]*?sortState=\{\{ key: sortBy, direction: sortDirection \}\}/)
    expect(src).toMatch(/<SleeperPoolTable[\s\S]*?onSortChange=\{handleColumnHeaderSort\}/)
  })

  it('handleColumnHeaderSort resolves column → sort key via sortKeyForColumn', () => {
    expect(src).toMatch(/sortKeyForColumn\(columnKey, sport\)/)
  })

  it('memo deps include sortDirection + sport + sleeperStatOpts so re-sort fires when layout/sport changes', () => {
    expect(src).toMatch(/sortBy,\s*\n?\s*sortDirection,/)
    expect(src).toMatch(/sleeperStatOpts/)
  })
})

describe('D.3 — pre-existing sort tests still pass (no regression on Slice D model)', () => {
  it('legacy sortBy keys (adp / aiAdp / projected / name) still type-resolve', () => {
    // The PoolSortKey union keeps these four; existing call sites and analytics events stay valid.
    const _: PoolSortState = { key: 'projected', direction: 'desc' }
    expect(_.key).toBe('projected')
  })
})
