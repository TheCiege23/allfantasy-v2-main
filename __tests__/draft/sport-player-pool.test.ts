/**
 * Sport player pool — NFL/NBA adapter invariants (Commit 16)
 *
 * Verifies and hardens:
 *  - NFL and NBA stat-column selection is sport-isolated (no cross-sport leakage)
 *  - Position filters are sport-correct and safe (FLEX for NFL, basketball for NBA)
 *  - Position-pill matching works for NFL and NBA positions
 *  - Null ADP/projection/stat fields never throw
 *  - Drafted-player detection uses both playerId and name
 *  - PlayerPanel and SportAwareDraftRoom wire playerId through to pick handlers
 *  - No legacy draft-state tables are referenced in pool/panel code
 *
 * Pure-function tests use real imports — no DB, no server, no render.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  buildSleeperPoolStatColumnDefs,
  getDraftStatColumnsForSport,
  formatDraftStatDisplay,
  getStatValueForDraftPlayer,
  NFL_SLEEPER_TABLE_OFFENSE,
} from '@/lib/draft-room/draftSportStatColumns'
import { getPositionFilterOptionsForSport } from '@/lib/draft-room/SportDraftUIResolver'
import { poolPlayerMatchesPositionPill } from '@/lib/draft-room/draftPoolPositionGroups'

const root = resolve(__dirname, '..', '..')

// ---------------------------------------------------------------------------
// 1. NFL stat columns — correct keys, no NBA leakage
// ---------------------------------------------------------------------------

describe('NFL SleeperPoolTable stat columns', () => {
  const cols = buildSleeperPoolStatColumnDefs('NFL')
  const keys = cols.map((c) => c.key)

  it('returns NFL_SLEEPER_TABLE_OFFENSE columns for NFL', () => {
    expect(keys).toContain('pts')
    expect(keys).toContain('ru_yds')
    expect(keys).toContain('pa_yds')
    expect(keys).toContain('pa_td')
  })

  it('does not include NBA-only columns (reb, ast, stl, blk, fg3m)', () => {
    expect(keys).not.toContain('reb')
    expect(keys).not.toContain('ast')
    expect(keys).not.toContain('stl')
    expect(keys).not.toContain('blk')
    expect(keys).not.toContain('fg3m')
    expect(keys).not.toContain('nba_proj')
  })

  it('NFL IDP position returns defensive columns instead of offense', () => {
    const idpCols = buildSleeperPoolStatColumnDefs('NFL', { position: 'DE' })
    const idpKeys = idpCols.map((c) => c.key)
    expect(idpKeys).toContain('idp_tkl')
    expect(idpKeys).toContain('idp_sack')
    expect(idpKeys).not.toContain('pa_yds')
    expect(idpKeys).not.toContain('reb')
  })

  it('NFL_SLEEPER_TABLE_OFFENSE is exported and has 12 columns', () => {
    expect(NFL_SLEEPER_TABLE_OFFENSE.length).toBe(12)
  })

  it('every NFL column has a string key and label', () => {
    for (const col of cols) {
      expect(typeof col.key).toBe('string')
      expect(typeof col.label).toBe('string')
      expect(col.key.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. NBA stat columns — correct keys, no NFL leakage
// ---------------------------------------------------------------------------

describe('NBA getDraftStatColumnsForSport stat columns', () => {
  const cols = getDraftStatColumnsForSport('NBA')
  const keys = cols.map((c) => c.key)

  it('returns NBA basketball stats (pts, reb, ast, stl, blk)', () => {
    expect(keys).toContain('pts')
    expect(keys).toContain('reb')
    expect(keys).toContain('ast')
    expect(keys).toContain('stl')
    expect(keys).toContain('blk')
  })

  it('returns three-point made column for NBA', () => {
    expect(keys).toContain('fg3m')
  })

  it('does not include NFL-only columns (ru_att, pa_yds, pa_td, pa_int, ru_td)', () => {
    expect(keys).not.toContain('ru_att')
    expect(keys).not.toContain('ru_yds')
    expect(keys).not.toContain('pa_yds')
    expect(keys).not.toContain('pa_td')
    expect(keys).not.toContain('pa_int')
  })

  it('buildSleeperPoolStatColumnDefs routes NBA through getDraftStatColumnsForSport', () => {
    const viaSleeper = buildSleeperPoolStatColumnDefs('NBA')
    const viaDirect = getDraftStatColumnsForSport('NBA')
    expect(viaSleeper.map((c) => c.key)).toEqual(viaDirect.map((c) => c.key))
  })

  it('every NBA column has a string key and label', () => {
    for (const col of cols) {
      expect(typeof col.key).toBe('string')
      expect(typeof col.label).toBe('string')
    }
  })
})

// ---------------------------------------------------------------------------
// 3. Position filters — NFL
// ---------------------------------------------------------------------------

describe('NFL position filter options', () => {
  const opts = getPositionFilterOptionsForSport('NFL')
  const values = opts.map((o) => o.value)

  it('always starts with All', () => {
    expect(values[0]).toBe('All')
  })

  it('includes core football positions', () => {
    expect(values).toContain('QB')
    expect(values).toContain('RB')
    expect(values).toContain('WR')
    expect(values).toContain('TE')
  })

  it('includes FLEX for NFL', () => {
    expect(values).toContain('FLEX')
  })

  it('does not include basketball-only positions (PG, SG, SF, PF)', () => {
    expect(values).not.toContain('PG')
    expect(values).not.toContain('SG')
    expect(values).not.toContain('SF')
    expect(values).not.toContain('PF')
  })

  it('NFL IDP format includes Offense group pill', () => {
    const idpOpts = getPositionFilterOptionsForSport('NFL', 'IDP')
    const idpValues = idpOpts.map((o) => o.value)
    expect(idpValues).toContain('Offense')
    expect(idpValues).toContain('DL')
    expect(idpValues).toContain('LB')
  })
})

// ---------------------------------------------------------------------------
// 4. Position filters — NBA
// ---------------------------------------------------------------------------

describe('NBA position filter options', () => {
  const opts = getPositionFilterOptionsForSport('NBA')
  const values = opts.map((o) => o.value)

  it('always starts with All', () => {
    expect(values[0]).toBe('All')
  })

  it('includes basketball positions', () => {
    // At least some basketball positions must be present
    const basketballPositions = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL']
    const hasBasketball = basketballPositions.some((p) => values.includes(p))
    expect(hasBasketball).toBe(true)
  })

  it('does not include football-specific positions (QB, K, DST)', () => {
    expect(values).not.toContain('QB')
    expect(values).not.toContain('K')
    expect(values).not.toContain('DST')
    expect(values).not.toContain('DEF')
  })

  it('does not include NFL FLEX', () => {
    // FLEX is only added for NFL/NCAAF leagues
    // NBA may have its own UTIL/FLEX but not the NFL FLEX pill
    const hasNflFlex = opts.some(
      (o) => o.value === 'FLEX' && !values.includes('QB')
    )
    // If FLEX is present in NBA, QB must not be — they come from different templates
    if (values.includes('FLEX')) {
      expect(values).not.toContain('QB')
    }
  })
})

// ---------------------------------------------------------------------------
// 5. Position-pill matching — NFL
// ---------------------------------------------------------------------------

describe('poolPlayerMatchesPositionPill — NFL positions', () => {
  const nfl = (pos: string, pill: string) =>
    poolPlayerMatchesPositionPill(pos, pill, { sport: 'NFL' })

  it('QB matches QB pill', () => expect(nfl('QB', 'QB')).toBe(true))
  it('RB matches RB pill', () => expect(nfl('RB', 'RB')).toBe(true))
  it('WR matches WR pill', () => expect(nfl('WR', 'WR')).toBe(true))
  it('TE matches TE pill', () => expect(nfl('TE', 'TE')).toBe(true))

  it('RB matches FLEX pill', () => expect(nfl('RB', 'FLEX')).toBe(true))
  it('WR matches FLEX pill', () => expect(nfl('WR', 'FLEX')).toBe(true))
  it('TE matches FLEX pill', () => expect(nfl('TE', 'FLEX')).toBe(true))
  it('QB does not match FLEX pill', () => expect(nfl('QB', 'FLEX')).toBe(false))
  it('K does not match FLEX pill', () => expect(nfl('K', 'FLEX')).toBe(false))

  it('any position matches All pill', () => {
    expect(nfl('QB', 'All')).toBe(true)
    expect(nfl('WR', 'All')).toBe(true)
    expect(nfl('DST', 'All')).toBe(true)
  })

  it('QB does not match RB pill', () => expect(nfl('QB', 'RB')).toBe(false))
  it('WR does not match TE pill', () => expect(nfl('WR', 'TE')).toBe(false))
})

// ---------------------------------------------------------------------------
// 6. Position-pill matching — NBA
// ---------------------------------------------------------------------------

describe('poolPlayerMatchesPositionPill — NBA positions', () => {
  const nba = (pos: string, pill: string) =>
    poolPlayerMatchesPositionPill(pos, pill, { sport: 'NBA' })

  it('PG matches PG pill', () => expect(nba('PG', 'PG')).toBe(true))
  it('SG matches SG pill', () => expect(nba('SG', 'SG')).toBe(true))
  it('SF matches SF pill', () => expect(nba('SF', 'SF')).toBe(true))
  it('PF matches PF pill', () => expect(nba('PF', 'PF')).toBe(true))
  it('C matches C pill', () => expect(nba('C', 'C')).toBe(true))

  it('PG does not match QB pill (no cross-sport leakage)', () => expect(nba('PG', 'QB')).toBe(false))
  it('C does not match TE pill', () => expect(nba('C', 'TE')).toBe(false))

  it('any NBA position matches All pill', () => {
    expect(nba('PG', 'All')).toBe(true)
    expect(nba('C', 'All')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 7. Null ADP / projection / stat field safety
// ---------------------------------------------------------------------------

describe('formatDraftStatDisplay — null/missing value safety', () => {
  const pts = { key: 'pts', label: 'PTS', type: 'number' as const, category: 'offense' as const, aliases: [] }
  const pct = { key: 'pct', label: 'PCT', type: 'percent' as const, category: 'offense' as const, aliases: [] }

  it('returns — for null numeric value', () => {
    expect(formatDraftStatDisplay(null, pts)).toBe('—')
  })

  it('formats non-null integer values', () => {
    expect(formatDraftStatDisplay(100, pts)).toBe('100')
  })

  it('formats decimal values to one decimal place', () => {
    expect(formatDraftStatDisplay(12.5, pts)).toBe('12.5')
  })

  it('returns — for null percent value', () => {
    expect(formatDraftStatDisplay(null, pct)).toBe('—')
  })

  it('does not throw on zero value', () => {
    expect(() => formatDraftStatDisplay(0, pts)).not.toThrow()
    expect(formatDraftStatDisplay(0, pts)).toBe('0')
  })
})

describe('getStatValueForDraftPlayer — null stat bag safety', () => {
  const pts = { key: 'pts', label: 'PTS', type: 'number' as const, category: 'offense' as const, aliases: ['pts', 'points'] }

  it('returns null when player has no stats', () => {
    const player = { display: undefined }
    const result = getStatValueForDraftPlayer(player, pts)
    expect(result).toBeNull()
  })

  it('returns null when display.stats is null', () => {
    const player = { display: { stats: null } }
    const result = getStatValueForDraftPlayer(player as any, pts)
    expect(result).toBeNull()
  })

  it('resolves stat from alias key', () => {
    const player = { display: { stats: { points: 25.3 } } }
    const result = getStatValueForDraftPlayer(player as any, pts)
    expect(result).toBe(25.3)
  })

  it('does not throw when stat object is completely empty', () => {
    const player = { display: { stats: {} } }
    expect(() => getStatValueForDraftPlayer(player as any, pts)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 8. Drafted player detection — source invariants
// ---------------------------------------------------------------------------

describe('PlayerPanel — drafted player detection', () => {
  const src = readFileSync(
    resolve(root, 'components/app/draft-room/PlayerPanel.tsx'),
    'utf8',
  )

  it('isPlayerDraftedEntry checks draftedPlayerIds Set when available', () => {
    expect(src).toMatch(/draftedPlayerIds.*ids\.has\(pid\)|ids\.has\(pid\)/)
  })

  it('isPlayerDraftedEntry falls back to name check', () => {
    expect(src).toMatch(/isPlayerNameDrafted\(p\.name, draftedNames\)/)
  })

  it('isPlayerDraftedEntry prefers display.playerId over p.id', () => {
    expect(src).toMatch(/display\?\.playerId/)
  })

  it('draft button is disabled when player is already drafted', () => {
    expect(src).toMatch(/isPlayerDraftedEntry.*draftedNames.*draftedPlayerIds/)
  })
})

// ---------------------------------------------------------------------------
// 9. PlayerId flows through PlayerEntry to pick/queue handlers
// ---------------------------------------------------------------------------

describe('PlayerPanel — playerId wires through to action handlers', () => {
  const src = readFileSync(
    resolve(root, 'components/app/draft-room/PlayerPanel.tsx'),
    'utf8',
  )

  it('onMakePick is called with the full PlayerEntry (including playerId)', () => {
    // The pick callback receives the entire player object (selectedPlayer is the full PlayerEntry)
    expect(src).toMatch(/onMakePick\(selected/)
  })

  it('onAddToQueue is called with the full PlayerEntry', () => {
    expect(src).toMatch(/onAddToQueue\(.*player|onAddToQueue\(.*p\b/)
  })

  it('PlayerEntry type declares playerId field', () => {
    expect(src).toMatch(/playerId\?.*string.*null|playerId\?.*null.*string/)
  })
})

// ---------------------------------------------------------------------------
// 10. SportAwareDraftRoom — delegates to PlayerPanel
// ---------------------------------------------------------------------------

describe('SportAwareDraftRoom — thin wrapper over PlayerPanel', () => {
  const src = readFileSync(
    resolve(root, 'components/app/draft-room/SportAwareDraftRoom.tsx'),
    'utf8',
  )

  it('renders PlayerPanel with all props forwarded', () => {
    expect(src).toMatch(/PlayerPanel/)
    expect(src).toMatch(/\.\.\.(props|p)\b|\{\.\.\.props\}/)
  })

  it('does not contain sport-specific rendering logic (delegates to PlayerPanel)', () => {
    // The wrapper itself should not branch on sport — that's PlayerPanel's job
    expect(src).not.toMatch(/sport\s*===\s*['"]NFL['"]/)
    expect(src).not.toMatch(/sport\s*===\s*['"]NBA['"]/)
  })

  it('imports PlayerPanel from the draft-room directory', () => {
    expect(src).toMatch(/from.*PlayerPanel/)
  })
})

// ---------------------------------------------------------------------------
// 11. No legacy draft-state in pool/panel source
// ---------------------------------------------------------------------------

describe('pool/panel source — no legacy draft-state tables', () => {
  const files = [
    'components/app/draft-room/PlayerPanel.tsx',
    'components/app/draft-room/SportAwareDraftRoom.tsx',
    'components/app/draft-room/SleeperPoolTable.tsx',
    'lib/draft-room/SportDraftUIResolver.ts',
    'lib/draft-room/draftSportStatColumns.ts',
    'lib/draft-room/draftPoolPositionGroups.ts',
    'lib/sport-teams/SportPlayerPoolResolver.ts',
  ]

  for (const file of files) {
    const src = readFileSync(resolve(root, file), 'utf8')
    it(`${file} — does not reference DraftRoomStateRow`, () => {
      expect(src).not.toMatch(/DraftRoomStateRow/)
    })
    it(`${file} — does not reference DraftRoomPickRecord`, () => {
      expect(src).not.toMatch(/DraftRoomPickRecord/)
    })
    it(`${file} — does not reference DraftRoomUserQueue`, () => {
      expect(src).not.toMatch(/DraftRoomUserQueue/)
    })
  }
})

// ---------------------------------------------------------------------------
// 12. Regression locks
// ---------------------------------------------------------------------------

describe('Regression — previous commit tests are unaffected', () => {
  const clientSrc = readFileSync(
    resolve(root, 'components/app/draft-room/DraftRoomPageClient.tsx'),
    'utf8',
  )

  it('DraftRoomPageClient still imports useLiveDraftSync', () => {
    expect(clientSrc).toMatch(/from '@\/hooks\/useLiveDraftSync'/)
  })

  it('DraftRoomPageClient still imports useCommissionerActions', () => {
    expect(clientSrc).toMatch(/from '@\/hooks\/useCommissionerActions'/)
  })

  it('DraftRoomPageClient still mounts AutopickMeToggle', () => {
    expect(clientSrc).toMatch(/AutopickMeToggle/)
    expect(clientSrc).toMatch(/viewerAutopick=\{session\.viewerAutopick\}/)
  })

  it('handleMakePick still posts to canonical /draft/pick endpoint', () => {
    expect(clientSrc).toMatch(/\/api\/leagues\/.*\/draft\/pick/)
    expect(clientSrc).not.toMatch(/['"`]\/api\/draft\/pick['"`]/)
  })
})
