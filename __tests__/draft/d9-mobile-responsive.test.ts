/**
 * D.9 — Mobile and responsive behavior (Commit 24)
 *
 * Source-level invariants locking the responsive improvements made to
 * DraftBoard, DraftRoomPageClient, and verifying the shell/layout
 * contracts that prevent the draft room from breaking on mobile.
 * No rendering, no DB, no network.
 *
 * Goals locked here:
 *   1.  Draft board outer scroll has overscroll-x-contain (prevents back-nav on over-scroll).
 *   2.  Draft board grid has min-w-max (prevents content squeezing on narrow viewports).
 *   3.  Right dock is xl:flex only — never forces desktop column on mobile/tablet.
 *   4.  Tab fallback (< xl) correctly uses xl:hidden to match the dock breakpoint.
 *   5.  Player pool testid and search input are preserved.
 *   6.  Queue panel testid preserved.
 *   7.  AutopickMeToggle container uses py-1 (stays compact, does not dominate vertical space).
 *   8.  Mobile sticky bar uses py-1.5 space-y-1 (tightened from py-2 space-y-1.5).
 *   9.  No legacy /api/draft/pick endpoint in DraftRoomPageClient.
 *  10.  Auction board path also has overscroll-x-contain (consistent scroll safety).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

const boardSrc = read('components/app/draft-room/DraftBoard.tsx')
const pageSrc = read('components/app/draft-room/DraftRoomPageClient.tsx')
const queueSrc = read('components/app/draft-room/QueuePanel.tsx')
const toggleSrc = read('components/app/draft-room/AutopickMeToggle.tsx')
const panelSrc = read('components/app/draft-room/PlayerPanel.tsx')

// ---------------------------------------------------------------------------
// 1. Draft board snake path — overscroll-x-contain (Commit 24)
// ---------------------------------------------------------------------------

describe('DraftBoard — snake outer scroll overscroll-x-contain (Commit 24)', () => {
  it('snake board outer scroll has overscroll-x-contain', () => {
    expect(boardSrc).toMatch(/snap-x snap-mandatory overflow-x-auto overscroll-x-contain/)
  })

  it('snap-x snap-mandatory are still present (no regressions to scroll snap)', () => {
    expect(boardSrc).toMatch(/snap-x snap-mandatory/)
  })

  it('-webkit-overflow-scrolling:touch is still present for iOS momentum scroll', () => {
    expect(boardSrc).toMatch(/\[-webkit-overflow-scrolling:touch\]/)
  })
})

// ---------------------------------------------------------------------------
// 2. Draft board grid — min-w-max prevents content squeezing
// ---------------------------------------------------------------------------

describe('DraftBoard — board grid min-w-max (Commit 24)', () => {
  it('snake board grid has min-w-max to prevent column squeezing', () => {
    expect(boardSrc).toMatch(/min-w-max.*data-testid="draft-board-grid"/)
  })

  it('draft-board-grid testid is preserved', () => {
    expect(boardSrc).toMatch(/data-testid="draft-board-grid"/)
  })

  it('header row is sticky top-0 (mobile wrapper must not break sticky header)', () => {
    expect(boardSrc).toMatch(/sticky top-0/)
  })
})

// ---------------------------------------------------------------------------
// 3. Right dock — xl:flex only (desktop, does not crush mobile)
// ---------------------------------------------------------------------------

describe('DraftRoomPageClient — right dock xl-only breakpoint (Commit 24)', () => {
  it('right dock div uses xl:flex (className precedes testid in source)', () => {
    // xl:flex appears in the className before data-testid on the same element
    expect(pageSrc).toMatch(/xl:flex xl:flex-\[7\][\s\S]{0,60}data-testid="draft-right-dock"/)
  })

  it('right dock div uses xl:flex-\\[7\\] flex ratio', () => {
    expect(pageSrc).toMatch(/xl:flex-\[7\]/)
  })

  it('DraftRightDockTabs is inside the xl-only right dock (not outside it)', () => {
    const rightDockIdx = pageSrc.indexOf('data-testid="draft-right-dock"')
    const dockTabsIdx = pageSrc.indexOf('<DraftRightDockTabs')
    expect(rightDockIdx).toBeGreaterThan(-1)
    expect(dockTabsIdx).toBeGreaterThan(rightDockIdx)
  })
})

// ---------------------------------------------------------------------------
// 4. Tab fallback — xl:hidden matches the dock breakpoint
// ---------------------------------------------------------------------------

describe('DraftRoomPageClient — tab fallback xl:hidden (Commit 24)', () => {
  it('tab fallback div uses xl:hidden to appear only when dock is hidden', () => {
    expect(pageSrc).toMatch(/xl:hidden[\s\S]{0,180}data-testid="draft-bottom-dock-tabs"/)
  })

  it('draft-bottom-dock-tabs testid is preserved in the tab fallback', () => {
    expect(pageSrc).toMatch(/data-testid="draft-bottom-dock-tabs"/)
  })
})

// ---------------------------------------------------------------------------
// 5. Player pool — testid and search preserved
// ---------------------------------------------------------------------------

describe('PlayerPanel — search and testid preserved (Commit 24)', () => {
  it('player pool testid exists in DraftRoomPageClient', () => {
    expect(pageSrc).toMatch(/data-testid="draft-bottom-dock-pool"/)
  })

  it('draft-player-search-input is still present in PlayerPanel', () => {
    expect(panelSrc).toMatch(/data-testid="draft-player-search-input"/)
  })

  it('position filter radiogroup is still present', () => {
    expect(panelSrc).toMatch(/data-testid="draft-position-filter"/)
  })
})

// ---------------------------------------------------------------------------
// 6. Queue panel — testid preserved
// ---------------------------------------------------------------------------

describe('QueuePanel — testid preserved (Commit 24)', () => {
  it('draft-queue-panel testid is present', () => {
    expect(queueSrc).toMatch(/data-testid="draft-queue-panel"/)
  })

  it('queue search input is present', () => {
    expect(queueSrc).toMatch(/data-testid="draft-queue-search"/)
  })

  it('queue position filter is present', () => {
    expect(queueSrc).toMatch(/data-testid="draft-queue-position-filter"/)
  })
})

// ---------------------------------------------------------------------------
// 7. AutopickMeToggle — compact py-1 preserved
// ---------------------------------------------------------------------------

describe('AutopickMeToggle — compact spacing preserved (Commit 24)', () => {
  it('container uses py-1 (not the old py-1.5) — does not dominate vertical space', () => {
    expect(toggleSrc).toMatch(/px-3 py-1"/)
  })

  it('autopick-me-toggle testid is present', () => {
    expect(toggleSrc).toMatch(/data-testid="autopick-me-toggle"/)
  })
})

// ---------------------------------------------------------------------------
// 8. Mobile sticky bar — tightened padding (Commit 24)
// ---------------------------------------------------------------------------

describe('DraftRoomPageClient — mobile sticky bar compact (Commit 24)', () => {
  it('sticky bar uses space-y-1 py-1.5 (tightened from space-y-1.5 py-2)', () => {
    expect(pageSrc).toMatch(/space-y-1 px-2\.5 py-1\.5 text-xs.*data-testid="draft-mobile-sticky-bar"/)
  })

  it('old space-y-1.5 py-2 combo is gone from the sticky bar', () => {
    expect(pageSrc).not.toMatch(/space-y-1\.5 px-2\.5 py-2 text-xs.*data-testid="draft-mobile-sticky-bar"/)
  })

  it('draft-mobile-current-pick testid is preserved', () => {
    expect(pageSrc).toMatch(/data-testid="draft-mobile-current-pick"/)
  })
})

// ---------------------------------------------------------------------------
// 9. No legacy API endpoints
// ---------------------------------------------------------------------------

describe('DraftRoomPageClient — no legacy draft API endpoints (Commit 24)', () => {
  it('does not reference /api/draft/pick (legacy endpoint)', () => {
    expect(pageSrc).not.toMatch(/['"`]\/api\/draft\/pick['"`]/)
  })

  it('does not reference /api/draft/room (legacy endpoint)', () => {
    expect(pageSrc).not.toMatch(/\/api\/draft\/room/)
  })

  it('uses /api/leagues/ prefix for all draft session calls', () => {
    expect(pageSrc).toMatch(/\/api\/leagues\//)
  })
})

// ---------------------------------------------------------------------------
// 10. Auction board path — overscroll-x-contain (Commit 24)
// ---------------------------------------------------------------------------

describe('DraftBoard — auction outer scroll overscroll-x-contain (Commit 24)', () => {
  it('auction board outer scroll also has overscroll-x-contain', () => {
    // Both the snake and auction paths need overscroll-x-contain so swipe-back
    // gestures don't fire when over-scrolling the board horizontally.
    const auctionScrollMatch = boardSrc.match(
      /draftType === 'auction'[\s\S]*?overscroll-x-contain/,
    )
    expect(auctionScrollMatch).not.toBeNull()
  })

  it('auction board grid has min-w-min for wide auction columns', () => {
    expect(boardSrc).toMatch(/grid min-w-min gap-3/)
  })
})
