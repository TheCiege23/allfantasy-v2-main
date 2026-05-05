import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  SLEEPER_POOL_TABLE_COLUMNS,
  SLEEPER_POOL_TABLE_HEADER_HEIGHT,
  SLEEPER_POOL_TABLE_MIN_WIDTH,
  SLEEPER_POOL_TABLE_ROW_HEIGHT,
} from '@/components/app/draft-room/SleeperPoolTable.constants'

/**
 * D.2 — Sleeper-style draft-pool table. Static-source assertions plus column-spec
 * checks. (Render-level tests use @testing-library/react in this repo only when
 * Vitest's oxc transform accepts the JSX. The pool table internals — virtualizer,
 * PlayerAvatar wiring — are exercised end-to-end through the dev server smoke.)
 */

const root = resolve(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('D.2 — SLEEPER_POOL_TABLE_COLUMNS spec', () => {
  it('declares the 18 columns the user requested (RK, PLAYER, ADP, AI ADP, BYE, PTS, AVG, …)', () => {
    const labels = SLEEPER_POOL_TABLE_COLUMNS.map((c) => c.label)
    expect(labels).toEqual([
      'RK',
      'PLAYER',
      'ADP',
      'AI ADP',
      'BYE',
      'PTS',
      'AVG',
      'RU ATT',
      'RU YDS',
      'RU TD',
      'REC',
      'REC YDS',
      'REC TD',
      'PA ATT',
      'PA YDS',
      'PA TD',
      'PA INT',
      '', // actions
    ])
  })

  it('player column is left-aligned; every numeric stat column is right-aligned', () => {
    const playerCol = SLEEPER_POOL_TABLE_COLUMNS.find((c) => c.key === 'player')!
    expect(playerCol.align).toBe('left')
    const rightCols = SLEEPER_POOL_TABLE_COLUMNS.filter((c) => c.key !== 'player')
    for (const c of rightCols) expect(c.align).toBe('right')
  })

  it('column widths sum to roughly the declared min-width (so headers + cells align)', () => {
    const sum = SLEEPER_POOL_TABLE_COLUMNS.reduce((s, c) => s + c.width, 0)
    expect(sum).toBe(SLEEPER_POOL_TABLE_MIN_WIDTH)
  })

  it('exposes header + row heights for parent layout to size around', () => {
    expect(SLEEPER_POOL_TABLE_ROW_HEIGHT).toBeGreaterThan(0)
    expect(SLEEPER_POOL_TABLE_HEADER_HEIGHT).toBeGreaterThan(0)
    // Sleeper-style is dense — keep rows under 80px.
    expect(SLEEPER_POOL_TABLE_ROW_HEIGHT).toBeLessThan(80)
  })

  it('includes ADP, AI ADP, and projection columns (the data E.2.7 unlocked)', () => {
    const keys = SLEEPER_POOL_TABLE_COLUMNS.map((c) => c.key)
    for (const k of ['adp', 'aiAdp', 'pts', 'avg']) {
      expect(keys).toContain(k)
    }
  })

  it('includes rushing, receiving, and passing stat columns', () => {
    const keys = SLEEPER_POOL_TABLE_COLUMNS.map((c) => c.key)
    expect(keys).toEqual(expect.arrayContaining(['ru_att', 'ru_yds', 'ru_td']))
    expect(keys).toEqual(expect.arrayContaining(['rec', 'rec_yds', 'rec_td']))
    expect(keys).toEqual(expect.arrayContaining(['pa_att', 'pa_yds', 'pa_td', 'pa_int']))
  })
})

describe('D.2 — SleeperPoolTable component wiring', () => {
  const src = read('components/app/draft-room/SleeperPoolTable.tsx')

  it('renders a sticky header row aligned to the sport-aware layout spec', () => {
    expect(src).toMatch(/sticky top-0/)
    expect(src).toMatch(/data-testid="sleeper-pool-table-header"/)
    expect(src).toMatch(/layout\.columns\.map/)
    expect(src).toMatch(/buildSleeperPoolTableLayout/)
  })

  it('uses the shared PlayerAvatar (E.1) for the player image — not raw <img>', () => {
    expect(src).toMatch(/import \{ PlayerAvatar \}/)
    expect(src).toMatch(/<PlayerAvatar/)
    // No bare <img> tags — every avatar must go through the classifier.
    expect(src).not.toMatch(/<img\s/)
  })

  it('still references nflDraftProjectionSplits for NFL tooltip hints on PTS/AVG-style cells', () => {
    expect(src).toMatch(/p\.nflDraftProjectionSplits/)
    expect(src).toMatch(/splits\.projectedPoints/)
    expect(src).toMatch(/splits\.projectedPointsPerGame/)
  })

  it('renders stat cells via formatDraftStatDisplay (em-dash for missing)', () => {
    expect(src).toMatch(/formatDraftStatDisplay/)
    expect(src).toMatch(/getStatValueForDraftPlayer/)
  })

  it('Draft button is disabled when not on the clock or when player is drafted', () => {
    expect(src).toMatch(/disabled=\{!canDraft \|\| drafted\}/)
    expect(src).toMatch(/'Player already drafted'/)
    expect(src).toMatch(/'Not your turn'/)
  })

  it('Queue button is disabled for drafted players but available otherwise', () => {
    expect(src).toMatch(/disabled=\{drafted\}/)
    expect(src).toMatch(/data-testid=\{`\$\{testIdBase\}-queue`\}/)
  })

  it('row click invokes onPlayerSelect (opens PlayerDetailModal in PlayerPanel)', () => {
    expect(src).toMatch(/onClick=\{\(\) => \{[\s\S]*?onSelect\(\)/)
    expect(src).toMatch(/onPlayerSelect: \(player: PlayerEntry\) => void/)
  })

  it('action buttons stop propagation so they do not also fire row select', () => {
    // Compare / queue / draft each call e.stopPropagation() before invoking the callback.
    const stopMatches = src.match(/e\.stopPropagation\(\)/g) ?? []
    expect(stopMatches.length).toBeGreaterThanOrEqual(3)
  })

  it('rows tag drafted players with a Drafted badge + data-drafted attribute', () => {
    expect(src).toMatch(/data-drafted=\{drafted \? 'true' : 'false'\}/)
    expect(src).toMatch(/Drafted/)
  })

  it('memoizes the row component to skip re-renders when the timer ticks', () => {
    expect(src).toMatch(/React\.memo\(SleeperRow\)/)
  })

  it('virtualizes the body via @tanstack/react-virtual', () => {
    expect(src).toMatch(/from '@tanstack\/react-virtual'/)
    expect(src).toMatch(/useVirtualizer/)
  })

  it('supports an explicit nominate action (auction format) without breaking redraft', () => {
    expect(src).toMatch(/canNominate/)
    expect(src).toMatch(/onNominateRequest/)
    expect(src).toMatch(/Nominate/)
  })
})

describe('D.2 — PlayerPanel poolLayout integration', () => {
  const src = read('components/app/draft-room/PlayerPanel.tsx')

  it('imports SleeperPoolTable so the new layout can be used', () => {
    expect(src).toMatch(/import \{ SleeperPoolTable \}/)
  })

  it('exposes a `poolLayout` prop with auto / card / sleeper_table options', () => {
    expect(src).toMatch(/poolLayout\?: 'auto' \| 'card' \| 'sleeper_table'/)
  })

  it('defaults to the table for NFL when poolLayout is auto', () => {
    expect(src).toMatch(/poolLayout === 'auto' && sport === 'NFL'/)
  })

  it('always uses the table when poolLayout === sleeper_table (explicit opt-in)', () => {
    expect(src).toMatch(/poolLayout === 'sleeper_table'/)
  })

  it('keeps the existing card layout (DraftPlayerCard via PlayerListVirtualized) for non-NFL', () => {
    // When useTable is false we fall back to the original PlayerListVirtualized.
    expect(src).toMatch(/<PlayerListVirtualized/)
    expect(src).toMatch(/return \(\s*<PlayerListVirtualized/)
  })

  it('wraps the table in an overflow-x-auto container so narrow viewports scroll horizontally', () => {
    expect(src).toMatch(/data-testid="sleeper-pool-table-scroll"/)
    expect(src).toMatch(/overflow-x-auto/)
  })

  it('passes the same draft / queue / select handlers to SleeperPoolTable as the card layout', () => {
    expect(src).toMatch(/<SleeperPoolTable[\s\S]*?onDraftRequest=\{onMakePick\}/)
    expect(src).toMatch(/<SleeperPoolTable[\s\S]*?onAddToQueue=\{onAddToQueue\}/)
    expect(src).toMatch(/<SleeperPoolTable[\s\S]*?onPlayerSelect=\{setSelectedPlayer\}/)
    expect(src).toMatch(/<SleeperPoolTable[\s\S]*?onCompareTap=\{onCompareTap\}/)
  })

  it('threads draftedNames + draftedPlayerIds into SleeperPoolTable so hide/show drafted still works', () => {
    expect(src).toMatch(/<SleeperPoolTable[\s\S]*?draftedNames=\{draftedNames\}/)
    expect(src).toMatch(/<SleeperPoolTable[\s\S]*?isPlayerDrafted=/)
  })

  it('preserves existing search/sort/filter state — does not strip the user controls', () => {
    expect(src).toMatch(/searchQuery/)
    expect(src).toMatch(/positionFilter/)
    expect(src).toMatch(/sortBy/)
    expect(src).toMatch(/hideDrafted/)
  })
})

describe('D.2 — existing DraftPlayerCard consumers still compile (no API changes)', () => {
  it('DraftPlayerCard still exports same callable shape', () => {
    const card = read('components/app/draft-room/DraftPlayerCard.tsx')
    expect(card).toMatch(/export const DraftPlayerCard = React\.memo/)
    expect(card).toMatch(/variant\?: 'row' \| 'card'/)
  })

  it('CommissionerPickEditorPanel still imports DraftPlayerCard (not the new table)', () => {
    const panel = read('components/app/draft-room/CommissionerPickEditorPanel.tsx')
    // Don't break the commissioner panel or PlayerDetailModal; they keep cards.
    expect(panel).not.toMatch(/SleeperPoolTable/)
  })
})
