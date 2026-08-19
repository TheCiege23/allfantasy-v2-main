import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('redraft production smoke blockers', () => {
  const leagueShell = read('app/league/[leagueId]/LeagueShell.tsx')
  const leagueSettingsModal = read('app/league/[leagueId]/components/LeagueSettingsModal.tsx')
  const rosterSettingsEditor = read('components/league-settings/RosterSettingsEditor.tsx')
  const rosterRowControl = read('components/league-settings/roster/RosterRowControl.tsx')
  const draftRoomShell = read('components/app/draft-room/DraftRoomShell.tsx')
  const rosterSettings = read('app/league/[leagueId]/components/settings/RosterComplianceSettingsPanel.tsx')
  const draftSettings = read('app/league/[leagueId]/components/settings/DraftSettingsPanel.tsx')
  const commissionerModal = read('components/app/draft-room/CommissionerControlCenterModal.tsx')
  const draftRoomClient = read('components/app/draft-room/DraftRoomPageClient.tsx')
  const draftRightDock = read('components/app/draft-room/DraftRightDockTabs.tsx')
  const draftControls = read('app/api/leagues/[leagueId]/draft/controls/route.ts')
  const commissionerHook = read('hooks/useCommissionerActions.ts')
  const draftChat = read('components/app/draft-room/DraftChatPanel.tsx')
  const mockPage = read('app/mock-draft/page.tsx')
  const mockClient = read('components/mock-draft/MockDraftSleeperRoomClient.tsx')

  it('uses clear pre-draft actions and opens one league settings modal source', () => {
    expect(leagueShell).toContain('Open Live Draft Room')
    expect(leagueShell).toContain("onOpenLeagueSettingsModal('draft')")
    expect(leagueShell).toContain('setCommissionerSettingsOpen(false)')
    expect(leagueSettingsModal).toContain("isCommissioner && initialActivePanel === 'draft'")
    expect(leagueSettingsModal).toContain('setActivePanel(null)')
    expect(leagueShell).not.toContain('Open draft room setup')
  })

  it('settings modal closes through a single close-all path', () => {
    expect(leagueSettingsModal).toContain('const handleCloseAll = useCallback')
    expect(leagueSettingsModal).toMatch(/onClick=\{handleCloseAll\}/)
    expect(leagueSettingsModal).toMatch(/if \(e\.key !== 'Escape'\) return[\s\S]*?handleCloseAll\(\)/)
    expect(leagueSettingsModal).toContain("document.body.style.overflow = 'hidden'")
    expect(leagueSettingsModal).toContain('document.body.style.overflow = prev')
  })

  it('roster settings show polished standard redraft slot controls including Superflex default 0', () => {
    expect(rosterSettings).toContain("key: 'SF'")
    expect(rosterSettings).toContain("label: 'Superflex (QB/RB/WR/TE)'")
    expect(rosterSettings).toContain('defaultValue: 0')
    expect(rosterSettings).toContain('data-testid="roster-slot-controls"')
    expect(rosterSettings).toContain('data-testid={`roster-slot-${testKey}`}')
    expect(rosterSettings).toContain('SLOT_BADGE_CLASS')
    expect(rosterSettings).toContain('Advanced reserve settings')
    expect(rosterSettingsEditor).toContain('SUPERFLEX: 0')
    expect(rosterSettingsEditor).toContain('next.SUPERFLEX = Number(next.SF || 0)')
    expect(rosterSettingsEditor).toContain("normalized === 'NFL' || normalized === 'NCAAF'")
    expect(rosterSettingsEditor).toContain("['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DEF', 'BN', 'IR']")
    expect(rosterRowControl).toContain("QB: 'bg-red-400'")
    expect(rosterRowControl).toContain("RB: 'bg-emerald-400'")
    expect(rosterRowControl).toContain("WR: 'bg-sky-400'")
    expect(rosterRowControl).toContain("SUPERFLEX: 'bg-violet-400'")
  })

  it('draft room uses viewport-constrained internal scrolling for the heavy player pool', () => {
    expect(draftRoomShell).toContain('h-[100dvh]')
    expect(draftRoomShell).toContain('overflow-hidden')
    expect(draftRoomShell).toContain('data-testid="draft-premium-main-zones"')
  })

  it('regular redraft draft settings do not show dynasty carryover copy', () => {
    expect(draftSettings).not.toContain('Dynasty carryover draft defaults')
    expect(draftSettings).not.toContain('dynastyCarryover')
  })

  it('commissioner control center delegates to the single room settings modal', () => {
    expect(commissionerModal).toContain('onOpenDraftRoomSettings?: () => void')
    expect(commissionerModal).toContain('onOpenDraftRoomSettings?.()')
    expect(commissionerModal).not.toMatch(/<DraftSettingsModal/)
    expect(commissionerModal).not.toContain('Run keeper automation')
    expect(commissionerModal).toContain('hasDevyDraftConfig')
    expect(commissionerModal).toContain('hasC2CDraftConfig')
  })

  it('start and resume enforce pool readiness while warming the player pool in the background', () => {
    const startIdx = draftControls.indexOf("if (action === 'start')")
    const resumeIdx = draftControls.indexOf("if (action === 'resume')")
    const startBlock = draftControls.slice(startIdx, startIdx + 1400)
    const resumeBlock = draftControls.slice(resumeIdx, resumeIdx + 1400)
    expect(startBlock).toContain('getDraftPoolReadiness(leagueId)')
    expect(startBlock).toContain('triggerDraftPoolPrewarmBackground(leagueId)')
    expect(startBlock).toContain("code: 'POOL_NOT_READY'")
    expect(startBlock).toContain('startDraftSession(leagueId)')
    expect(resumeBlock).toContain('getDraftPoolReadiness(leagueId)')
    expect(resumeBlock).toContain('triggerDraftPoolPrewarmBackground(leagueId)')
    expect(resumeBlock).toContain('resumeDraftSession(leagueId)')
    expect(resumeBlock).not.toContain("code: 'POOL_NOT_READY'")
    expect(resumeBlock).toContain('resume proceeding while pool warms')
    expect(commissionerHook).not.toMatch(/action === 'pause' \|\| action === 'resume' \|\| \(action === 'start'/)
  })

  it('draft chat scrolls internally instead of moving the whole page', () => {
    expect(draftChat).toContain('data-testid="draft-chat-scroll-root"')
    expect(draftChat).toContain('el.scrollTop = el.scrollHeight')
    expect(draftChat).not.toContain('bottomRef.current?.scrollIntoView')
  })

  it('War Room is visible inside the draft room dock and popup', () => {
    expect(draftRightDock).toContain("id: 'war_room', label: 'AF Legacy'")
    expect(draftRightDock).toContain('warRoomBody?: ReactNode')
    expect(draftRoomClient).toContain('warRoomBody=')
    expect(draftRoomClient).toContain('<DraftTeamPanel {...draftTeamPanelProps} />')
    expect(draftRoomClient).toContain('War Room')
  })

  it('league-scoped mock drafts skip the chooser and provide league exits', () => {
    expect(mockPage).toContain('initialLeagueId')
    expect(mockPage).toContain('initialSport')
    expect(mockClient).toContain('autoLoadedLeagueRef')
    expect(mockClient).toContain("platform: 'allfantasy'")
    expect(mockClient).toContain('const requestLeagueId = league.navigationLeagueId ?? league.unifiedLeagueId ?? league.id')
    expect(mockClient).toContain('void loadLeaguePayload(match)')
    expect(mockClient).toContain('data-testid="mock-draft-back-to-league"')
    expect(mockClient).toContain('data-testid="mock-draft-back-to-draft-room"')
    expect(mockClient).not.toMatch(/CafeConChimmy|cafeconchimmy/i)
  })
})
