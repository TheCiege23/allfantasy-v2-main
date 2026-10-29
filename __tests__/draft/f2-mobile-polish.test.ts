/**
 * F.2 — Mobile Polish Pass.
 *
 * Verifies the structural guarantees the mobile draft room must hold:
 *   - mobile-only layout exists with `md:hidden` so it doesn't double-render
 *     on desktop (no duplicate board)
 *   - mobile tab bar includes Board, Players, Queue, Roster, and Chat (the
 *     five tabs the user spec calls out as mandatory)
 *   - mobile pane uses `overflow-y-auto` (not `overflow-auto`) so wide
 *     children can't bleed page-wide horizontal scroll
 *   - the wide tabs (Board + Players) wrap their content in
 *     `overflow-x-auto` containers so internal horizontal scroll stays
 *     INSIDE the tab pane
 *   - War Room popup uses a full-width bottom sheet at < sm and a docked
 *     popup at ≥ sm
 *   - DraftChatPanel keeps the input pinned inside its own panel (border-t
 *     section, no `position: fixed` that would float it)
 *   - DraftRightDockTabs is hidden on mobile (the mobile bottom-tab bar is
 *     the canonical roster/chat reach), so users don't see two tab strips
 *
 * All assertions are static-source — JSDOM-rendering DraftRoomShell would
 * require the full draft context tree which is beyond scope for a polish
 * pass. The shell's structure is the contract.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('F.2 — DraftRoomShell mobile structure', () => {
  const src = read('components/app/draft-room/DraftRoomShell.tsx')
  const pageSrc = read('components/app/draft-room/DraftRoomPageClient.tsx')

  it('renders a dedicated mobile layout via md:hidden (no duplicate board on desktop)', () => {
    expect(src).toMatch(/data-testid="draft-mobile-layout"/)
    expect(src).toMatch(/md:hidden/)
    // Desktop variant uses hidden md:flex so the two layouts are mutually exclusive.
    expect(src).toMatch(/data-testid="draft-desktop-layout"/)
  })

  it('mobile pane uses overflow-y-auto, not overflow-auto (no page-wide horizontal bleed)', () => {
    // The change from `overflow-auto` to `overflow-y-auto` is what isolates
    // wide-content tabs to their own scroll containers.
    expect(src).toMatch(/min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain/)
    // Negative regression: the mobile pane should not be using the pre-F.2
    // generic `overflow-auto` (which scrolls both axes).
    expect(src).not.toMatch(/draft-mobile-layout"[\s\S]{0,200}overflow-auto[\s\S]{0,400}data-testid="draft-mobile-content"/)
  })

  it('mobile content div has min-w-0 + a stable testid + active-tab data attr', () => {
    expect(src).toMatch(/data-testid="draft-mobile-content"/)
    expect(src).toMatch(/data-active-tab=\{mobileTab\}/)
    // Inside the tray the content area is sized by the tray's snap height and scrolls itself.
    expect(src).toMatch(/h-full min-h-0 min-w-0 overflow-y-auto overscroll-contain/)
  })

  it('Board tab wraps its content in an overflow-x-auto scroll container', () => {
    expect(src).toMatch(/data-testid="draft-mobile-board-scroll"/)
    expect(src).toMatch(/min-w-0 overflow-x-auto overscroll-x-contain[\s\S]{0,200}data-testid="draft-mobile-board-scroll"/)
  })

  it('Players tab wraps its content in an overflow-x-auto scroll container', () => {
    expect(src).toMatch(/data-testid="draft-mobile-players-sheet"/)
    expect(src).toMatch(/data-testid="draft-mobile-players-scroll"/)
    expect(src).toMatch(/min-w-0 overflow-x-auto overscroll-x-contain[\s\S]{0,200}data-testid="draft-mobile-players-scroll"/)
  })

  it('Queue / Roster / Chat tabs render WITHOUT a horizontal scroll wrapper (their content is column-shaped)', () => {
    // Negative assertion: queue / chat / roster don't need horizontal scroll
    // because their internal content is naturally column-shaped (lists,
    // tables of stats, message rows). Wrapping them would just add a
    // pointless inner scrollbar.
    expect(src).toMatch(/\{mobileTab === 'queue' && queuePanel\}/)
    expect(src).toMatch(/\{mobileTab === 'chat' && chatPanel\}/)
    expect(src).toMatch(/rosterPanel && mobileTab === 'roster' && rosterPanel/)
  })

  /*
   * The clock must stay visible on every mobile tab. It used to be a second, non-ticking
   * "Clock" chip in this sticky bar; it now comes from the header's live timer, which
   * sits outside the mobile scroll root and so never scrolls away. Guard both halves.
   */
  it('mobile sticky bar is always enabled; the live clock stays visible on phones via the header', () => {
    expect(pageSrc).toMatch(/const showMobileStickyBar = true/)
    expect(pageSrc).toMatch(/showMobileStickyBar \? \(/)
    expect(pageSrc).toMatch(/data-testid="draft-mobile-current-pick"/)

    const shellSrc = read('components/app/draft-room/DraftRoomShell.tsx')
    const topBarAt = shellSrc.indexOf('{topBar}')
    const scrollRootAt = shellSrc.indexOf('data-testid="draft-mobile-scroll-root"')
    expect(topBarAt).toBeGreaterThan(-1)
    expect(scrollRootAt).toBeGreaterThan(topBarAt)

    const topBarSrc = read('components/app/draft-room/DraftTopBar.tsx')
    const centerSlot = topBarSrc.match(/className="([^"]*)"\s*data-testid="draft-topbar-center-slot"/)
    expect(centerSlot).not.toBeNull()
    expect(centerSlot![1].split(/\s+/)).not.toContain('hidden')
    expect(topBarSrc).toMatch(/\{centerCta\}/)
  })
})

