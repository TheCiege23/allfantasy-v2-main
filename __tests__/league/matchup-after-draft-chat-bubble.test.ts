/**
 * Owner, 2026-11-28: "there should be no matchup tab or screen until after the draft because the system auto
 * creates the schedule after the draft concludes" and "chat should not be a tab, it should remain in the chat
 * bubble".
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildNativeLeagueNavigation, nativeNavLeafIds } from '@/lib/league/nativeLeagueNavigation'

const TABS = ['native_home', 'draft', 'matchups', 'schedule', 'scores', 'roster', 'waivers', 'standings', 'league_chat', 'trades', 'news', 'settings'].map((id) => ({ id, label: id }))
const topIds = (groups: ReturnType<typeof buildNativeLeagueNavigation>) => groups[0].items.map((item) => item.label)

describe('Matchup waits for the schedule', () => {
  it('a hosted league before its draft has no Matchup tab and no matchup, schedule or scores screen in the nav', () => {
    const groups = buildNativeLeagueNavigation(TABS, true, false, undefined, { draftDone: false, scheduleMade: false })
    expect(topIds(groups)).not.toContain('Matchup')
    const leaves = nativeNavLeafIds(groups)
    for (const id of ['matchups', 'schedule', 'scores']) expect(leaves).not.toContain(id)
  })

  it('after the draft (or an import, whose host makes the schedule) Matchup is there', () => {
    expect(topIds(buildNativeLeagueNavigation(TABS, true, false, undefined, { draftDone: true, scheduleMade: true }))).toContain('Matchup')
    // A caller that does not say keeps Matchup: hiding it needs a positive "no schedule yet".
    expect(topIds(buildNativeLeagueNavigation(TABS, true))).toContain('Matchup')
  })

  it('the workspace passes "no schedule" only for a hosted league that has not drafted', () => {
    const ws = readFileSync(resolve(__dirname, '../../components/league/native/NativeLeagueWorkspace.tsx'), 'utf8')
    expect(ws).toContain('scheduleMade: draftDone || !isNativePlatform(league.platform)')
  })

  it('a matchup link opened before the draft gets the after-the-draft note, not an empty week', () => {
    const shell = readFileSync(resolve(__dirname, '../../app/league/[leagueId]/LeagueShell.tsx'), 'utf8')
    expect(shell).toMatch(/case 'matchup':\n\s*\/\/[^\n]*\n\s*if \(isPredraftLifecycle\) return <MatchupAfterDraftNote/)
  })
})

describe('Chat is the bubble, not a tab', () => {
  it('league chat is never in the nav, before or after the draft', () => {
    for (const opts of [{ draftDone: false, scheduleMade: false }, { draftDone: true, scheduleMade: true }]) {
      expect(nativeNavLeafIds(buildNativeLeagueNavigation(TABS, true, false, undefined, opts))).not.toContain('league_chat')
    }
  })

  it('the bottom bar has no Chat button', () => {
    const ws = readFileSync(resolve(__dirname, '../../components/league/native/NativeLeagueWorkspace.tsx'), 'utf8')
    expect(ws).toContain("{[homeLeafId, draftSlot ? 'draft' : 'matchups', 'roster', 'waivers'].map(")
    expect(ws).not.toMatch(/'waivers', 'league_chat'\]\.map\(/)
  })

  it('every way of asking for the chat tab opens the bubble on this league instead', () => {
    const shell = readFileSync(resolve(__dirname, '../../app/league/[leagueId]/LeagueShell.tsx'), 'utf8')
    expect(shell).toContain("window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail: { tab: 'league', leagueId: league.id } }))")
    // Clicks, screens and deep links: all three routes divert league_chat.
    expect(shell.match(/if \(t === 'league_chat' && workspaceShell\) \{\n\s*openLeagueChatBubble\(\)\n\s*return/g)?.length).toBe(2)
    expect(shell).toContain("if (activeTab !== 'league_chat' || !workspaceShell) return")
    expect(shell.match(/onSelectTab=\{selectScreenTab\}/g)?.length).toBe(2)
  })
})

describe('League page: no Matchups section before the schedule exists', () => {
  it('a hosted league that has not drafted has no schedule yet; one in season, or an import, does', async () => {
    const { noScheduleYet } = await import('@/components/league/native/screens/NativeLeaguePageScreen')
    expect(noScheduleYet({ platform: 'allfantasy', lifecycleState: 'pre_draft', status: null } as never)).toBe(true)
    expect(noScheduleYet({ platform: 'allfantasy', lifecycleState: 'drafting', status: null } as never)).toBe(true)
    expect(noScheduleYet({ platform: 'allfantasy', lifecycleState: 'in_season', status: null } as never)).toBe(false)
    expect(noScheduleYet({ platform: 'sleeper', lifecycleState: 'pre_draft', status: null } as never)).toBe(false)
    // No lifecycle at all is not read as "before the draft".
    expect(noScheduleYet({ platform: 'allfantasy', lifecycleState: null, status: null } as never)).toBe(false)
    const page = readFileSync(resolve(__dirname, '../../components/league/native/screens/NativeLeaguePageScreen.tsx'), 'utf8')
    expect(page).toContain('{noScheduleYet(league) ? null : <LeagueWeekMatchups leagueId={league.id} />}')
  })
})

describe('Activity filters match the other league screens', () => {
  it('use the shared segmented switch, not their own green pills', () => {
    const src = readFileSync(resolve(__dirname, '../../components/league/LeagueActivityTab.tsx'), 'utf8')
    expect(src).toMatch(/role="group" aria-label="Filter activity" className="nls-seg"/)
    const block = src.slice(src.indexOf('aria-label="Filter activity"'), src.indexOf('{failed ?'))
    expect(block).not.toContain('--lsk-accent-strong')
    expect(block).not.toContain('style={\n')
  })
})
