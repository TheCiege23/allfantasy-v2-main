/**
 * D.7 — Player pool visual polish (Commit 22)
 *
 * Source-level invariants locking the visual improvements made to the
 * Sleeper-style draft pool table and PlayerPanel controls. No rendering,
 * no DB, no network. All assertions use readFileSync + regex or real
 * constant imports.
 *
 * Goals locked here:
 *   1. PositionChip renders sport-position-aware color badges in table rows.
 *   2. ADP delta badge surfaces the p.adp vs p.aiAdp difference (existing data).
 *   3. Null/missing stat cells use a dimmer color class for clear "no data" cues.
 *   4. Rows leave room for readable player names and controls.
 *   5. Search control and position filter are preserved (no regression).
 *   6. Draft/queue/select handler wiring is preserved in PlayerPanel.
 *   7. No legacy draft endpoints introduced.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  SLEEPER_POOL_TABLE_ROW_HEIGHT,
  SLEEPER_POOL_TABLE_HEADER_HEIGHT,
} from '@/components/app/draft-room/SleeperPoolTable.constants'

const root = resolve(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

const tableSrc = read('components/app/draft-room/SleeperPoolTable.tsx')
const panelSrc = read('components/app/draft-room/PlayerPanel.tsx')

// ---------------------------------------------------------------------------
// 1. PositionChip — sport-position-aware color badges
// ---------------------------------------------------------------------------

describe('PositionChip — position-aware color badges (Commit 22)', () => {
  it('PositionChip function is defined in SleeperPoolTable', () => {
    expect(tableSrc).toMatch(/function PositionChip/)
  })

  it('fills with the board position colour (positionTintHex), so pool and board agree', () => {
    expect(tableSrc).toMatch(/import \{ positionTintHex \} from '@\/lib\/draft-room\/positionTint'/)
    expect(tableSrc).toMatch(/const tint = positionTintHex\(p, sport\)/)
    expect(tableSrc).toMatch(/backgroundColor: tint/)
  })

  it('<PositionChip> is rendered inside the player column case', () => {
    expect(tableSrc).toMatch(/<PositionChip\s+pos=/)
  })

  it('PositionChip passes pos through as a title attr for accessibility', () => {
    expect(tableSrc).toMatch(/title=\{pos \?\? undefined\}/)
  })
})

// ---------------------------------------------------------------------------
// 2. ADP delta badge — surfaces existing p.adp / p.aiAdp data
// ---------------------------------------------------------------------------

describe('ADP column shows one number (2026-11-16)', () => {
  // The unlabelled +3/−2 gap to the AF ADP column printed beside it was removed: users could
  // not tell what it meant, and it repeated a number already on the row.
  it('no longer renders an adp-delta badge in the pool', () => {
    expect(tableSrc).not.toMatch(/data-testid=\{`\$\{testIdBase\}-adp-delta`\}/)
    expect(tableSrc).toMatch(/data-testid=\{`\$\{testIdBase\}-adp`\}/)
  })
})


describe('null stat cells — dimmed for "no data" clarity (Commit 22)', () => {
  // /50, not /30: still dimmer than a real value (/85), but /30 measured 2.68:1 on the pool surface
  // and /50 holds 4.5:1 there and on the hover and selected row fills (2026-11-25).
  it("em-dash values get text-white/50 class in the default stat branch", () => {
    expect(tableSrc).toMatch(/display === '—'[\s\S]{0,40}text-white\/50/)
  })

  it('className is only applied conditionally — actual values stay unstyled', () => {
    expect(tableSrc).toMatch(/display === '—' \? 'text-white\/50' : undefined/)
  })
})

// ---------------------------------------------------------------------------
// 4. Table row density
// ---------------------------------------------------------------------------

describe('SleeperPoolTable readable row density', () => {
  it('leaves room for usable controls without making each row a large card', () => {
    expect(SLEEPER_POOL_TABLE_ROW_HEIGHT).toBeGreaterThanOrEqual(44)
    expect(SLEEPER_POOL_TABLE_ROW_HEIGHT).toBeLessThanOrEqual(72)
  })

  it('ROW_HEIGHT is still > 0 (sanity)', () => {
    expect(SLEEPER_POOL_TABLE_ROW_HEIGHT).toBeGreaterThan(0)
  })

  it('HEADER_HEIGHT is still > 0 (sanity)', () => {
    expect(SLEEPER_POOL_TABLE_HEADER_HEIGHT).toBeGreaterThan(0)
  })

  it('ROW_HEIGHT is under 80 (Sleeper-style density requirement from D.2)', () => {
    expect(SLEEPER_POOL_TABLE_ROW_HEIGHT).toBeLessThan(80)
  })
})

// ---------------------------------------------------------------------------
// 5. Search control and position filter — no regression
// ---------------------------------------------------------------------------

describe('PlayerPanel — search and position filter preserved (Commit 22)', () => {
  it('search input still carries data-testid="draft-player-search-input"', () => {
    expect(panelSrc).toMatch(/data-testid="draft-player-search-input"/)
  })

  it('search input still has aria-label="Search players"', () => {
    expect(panelSrc).toMatch(/aria-label="Search players"/)
  })

  it('position filter radiogroup still carries data-testid="draft-position-filter"', () => {
    expect(panelSrc).toMatch(/data-testid="draft-position-filter"/)
  })

  it('position pills still render drafted/available counts', () => {
    expect(panelSrc).toMatch(/opt\.drafted.*opt\.available|opt\.available.*opt\.drafted/)
  })

  it('position pills still carry data-testid for e2e selectors', () => {
    expect(panelSrc).toMatch(/data-testid=\{`draft-position-pill-/)
  })

  it('hide-drafted toggle still present', () => {
    expect(panelSrc).toMatch(/data-testid="draft-filter-hide-drafted"/)
  })

  it('clear-filters button still present', () => {
    expect(panelSrc).toMatch(/data-testid="draft-clear-filters"/)
  })
})

// ---------------------------------------------------------------------------
// 6. Pick/queue/select handler wiring — no regression
// ---------------------------------------------------------------------------

describe('PlayerPanel — pick/queue/select handlers preserved (Commit 22)', () => {
  it('onMakePick is passed as onDraftRequest to SleeperPoolTable', () => {
    expect(panelSrc).toMatch(/onDraftRequest=\{onMakePick\}/)
  })

  it('onAddToQueue is passed through to SleeperPoolTable', () => {
    expect(panelSrc).toMatch(/<SleeperPoolTable[\s\S]*?onAddToQueue=\{onAddToQueue\}/)
  })

  it('onPlayerSelect=setSelectedPlayer is wired to SleeperPoolTable', () => {
    expect(panelSrc).toMatch(/onPlayerSelect=\{setSelectedPlayer\}/)
  })

  it('isPlayerDrafted uses isPlayerDraftedEntry (id-first, name fallback)', () => {
    expect(panelSrc).toMatch(/isPlayerDraftedEntry/)
  })

  it('draftedNames and isPlayerDrafted are both threaded into SleeperPoolTable', () => {
    expect(panelSrc).toMatch(/<SleeperPoolTable[\s\S]*?draftedNames=\{draftedNames\}/)
    expect(panelSrc).toMatch(/<SleeperPoolTable[\s\S]*?isPlayerDrafted=/)
  })
})

// ---------------------------------------------------------------------------
// 7. No legacy draft endpoints
// ---------------------------------------------------------------------------

describe('SleeperPoolTable — no legacy draft endpoints (Commit 22)', () => {
  it('does not reference /api/draft/pick (legacy route)', () => {
    expect(tableSrc).not.toMatch(/['"`]\/api\/draft\/pick['"`]/)
  })

  it('does not reference /api/draft/room (legacy route)', () => {
    expect(tableSrc).not.toMatch(/\/api\/draft\/room/)
  })

  it('does not reference DraftRoomStateRow or DraftRoomPickRecord', () => {
    expect(tableSrc).not.toMatch(/DraftRoomStateRow|DraftRoomPickRecord/)
  })

  it('does not reference DraftRoomUserQueue', () => {
    expect(tableSrc).not.toMatch(/DraftRoomUserQueue/)
  })
})
