/**
 * Regression tests for /league/[leagueId] full-width layout.
 *
 * Guards the dashboard-style league shell. The league page should default to:
 *  - left chat rail visible
 *  - center dashboard visible in the middle
 *  - My Leagues right rail visible
 *  - either side can collapse into a slim strip while the center expands
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const leagueShellSrc = read('app/league/[leagueId]/LeagueShell.tsx')
const appShellSrc = read('app/components/AppShell.tsx')
const hookSrc = read('hooks/useMyLeaguesRailCollapse.ts')

// ─── My Leagues right rail: visible by default on league pages ──────────────

describe('My Leagues rail — league page defaults to visible', () => {
  it('LeagueShell passes defaultCollapsed: false to useMyLeaguesRailCollapse', () => {
    expect(leagueShellSrc).toContain('defaultCollapsed: false')
  })

  it('LeagueShell uses a league-specific storage key (not shared with dashboard)', () => {
    expect(leagueShellSrc).toContain('af-league-myleagues-rail-collapsed')
  })

  it('useMyLeaguesRailCollapse accepts options.defaultCollapsed', () => {
    expect(hookSrc).toContain('defaultCollapsed')
  })

  it('useMyLeaguesRailCollapse accepts options.storageKey', () => {
    expect(hookSrc).toContain('storageKey')
  })

  it('hook only overrides default when sessionStorage has an explicit saved value (null guard)', () => {
    // If the user never toggled, storage returns null — we must respect defaultCollapsed.
    expect(hookSrc).toContain('stored !== null')
  })

  it('pre-hydration value uses defaultCollapsed instead of hardcoded false', () => {
    // Before hydration, the hook must return the provided default (not false).
    // This ensures the first paint matches the desired state, not a jarring flash.
    expect(hookSrc).toMatch(/collapsed:\s*hydrated\s*\?\s*collapsed\s*:\s*defaultCollapsed/)
  })
})

// ─── Left chat rail: visible by default, opens on openChat param ────────────

describe('Left chat rail — defaults to visible, respects openChat param', () => {
  it('AppShell accepts leftRailCollapsed prop', () => {
    expect(appShellSrc).toContain('leftRailCollapsed')
  })

  it('AppShell accepts onLeftRailExpand callback', () => {
    expect(appShellSrc).toContain('onLeftRailExpand')
  })

  it('AppShell accepts onLeftRailCollapse callback', () => {
    expect(appShellSrc).toContain('onLeftRailCollapse')
  })

  it('AppShell renders a slim left strip with chat-rail-expand button when collapsed', () => {
    expect(appShellSrc).toContain('chat-rail-expand')
  })

  it('AppShell renders a collapse button when left rail is open', () => {
    expect(appShellSrc).toContain('chat-rail-collapse')
  })

  it('LeagueShell initializes desktopChatOpen to true (chat visible by default)', () => {
    // Chat is shown by default so users can immediately use League/Chimmy/AF Huddle/DMs.
    expect(leagueShellSrc).toContain('desktopChatOpen')
    expect(leagueShellSrc).toContain('useState<boolean>(true)')
  })

  it('LeagueShell syncs desktopChatOpen with openChatQuery via useEffect', () => {
    expect(leagueShellSrc).toContain('openChatQuery != null')
    expect(leagueShellSrc).toContain('setDesktopChatOpen(true)')
  })

  it('LeagueShell passes leftRailCollapsed={!desktopChatOpen} to AppShell', () => {
    expect(leagueShellSrc).toContain('leftRailCollapsed={!desktopChatOpen}')
  })

  it('LeagueShell passes onLeftRailExpand to AppShell', () => {
    expect(leagueShellSrc).toContain('onLeftRailExpand={() => setDesktopChatOpen(true)}')
  })

  it('LeagueShell passes onLeftRailCollapse to AppShell', () => {
    expect(leagueShellSrc).toContain('onLeftRailCollapse={() => setDesktopChatOpen(false)}')
  })
})

// ─── AppShell: dynamic grid columns reflect collapse state ────────────────────

describe('AppShell balanced-three-panel — dynamic column widths', () => {
  it('left collapsed column is 3rem (static literal in BALANCED_COLS)', () => {
    // Static class literals required — Tailwind JIT cannot detect dynamically constructed strings.
    expect(appShellSrc).toContain('BALANCED_COLS')
    expect(appShellSrc).toContain('3rem_minmax(0,35fr)_minmax(240px,25fr)')
  })

  it('right collapsed column is 3rem (static literal in BALANCED_COLS)', () => {
    expect(appShellSrc).toContain('minmax(280px,40fr)_minmax(0,35fr)_3rem')
  })

  it('left expanded column uses minmax(280px,40fr)', () => {
    expect(appShellSrc).toContain('minmax(280px,40fr)')
  })

  it('right expanded column uses minmax(240px,25fr)', () => {
    expect(appShellSrc).toContain('minmax(240px,25fr)')
  })

  it('data-testid present on left rail for assertions', () => {
    expect(appShellSrc).toContain('app-shell-left-rail')
  })

  it('data-af-left-collapsed attribute set when left rail is collapsed', () => {
    expect(appShellSrc).toContain("data-af-left-collapsed={leftRailCollapsed ? '1' : undefined}")
  })

  it('data-af-right-collapsed attribute set when right rail is collapsed', () => {
    expect(appShellSrc).toContain("data-af-right-collapsed={rightRailCollapsed ? '1' : undefined}")
  })
})

// ─── Mobile drawers: unaffected (already correct behavior) ────────────────────

describe('Mobile drawers — unchanged, still overlay-based', () => {
  it('mobile chat drawer is behind md:hidden guard', () => {
    // Mobile toolbar (Bot button) is already md:hidden — correct
    expect(leagueShellSrc).toContain('md:hidden')
  })

  it('mobile chat sheet is a fixed overlay (not a layout column)', () => {
    expect(leagueShellSrc).toContain('fixed inset-0')
    expect(leagueShellSrc).toContain('setMobileLeftOpen')
  })

  it('mobile My Leagues sheet is a fixed overlay', () => {
    expect(leagueShellSrc).toContain('setMobileRightOpen')
  })
})

// ─── query params: do not force 3-column layout ───────────────────────────────

describe('Query params — openChat/showInvite do not force permanent 3-column layout', () => {
  it('openChat=league opens chat but not via layout grid change (uses state)', () => {
    // The chat open state is tracked via desktopChatOpen, not by switching layout modes
    expect(leagueShellSrc).toContain('desktopChatOpen')
    expect(leagueShellSrc).not.toContain("openChatQuery != null && layoutMode")
  })

  it('showInvite param is handled by invite drawer (not a layout column)', () => {
    // Invite drawer is a portal/overlay — presence of defaultShowInvite should not add a column
    expect(leagueShellSrc).toContain('defaultShowInvite')
    expect(leagueShellSrc).not.toContain('defaultShowInvite && layoutMode')
  })

  it('created=1 param triggers setup flow, not layout switch', () => {
    expect(leagueShellSrc).toContain('createdFromLeagueCreate')
    expect(leagueShellSrc).not.toContain('createdFromLeagueCreate && layoutMode')
  })
})
