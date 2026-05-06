import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('dashboard draft room overlay wiring', () => {
  it('DashboardShell reads overlay params and renders DraftRoomOverlay', () => {
    const shell = read('app/dashboard/DashboardShell.tsx')
    expect(shell).toContain("searchParams.get('draftOverlay')")
    expect(shell).toContain("searchParams.get('draftId')")
    expect(shell).toContain("searchParams.get('dispersalDraftId')")
    expect(shell).toContain('<DraftRoomOverlay')
    expect(shell).toContain('handleDraftOverlayRequest')
  })

  it('DraftRoomOverlay supports iframeSrc, loading, and error states', () => {
    const src = read('app/dashboard/components/DraftRoomOverlay.tsx')
    expect(src).toContain('iframeSrc')
    expect(src).toContain('/draft/')
    expect(src).toContain('dashboard-draft-overlay-close')
    expect(src).toContain('Return to dashboard home')
    expect(src).toContain('Close draft room')
    expect(src).toContain('dashboard-draft-overlay-error')
  })

  it('DraftTab uses embedded league overlay bridge', () => {
    const src = read('app/league/[leagueId]/tabs/DraftTab.tsx')
    expect(src).toContain('dashboardEmbed')
    expect(src).toContain('openDraftFromEmbeddedLeague')
  })

  it('League layout uses LeagueEmbedGate for embed chrome stripping', () => {
    const src = read('app/league/layout.tsx')
    expect(src).toContain('LeagueEmbedGate')
    expect(src).toContain('ProductShellLayout')
  })
})