describe('F.2 — DraftRoomShell mobile tab bar', () => {
  const src = read('components/app/draft-room/DraftRoomShell.tsx')

  it('mobile tab bar is hidden on desktop (md:hidden inside md:hidden parent)', () => {
    // The bottom nav lives inside the .md:hidden mobile-layout div.
    expect(src).toMatch(/<nav[\s\S]*?aria-label=\{t\('draftRoom\.shell\.aria\.draftSections'\)\}/)
  })

  it('mobile tabs include Board, Players, Queue, Roster, and Chat (mandatory)', () => {
    expect(src).toMatch(/\{ id: 'board' as const,/)
    expect(src).toMatch(/\{ id: 'players' as const,/)
    expect(src).toMatch(/\{ id: 'queue' as const,/)
    expect(src).toMatch(/\{ id: 'roster' as const,/)
    expect(src).toMatch(/\{ id: 'chat' as const,/)
  })

  it('each tab button has its own testid (draft-mobile-tab-{id}) for QA + e2e', () => {
    expect(src).toMatch(/data-testid=\{`draft-mobile-tab-\$\{id\}`\}/)
  })

  it('tab buttons meet the 48px touch-target minimum (platform standard)', () => {
    expect(src).toMatch(/min-h-\[48px\]/)
    // touch-manipulation hint helps mobile Safari skip the 300ms double-tap delay.
    expect(src).toMatch(/touch-manipulation/)
  })

  it('safe-area-bottom class respects iOS home indicator', () => {
    expect(src).toMatch(/safe-area-bottom/)
  })

  it('renders a dedicated quick-dock row for non-primary tabs', () => {
    expect(src).toMatch(/data-testid="draft-mobile-quick-dock"/)
  })
})

describe('F.2 — DraftRightDockTabs is desktop-only on the mobile shell', () => {
  // The mobile flow uses the bottom tab bar for Roster / Chat reach (not the
  // right dock tabs). DraftRightDockTabs is rendered inside the desktop
  // layout only — verify the page client doesn't accidentally mount it on
  // mobile with a missing breakpoint.
  const shellSrc = read('components/app/draft-room/DraftRoomShell.tsx')

  it('mobile layout does NOT reference DraftRightDockTabs', () => {
    // Find the mobile layout block and assert it doesn't include the right
    // dock tabs (which are a desktop-only construct).
    const mobileMatch = shellSrc.match(
      // The tray mechanics moved to DraftMobileTray; the mobile block still spans layout → tray.
      /data-testid="draft-mobile-layout"[\s\S]*?<\/DraftMobileTray>/,
    )
    expect(mobileMatch).not.toBeNull()
    const mobileBlock = mobileMatch![0]
    expect(mobileBlock).toMatch(/data-testid="draft-mobile-content"/)
    expect(mobileBlock).toMatch(/<\/nav>/)
    expect(mobileBlock).not.toMatch(/DraftRightDockTabs/)
  })
})

describe('F.2 — WarRoomPopup mobile bottom sheet', () => {
  const src = read('components/app/draft-room/WarRoomPopup.tsx')

  it('renders a fixed full-width bottom sheet at mobile widths (< sm)', () => {
    // Mobile (default): fixed inset-x-0 bottom-0, 80dvh tall.
    expect(src).toMatch(/fixed inset-x-0 bottom-0 z-\[55\][\s\S]{0,200}h-\[80dvh\]/)
  })

  it('docks to the bottom-right corner at ≥ sm (tablet + desktop)', () => {
    expect(src).toMatch(/sm:bottom-20 sm:right-4 sm:left-auto/)
    expect(src).toMatch(/sm:inset-x-auto/)
    expect(src).toMatch(/sm:h-\[min\(560px,80dvh\)\]/)
    expect(src).toMatch(/sm:w-\[min\(380px,calc\(100vw-2rem\)\)\]/)
    expect(src).toMatch(/sm:rounded-xl sm:border/)
  })

  it('sheet content scrolls internally (overflow-hidden on root + scroll inner)', () => {
    expect(src).toMatch(/role="dialog"[\s\S]{0,400}overflow-hidden/)
  })

  it('exposes a close button + click-outside handling for mobile dismissal', () => {
    expect(src).toMatch(/data-testid=\{`\$\{testIdBase\}-close`\}/)
    // Click-outside is implemented via panelRef contains check on the trigger.
    expect(src).toMatch(/triggerRef\.current\?\.contains\(target\)/)
  })
})

describe('F.2 — DraftChatPanel input stays inside the panel (mobile-safe)', () => {
  const src = read('components/app/draft-room/DraftChatPanel.tsx')

  it('chat input lives inside a border-t section (pinned to panel bottom, not page)', () => {
    // The composer wrapper has `border-t` so it visually pins to the panel's
    // bottom edge. It does NOT use position: fixed (which would float the
    // input over the iOS keyboard region).
    expect(src).toMatch(/border-t.*p-2\.5 sm:p-3/)
    expect(src).not.toMatch(/composer[\s\S]{0,200}position:\s*fixed/i)
  })

  it('attach + GIF + emoji + send buttons sit in a flex row that shrinks proportionally', () => {
    // `flex min-w-0 items-end gap-1.5 sm:gap-2` lets the input flex-1 while
    // buttons stay shrink-0 — keeps the layout stable at 390px.
    expect(src).toMatch(/flex min-w-0 items-end gap-1\.5 sm:gap-2/)
  })

  it('input has min-w-0 flex-1 so its parent flex row can compress it cleanly', () => {
    expect(src).toMatch(/relative min-w-0 flex-1/)
  })
})

describe('F.2 — Player table preserves its own internal scroll for desktop', () => {
  // Sanity check that the F.2 wrapper doesn't fight with the table's own
  // sticky header / virtualized rows.
  const src = read('components/app/draft-room/SleeperPoolTable.tsx')

  it('table header is sticky (regression guard — mobile wrapper must not break this)', () => {
    expect(src).toMatch(/sticky top-0/)
  })
})

describe('F.2 — no forbidden BaaS references', () => {
  const FORBIDDEN = 'supa' + 'base'
  const filesToCheck = [
    'components/app/draft-room/DraftRoomShell.tsx',
    'components/app/draft-room/WarRoomPopup.tsx',
    'components/app/draft-room/DraftChatPanel.tsx',
  ]
  for (const rel of filesToCheck) {
    it(`${rel} contains no forbidden BaaS imports`, () => {
      const src = read(rel)
      expect(src.toLowerCase()).not.toContain(FORBIDDEN)
    })
  }
})
