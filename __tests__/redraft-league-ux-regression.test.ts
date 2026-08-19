import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('post-merge redraft league UX contracts', () => {
  const leagueShell = read('app/league/[leagueId]/LeagueShell.tsx')
  const leagueTabs = read('app/league/[leagueId]/LeagueTabs.tsx')
  const translations = read('lib/i18n/translations.ts')
  const appShell = read('app/components/AppShell.tsx')
  const draftResolver = read('app/league/[leagueId]/draft/page.tsx')
  const leagueSettingsModal = read('app/league/[leagueId]/components/LeagueSettingsModal.tsx')
  const commissionerSettingsModal = read('app/league/[leagueId]/components/CommissionerSettingsModal.tsx')

  it('uses production tab labels without changing tab ids or URLs', () => {
    expect(leagueShell).toContain("{ id: 'trades', label: 'Trades' }")
    expect(leagueShell).toMatch(/if \(tab\.id === 'trades'\) return \{ \.\.\.tab, label: 'Trades' \}/)
    expect(leagueShell).toMatch(
      /if \(tab\.id === 'league' && isCommissioner\) return \{ \.\.\.tab, label: 'Commissioner Hub' \}/,
    )
    expect(leagueTabs).toContain("{ id: 'trades', label: 'Trade Center' }")
    expect(translations).toContain('"league.tab.trades": "Trade Center"')
    expect(leagueShell).toContain("case 'trades':")
    expect(leagueShell).toContain("case 'league':")
  })

  it('defaults the league homepage to the 40/35/25 dashboard shell with collapsible rails', () => {
    expect(leagueShell).toContain('defaultCollapsed: false')
    expect(leagueShell).toContain('leftRailCollapsed={!desktopChatOpen}')
    expect(leagueShell).toContain('rightRailCollapsed={myLeaguesRail.collapsed}')
    expect(appShell).toContain('minmax(280px,40fr)_minmax(0,35fr)_minmax(240px,25fr)')
    expect(appShell).toContain('chat-rail-collapse')
    expect(appShell).toContain('app-shell-right-rail')
    expect(appShell).toContain('myleagues-rail-expand')
  })

  it('replaces the pre-draft dead end with draft room, settings, and mock draft actions', () => {
    expect(leagueShell).toContain('Draft setup is ready')
    expect(leagueShell).not.toContain('Draft room is not open yet')
    expect(leagueShell).toContain('data-testid="predraft-open-draft-room"')
    expect(leagueShell).toContain('href={`/league/${leagueId}/draft`}')
    expect(leagueShell).toContain('Open Live Draft Room')
    expect(leagueShell).toContain("onOpenLeagueSettingsModal('draft')")
    expect(leagueShell).toContain('data-testid="predraft-start-mock-draft"')
    expect(leagueShell).toContain('Start mock draft')
  })

  it('uses the existing draft service and materializer before entering the draft room', () => {
    expect(draftResolver).toContain("import { getOrCreateDraftSession }")
    expect(draftResolver).toContain("import { autoMaterializeDraftForLeague }")
    expect(draftResolver).toContain('const { session: draftSession } = await getOrCreateDraftSession(leagueId)')
    expect(draftResolver).toContain("draftSession.status === 'pre_draft'")
    expect(draftResolver).toContain("updatedDraftSession.status === 'pre_draft'")
    expect(draftResolver).toContain('await autoMaterializeDraftForLeague(leagueId)')
    expect(draftResolver).not.toMatch(/rounds:\s*15/)
  })

  it('settings modals have close button, overlay, Escape, and scroll-lock cleanup paths', () => {
    expect(leagueSettingsModal).toContain('aria-label="Close settings"')
    expect(leagueSettingsModal).toContain("if (e.key !== 'Escape') return")
    expect(leagueSettingsModal).toContain('const handleCloseAll = useCallback')
    expect(leagueSettingsModal).toContain("document.body.style.overflow = 'hidden'")
    expect(leagueSettingsModal).toContain('document.body.style.overflow = prev')
    expect(leagueSettingsModal).toContain('setActivePanel(null)')

    expect(commissionerSettingsModal).toContain('aria-label="Close settings"')
    expect(commissionerSettingsModal).toContain('e.target === e.currentTarget && onClose()')
    expect(commissionerSettingsModal).toContain("if (event.key === 'Escape') onClose()")
    expect(commissionerSettingsModal).toContain("document.body.style.overflow = 'hidden'")
    expect(commissionerSettingsModal).toContain('document.body.style.overflow = previousOverflow')
  })
})
