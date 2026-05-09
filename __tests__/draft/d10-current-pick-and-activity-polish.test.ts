/**
 * D.10 — Current pick and pick activity polish (Commit 25)
 *
 * Source-level invariants locking the visual improvements to:
 *   DraftBoardCell, DraftManagerStrip, DraftPickActivityStrip, PickHistory.
 * No rendering, no DB, no network. All assertions use readFileSync + regex.
 *
 * Goals locked here:
 *   1.  Current pick cell uses ring-2 (was ring-1) — stronger visible border.
 *   2.  Current pick top accent bar: h-[2px] animate-pulse (was static h-px).
 *   3.  Board cell density from Commit 21 still intact (h-[42px] min-h-[42px]).
 *   4.  Amber shadow regression guard (Commit 21 amber glow still present).
 *   5.  Active manager dot has animate-ping (pulsing presence indicator).
 *   6.  Active manager ring strengthened to ring-cyan-300/90.
 *   7.  Activity strip latest pick gets draft-live-activity-latest class.
 *   8.  Activity strip latest pick has a "Latest" badge label.
 *   9.  PickHistory draft-pick-history testid preserved (no regression).
 *  10.  PickHistory most recent row gets draft-pick-history-latest class.
 *  11.  DraftTopBar draft-topbar-on-clock-manager testid preserved.
 *  12.  DraftBoard overscroll-x-contain from Commit 24 still intact.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

const cellSrc = read('components/app/draft-room/DraftBoardCell.tsx')
const stripSrc = read('components/app/draft-room/DraftManagerStrip.tsx')
const activitySrc = read('components/app/draft-room/DraftPickActivityStrip.tsx')
const historySrc = read('components/draft/live/PickHistory.tsx')
const topbarSrc = read('components/app/draft-room/DraftTopBar.tsx')
const boardSrc = read('components/app/draft-room/DraftBoard.tsx')

// ---------------------------------------------------------------------------
// 1. Current pick ring-2 (Commit 25)
// ---------------------------------------------------------------------------

describe('DraftBoardCell — current pick ring-2 (Commit 25)', () => {
  it('default variant uses ring-2 ring-[#f6c445]/70 (was ring-1)', () => {
    expect(cellSrc).toMatch(/ring-2 ring-\[#f6c445\]\/70/)
  })

  it('old ring-1 ring-[#f6c445]/60 is gone from the current-pick path', () => {
    expect(cellSrc).not.toMatch(/ring-1 ring-\[#f6c445\]\/60/)
  })

  it('old ring-1 ring-[#f6c445]/65 is gone from the current-pick path', () => {
    expect(cellSrc).not.toMatch(/ring-1 ring-\[#f6c445\]\/65/)
  })
})

// ---------------------------------------------------------------------------
// 2. Current pick top accent bar — animate-pulse + h-[2px] (Commit 25)
// ---------------------------------------------------------------------------

describe('DraftBoardCell — current pick accent bar pulse (Commit 25)', () => {
  it('accent bar ternary uses h-[2px] animate-pulse when isCurrentPick', () => {
    expect(cellSrc).toMatch(/isCurrentPick \? 'h-\[2px\] animate-pulse' : 'h-px'/)
  })

  it('accent bar opacity is 1 for current pick (fully opaque tint)', () => {
    expect(cellSrc).toMatch(/isCurrentPick \? 1 : 0\.38/)
  })
})

// ---------------------------------------------------------------------------
// 3. Board cell density from Commit 21 intact (regression guard)
// ---------------------------------------------------------------------------

describe('DraftBoardCell — Commit 21 density classes intact (Commit 25)', () => {
  it('cell base height is still h-[42px]', () => {
    expect(cellSrc).toMatch(/h-\[42px\]/)
  })

  it('cell min-height is still min-h-[42px]', () => {
    expect(cellSrc).toMatch(/min-h-\[42px\]/)
  })

  it('cell sm height is still sm:h-[44px]', () => {
    expect(cellSrc).toMatch(/sm:h-\[44px\]/)
  })

  it('draft-live-current-pick class is still on the current pick cell', () => {
    expect(cellSrc).toMatch(/draft-live-current-pick/)
  })

  it('data-current attribute is still set', () => {
    expect(cellSrc).toMatch(/data-current=\{isCurrentPick \? 'true' : 'false'\}/)
  })
})

// ---------------------------------------------------------------------------
// 4. Amber shadow regression guard (Commit 21 glow still present)
// ---------------------------------------------------------------------------

describe('DraftBoardCell — amber glow regression guard (Commit 25)', () => {
  it('amber shadow (40px or 46px) is still on current pick cell', () => {
    expect(cellSrc).toMatch(/shadow-\[0_0_4[06]px_rgba\(246,196,69/)
  })
})

// ---------------------------------------------------------------------------
// 5. Active manager dot — animate-ping (Commit 25)
// ---------------------------------------------------------------------------

describe('DraftManagerStrip — active manager dot animate-ping (Commit 25)', () => {
  it('active indicator dot has animate-ping inner span', () => {
    expect(stripSrc).toMatch(/animate-ping/)
  })

  it('animate-ping targets the cyan-300 indicator color', () => {
    expect(stripSrc).toMatch(/animate-ping[\s\S]{0,120}bg-cyan-300/)
  })

  it('solid dot still renders as h-3 w-3 rounded-full bg-cyan-300', () => {
    expect(stripSrc).toMatch(/h-3 w-3 rounded-full border border-\[#071020\] bg-cyan-300/)
  })
})

// ---------------------------------------------------------------------------
// 6. Active manager ring strengthened to ring-cyan-300/90 (Commit 25)
// ---------------------------------------------------------------------------

describe('DraftManagerStrip — active ring ring-cyan-300/90 (Commit 25)', () => {
  it('active ring uses ring-cyan-300/90 (was ring-cyan-300/75)', () => {
    expect(stripSrc).toMatch(/ring-cyan-300\/90/)
  })

  it('old ring-cyan-300/75 is gone', () => {
    expect(stripSrc).not.toMatch(/ring-cyan-300\/75/)
  })
})

// ---------------------------------------------------------------------------
// 7. Activity strip — latest pick gets draft-live-activity-latest (Commit 25)
// ---------------------------------------------------------------------------

describe('DraftPickActivityStrip — latest pick class (Commit 25)', () => {
  it('draft-live-activity-latest class is present for idx === 0', () => {
    expect(activitySrc).toMatch(/draft-live-activity-latest/)
  })

  it('latest item uses amber-tinted border', () => {
    expect(activitySrc).toMatch(/draft-live-activity-latest border-amber-400\/30/)
  })

  it('activity strip testid is preserved (no regression)', () => {
    expect(activitySrc).toMatch(/data-testid="draft-activity-strip"/)
  })
})

// ---------------------------------------------------------------------------
// 8. Activity strip — "Latest" badge (Commit 25)
// ---------------------------------------------------------------------------

describe('DraftPickActivityStrip — latest badge label (Commit 25)', () => {
  it('a "Latest" label is conditionally rendered on the first item', () => {
    expect(activitySrc).toMatch(/idx === 0[\s\S]{0,200}Latest/)
  })

  it('"Latest" badge uses amber styling', () => {
    expect(activitySrc).toMatch(/border-amber-400\/40 bg-amber-500\/15[\s\S]{0,150}Latest/)
  })
})

// ---------------------------------------------------------------------------
// 9. PickHistory — testid preserved (Commit 25 regression guard)
// ---------------------------------------------------------------------------

describe('PickHistory — testid no regression (Commit 25)', () => {
  it('draft-pick-history testid is still on the container', () => {
    expect(historySrc).toMatch(/data-testid="draft-pick-history"/)
  })

  it('"Recent picks" header label is still present', () => {
    expect(historySrc).toMatch(/Recent picks/)
  })
})

// ---------------------------------------------------------------------------
// 10. PickHistory — latest row highlight (Commit 25)
// ---------------------------------------------------------------------------

describe('PickHistory — most recent pick highlight (Commit 25)', () => {
  it('draft-pick-history-latest class exists on the most recent row', () => {
    expect(historySrc).toMatch(/draft-pick-history-latest/)
  })

  it('latest row uses amber-tinted border', () => {
    expect(historySrc).toMatch(/draft-pick-history-latest border-amber-400\/25/)
  })

  it('isLatest prop controls which row gets the highlight', () => {
    expect(historySrc).toMatch(/isLatest=\{idx === 0\}/)
  })
})

// ---------------------------------------------------------------------------
// 11. DraftTopBar — on-clock manager testid (Commit 25 regression guard)
// ---------------------------------------------------------------------------

describe('DraftTopBar — on-clock manager testid (Commit 25)', () => {
  it('draft-topbar-on-clock-manager testid is preserved', () => {
    expect(topbarSrc).toMatch(/data-testid="draft-topbar-on-clock-manager"/)
  })

  it('clock pill draft-topbar-clock testid is preserved', () => {
    expect(topbarSrc).toMatch(/data-testid="draft-topbar-clock"/)
  })

  it('animate-pulse is still present for urgent low-timer (a11y non-color cue)', () => {
    expect(topbarSrc).toMatch(/animate-pulse/)
  })
})

// ---------------------------------------------------------------------------
// 12. DraftBoard — overscroll-x-contain from Commit 24 intact
// ---------------------------------------------------------------------------

describe('DraftBoard — Commit 24 overscroll protection intact (Commit 25)', () => {
  it('snake board outer scroll still has overscroll-x-contain', () => {
    expect(boardSrc).toMatch(/snap-x snap-mandatory overflow-x-auto overscroll-x-contain/)
  })

  it('auction board path also still has overscroll-x-contain', () => {
    const auctionMatch = boardSrc.match(
      /draftType === 'auction'[\s\S]*?overscroll-x-contain/,
    )
    expect(auctionMatch).not.toBeNull()
  })
})
