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
 *   4. Table row density is tighter (ROW_HEIGHT ≤ 32).
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

  it('QB uses rose color (red-spectrum for quarterback)', () => {
    expect(tableSrc).toMatch(/QB[\s\S]{0,40}rose/)
  })

  it('RB uses emerald color (green-spectrum for running back)', () => {
    expect(tableSrc).toMatch(/RB[\s\S]{0,40}emerald/)
  })

  it('WR uses cyan color (blue-spectrum for wide receiver)', () => {
    expect(tableSrc).toMatch(/WR[\s\S]{0,40}cyan/)
  })

  it('TE uses amber color (yellow-spectrum for tight end)', () => {
    expect(tableSrc).toMatch(/TE[\s\S]{0,40}amber/)
  })

  it('K (kicker) uses slate/muted color', () => {
    expect(tableSrc).toMatch(/'K'[\s\S]{0,60}slate/)
  })

  it('DEF/DST uses violet color', () => {
    expect(tableSrc).toMatch(/DEF[\s\S]{0,60}violet/)
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

describe('ADP delta badge — surfaces existing client-side data (Commit 22)', () => {
  it('ADP case computes delta as Math.round(p.adp - p.aiAdp)', () => {
    expect(tableSrc).toMatch(/Math\.round\(p\.adp - p\.aiAdp\)/)
  })

  it('delta is only shown when both adp and aiAdp are finite numbers', () => {
    expect(tableSrc).toMatch(/p\.adp != null[\s\S]{0,100}Number\.isFinite[\s\S]{0,100}p\.aiAdp != null/)
  })

  it('delta is only rendered when delta !== 0 (no noise for exact match)', () => {
    expect(tableSrc).toMatch(/delta !== null && delta !== 0/)
  })

  it('positive delta (AI values player higher) uses emerald class', () => {
    expect(tableSrc).toMatch(/delta > 0.*text-emerald/)
  })

  it('negative delta (AI values player lower) uses rose class', () => {
    expect(tableSrc).toMatch(/text-rose.*delta|delta.*text-rose/)
  })

  it('delta badge carries a descriptive title for non-sighted users', () => {
    expect(tableSrc).toMatch(/undervalued.*overvalued|overvalued.*undervalued/)
  })

  it('delta span is aria-hidden (decorative — the ADP title already conveys the info)', () => {
    expect(tableSrc).toMatch(/aria-hidden[\s\S]{0,80}adp-delta|adp-delta[\s\S]{0,80}aria-hidden/)
  })

  it('delta testid uses -adp-delta suffix', () => {
    expect(tableSrc).toMatch(/adp-delta/)
  })
})

// ---------------------------------------------------------------------------
// 3. Null stat cell dimming
// ---------------------------------------------------------------------------

describe('null stat cells — dimmed for "no data" clarity (Commit 22)', () => {
  it("em-dash values get text-white/30 class in the default stat branch", () => {
    expect(tableSrc).toMatch(/display === '—'[\s\S]{0,40}text-white\/30/)
  })

  it('className is only applied conditionally — actual values stay unstyled', () => {
    expect(tableSrc).toMatch(/display === '—' \? 'text-white\/30' : undefined/)
  })
})

// ---------------------------------------------------------------------------
// 4. Table row density
// ---------------------------------------------------------------------------

describe('SleeperPoolTable row density — Commit 22', () => {
  it('ROW_HEIGHT is at most 32 (reduced from previous 34)', () => {
    expect(SLEEPER_POOL_TABLE_ROW_HEIGHT).toBeLessThanOrEqual(32)
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
