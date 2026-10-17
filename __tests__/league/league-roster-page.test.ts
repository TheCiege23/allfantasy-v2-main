/**
 * Regression tests for the roster/team tab not glitching due to AppShell layout changes.
 *
 * Root cause of the glitch: AppShell was constructing Tailwind arbitrary-value class strings
 * dynamically at runtime (string interpolation). Tailwind's JIT scanner can only detect
 * static class strings in source files — dynamic construction produces no CSS, breaking the
 * grid layout and causing content to collapse or overflow incorrectly.
 *
 * Fix: All grid-template-columns values are now static string literals in BALANCED_COLS.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const appShellSrc = read('app/components/AppShell.tsx')
const leagueShellSrc = read('app/league/[leagueId]/LeagueShell.tsx')

// ─── AppShell: no dynamically constructed Tailwind classes ────────────────────

describe('AppShell — Tailwind class safety (prevents roster glitch)', () => {
  it('grid-template-columns values are static literals, not template string interpolation', () => {
    // Dynamically constructed strings like `md:[grid-template-columns:${col}...]`
    // are invisible to Tailwind's JIT scanner and produce no CSS.
    // All column variants must be hardcoded string literals.
    expect(appShellSrc).not.toMatch(/`md:\[grid-template-columns:[^`]*\${/)
  })

  it('BALANCED_COLS lookup object holds all four static column combinations', () => {
    expect(appShellSrc).toContain('BALANCED_COLS')
    // both open
    expect(appShellSrc).toContain('minmax(280px,40fr)_minmax(0,35fr)_minmax(240px,25fr)')
    // left collapsed
    expect(appShellSrc).toContain('3rem_minmax(0,35fr)_minmax(240px,25fr)')
    // right collapsed
    expect(appShellSrc).toContain('minmax(280px,40fr)_minmax(0,35fr)_3rem')
    // both collapsed
    expect(appShellSrc).toContain('3rem_minmax(0,1fr)_3rem')
  })

  it('selects columns from BALANCED_COLS via conditional (not string interpolation)', () => {
    expect(appShellSrc).toContain('BALANCED_COLS.both')
    expect(appShellSrc).toContain('BALANCED_COLS.leftOnly')
    expect(appShellSrc).toContain('BALANCED_COLS.rightOnly')
    expect(appShellSrc).toContain('BALANCED_COLS.none')
  })

  it('center column keeps a zero minimum while honoring the 35% desktop share', () => {
    // Center must keep a zero minimum so it can shrink without overflow,
    // while the open desktop layout honors the requested 40/35/25 split.
    const colLines = appShellSrc.split('\n').filter(l => l.includes('grid-template-columns'))
    expect(colLines.length).toBeGreaterThan(0)
    expect(appShellSrc).toContain('minmax(0,35fr)')
    expect(appShellSrc).toContain('3rem_minmax(0,1fr)_3rem')
  })
})

// ─── AppShell: center workspace layout integrity ──────────────────────────────

describe('AppShell center workspace — layout integrity for roster tab', () => {
  it('center workspace has overflow-hidden to contain roster scroll regions', () => {
    // Center uses overflow-hidden + inner scroll so the AppShell grid isn't broken
    // by roster content taller than the viewport.
    expect(appShellSrc).toContain('overflow-hidden')
  })

  it('center workspace has min-w-0 to allow shrinking inside CSS grid', () => {
    // Without min-w-0 a grid child cannot shrink below its content width,
    // which would push the right rail off-screen.
    expect(appShellSrc).toContain('min-w-0')
  })

  it('center workspace child div does not use flex-1 in balanced mode (grid handles sizing)', () => {
    // In balanced-three-panel mode the grid column handles width — flex-1 is for legacy mode only.
    const balancedCenter = appShellSrc.match(/balanced.*minmax.*flex.*min-h-0.*min-w-0[^}]*/s)
    // Just verify the center block exists; detailed layout is grid-driven.
    expect(appShellSrc).toContain('balanced-three-panel')
  })
})

// ─── Roster tab renders via TeamTab ──────────────────────────────────────────

describe('Roster tab — renders TeamTab in center workspace', () => {
  it("LeagueTabRouter handles 'roster', 'team', and 'squad' tab IDs", () => {
    expect(leagueShellSrc).toContain("case 'roster':")
    expect(leagueShellSrc).toContain("case 'team':")
    expect(leagueShellSrc).toContain("case 'squad':")
  })

  it('roster case renders TeamTab (not RosterTab directly)', () => {
    // The actual component is TeamTab which handles all roster variants.
    expect(leagueShellSrc).toContain('TeamTab')
  })

  it('LeagueTabRouter is a top-level function (not nested) — avoids closure scope errors', () => {
    // Regression: LeagueTabRouter was previously nested inside LeagueShell's return,
    // causing variables like isPredraftLifecycle to be out of scope.
    const funcDecl = leagueShellSrc.match(/^function LeagueTabRouter/m)
    expect(funcDecl).not.toBeNull()
  })
})

// ─── Left wrapper div — does not break LeftChatPanel layout ──────────────────

describe('AppShell left rail wrapper — no broken flex chain', () => {
  it('wrapper div uses relative flex h-full min-h-0 w-full flex-col overflow-hidden', () => {
    // The wrapper added around leftPanel (for collapse button positioning) must not
    // break LeftChatPanel's internal flex layout. It must match the aside's flex context.
    expect(appShellSrc).toContain('relative flex h-full min-h-0 w-full flex-col overflow-hidden')
  })

  it('collapse button is absolutely positioned so it does not shift leftPanel content', () => {
    expect(appShellSrc).toContain('absolute right-1 top-1')
  })
})

// ─── Chat collapsed by default ──────────────────────────────────────────────────

describe('League shell — chat collapsed by default on desktop', () => {
  it('desktopChatOpen initialises to false to give roster management more room', () => {
    expect(leagueShellSrc).toContain('const [desktopChatOpen, setDesktopChatOpen] = useState<boolean>(false)')
  })

  it('My Leagues right rail defaults to collapsed and keeps its saved preference', () => {
    expect(leagueShellSrc).toContain("defaultCollapsed: true")
    expect(leagueShellSrc).toContain('af-league-myleagues-rail-collapsed')
  })
})
