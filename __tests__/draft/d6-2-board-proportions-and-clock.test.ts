import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * D.6.2 — visual layout fixes after D.6.1:
 *   1. Board zone proportions keep the board dominant (~60vh expanded; flex-1 collapsed).
 *   2. Collapse toggle (▲▼) between board and dock — when collapsed, board fills.
 *   3. LiveDraftStatusColumn (left of draft board) removed in live snake layout.
 *   4. Top-middle "RESUME DRAFT" button replaced with a prominent clock pill;
 *      the pill itself is the click target when commissioner + paused.
 *
 * Pure static-source assertions. Dev preview route exercises the visible result.
 */

const root = resolve(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('D.6.2 — board zone proportions + dock collapse toggle (DraftRoomShell)', () => {
  const src = read('components/app/draft-room/DraftRoomShell.tsx')

  it('half size splits the screen: the board caps at 50vh so the pool and chat get the other half', () => {
    expect(src).toMatch(/half: 'max-h-\[min\(50vh,600px\)\]'/)
  })

  it('players size gives the panel most of the screen and keeps a board strip', () => {
    expect(src).toMatch(/tall: 'max-h-\[min\(28vh,320px\)\]'/)
  })

  it('min size hides the panel: the board zone fills the screen with flex-1 + max-h-[unset]', () => {
    expect(src).toMatch(/min: 'min-h-0 max-h-\[unset\] flex-1'/)
    expect(src).toMatch(/BOARD_ZONE_BY_DOCK_SIZE\[dockSize\]/)
  })

  it('every surface can resize the panel, including the redraft room', () => {
    expect(src).toMatch(/const allowPremiumDockCollapse = true/)
    expect(src).toMatch(/data-testid="draft-dock-size-half"/)
    expect(src).toMatch(/data-testid="draft-dock-size-tall"/)
    expect(src).toMatch(/DOCK_SIZE_PREF_KEY = 'af:draft-premium-dock-size'/)
  })

  it('collapse toggle button is rendered with the standard Sleeper-style ▲▼ chevron pair', () => {
    expect(src).toMatch(/data-testid="draft-dock-collapse-toggle"/)
    expect(src).toMatch(/<ChevronUp/)
    expect(src).toMatch(/<ChevronDown/)
  })

  it('toggle persists state via the same localStorage pref the legacy bottomBar used', () => {
    expect(src).toMatch(/persistBottomDock\(!bottomDockExpanded\)/)
    expect(src).toMatch(/BOTTOM_DOCK_PREF_KEY = 'af:draft-premium-bottom-dock-expanded'/)
  })

  it('main-zones container hides entirely when collapsed (so board fills the area)', () => {
    expect(src).toMatch(/bottomDockExpanded \? 'flex-1' : 'hidden'/)
  })

  it('aria-expanded reflects state for screen readers + keyboard users', () => {
    expect(src).toMatch(/aria-expanded=\{bottomDockExpanded\}/)
    expect(src).toMatch(/aria-label=\{bottomDockExpanded \? 'Collapse bottom dock' : 'Expand bottom dock'\}/)
  })

  it('exposes data-dock-expanded so QA / e2e selectors can target the state', () => {
    expect(src).toMatch(/data-testid="draft-premium-board-zone"[\s\S]*?data-dock-expanded/)
    expect(src).toMatch(/data-testid="draft-premium-main-zones"[\s\S]*?data-dock-expanded/)
  })
})

describe('D.6.2 — LiveDraftStatusColumn removed from the live snake layout', () => {
  const src = read('components/app/draft-room/DraftRoomPageClient.tsx')

  it('no longer renders <LiveDraftStatusColumn> in the live JSX (the left aside is gone)', () => {
    // The import may still be present for tree-shaking, but no JSX usage of the component.
    expect(src).not.toMatch(/<LiveDraftStatusColumn/)
  })

  it('the surrounding lg:flex-row wrapper is flattened (no horizontal split)', () => {
    // The legacy `lg:flex-row lg:gap-2.5 lg:items-stretch` produced the side-by-side
    // sidebar+board split. After D.6.2 the board wrapper is column-only.
    expect(src).not.toMatch(/lg:flex-row lg:gap-2\.5 lg:items-stretch/)
  })

  it('the explanatory comment documents WHY the column was removed (avoids future regressions)', () => {
    expect(src).toMatch(/D\.6\.2 — LiveDraftStatusColumn removed/)
  })
})

describe('D.6.2 — top-middle RESUME DRAFT replaced with prominent clock', () => {
  const src = read('components/app/draft-room/DraftTopBar.tsx')

  it('does not render a separate RESUME DRAFT button — the clock pill is the resume action', () => {
    // Old shape was a <button> with literal `RESUME DRAFT` text. After D.6.2 the
    // testid `draft-topbar-resume-draft` is on the clock pill itself when paused.
    expect(src).not.toMatch(/>\s*RESUME DRAFT\s*</)
  })

  it('clock pill uses the dedicated `draft-topbar-clock` testid for normal running state', () => {
    expect(src).toMatch(/data-testid=\{isPausedCommissioner \? 'draft-topbar-resume-draft' : 'draft-topbar-clock'\}/)
  })

  it('clock value renders inside `draft-topbar-clock-time` so e2e can read it', () => {
    expect(src).toMatch(/data-testid="draft-topbar-clock-time"/)
  })

  it('urgent-low-timer (<=10s) gets a non-color cue (animate-pulse) — a11y rule', () => {
    expect(src).toMatch(/animate-pulse/)
    expect(src).toMatch(/data-urgent=\{urgentLowTimer \? 'true' : 'false'\}/)
  })

  it('paused state shows a "Resume" badge inside the clock pill (commissioner click target)', () => {
    expect(src).toMatch(/>\s*Resume\s*<\/span>/)
    expect(src).toMatch(/data-paused=\{draftStatus === 'paused' \? 'true' : 'false'\}/)
  })

  it('commissioner-paused pill is a button (clickable to resume); else it is a div', () => {
    expect(src).toMatch(/<button/)
    expect(src).toMatch(/onClick=\{handlePillClick\}/)
    expect(src).toMatch(/<div[\s\S]*?data-testid="draft-topbar-clock"/)
  })

  it('non-commissioner paused state still shows clock with a Paused badge (read-only)', () => {
    expect(src).toMatch(/>\s*Paused\s*<\/span>/)
  })

  it('clock pill uses large, prominent typography (text-xl / sm:text-2xl + min-h-[36px])', () => {
    // Anchored to the pill's own class string so a matching class elsewhere in the file
    // cannot satisfy it. Raised from text-base when the on-the-clock chips moved beside it.
    expect(src).toMatch(/min-h-\[36px\] items-center gap-2 rounded-full border px-3\.5 py-1\.5 text-xl font-extrabold tabular-nums sm:text-2xl/)
  })
})

describe('D.6.2 — dev preview route reflects the new layout for screenshot verification', () => {
  const src = read('app/dev/d6-preview/D6PreviewClient.tsx')

  it('mocks the prominent clock pill at top center', () => {
    expect(src).toMatch(/data-testid="d6-preview-clock"/)
    expect(src).toMatch(/0:21/)
  })

  it('reserves 52vh for the mock board zone (matches the Sleeper proportions)', () => {
    expect(src).toMatch(/min\(52vh,\s*640px\)/)
  })
})
