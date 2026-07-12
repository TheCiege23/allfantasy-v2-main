import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NFL_REDRAFT_CORE_TAB_IDS, getLeagueTabs } from '@/app/league/[leagueId]/LeagueTabs'

const root = resolve(__dirname, '..', '..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

describe('G57 league experience visual system', () => {
  it('keeps NFL and NCAAF on the same complete redraft navigation contract', () => {
    expect(NFL_REDRAFT_CORE_TAB_IDS).toContain('players')
    expect(getLeagueTabs('NFL')).toEqual(getLeagueTabs('NCAAF'))
    expect(getLeagueTabs('NCAAF').find((tab) => tab.id === 'roster')?.label).toBe('My Team')
    expect(getLeagueTabs('NCAAF').some((tab) => tab.id === 'players')).toBe(true)
    const shell = read('app/league/[leagueId]/LeagueShell.tsx')
    const playersCase = shell.slice(shell.indexOf("case 'players':"), shell.indexOf("case 'waivers':"))
    expect(playersCase).toContain('<PlayersTab')
    expect(playersCase).not.toContain('<SportAwareWaiverWire')
  })

  it('uses one actionable state system without exposing raw schedule or standings errors', () => {
    const state = read('components/league/LeagueSurfaceState.tsx')
    const schedule = read('app/league/[leagueId]/tabs/redraft/CanonicalRedraftScheduleTab.tsx')
    const standings = read('app/league/[leagueId]/tabs/redraft/RedraftStandingsPlayoffsView.tsx')

    expect(state).toContain("type LeagueSurfaceStateKind = 'loading' | 'empty' | 'error' | 'permission'")
    expect(state).toContain("role={kind === 'error' || kind === 'permission' ? 'alert' : 'status'}")
    expect(schedule).toContain('actionLabel="Retry schedule"')
    expect(schedule).not.toContain('{error}')
    expect(standings).toContain('actionLabel="Retry standings"')
    expect(standings).not.toContain('{error}')
  })

  it('makes league identity sport-aware and removes NFL-only NCAAF roster guidance', () => {
    const shell = read('app/league/[leagueId]/LeagueShell.tsx')
    const home = read('components/league-home/NflRedraftLeagueHomeDashboard.tsx')

    expect(shell).toContain('data-testid="league-header-sport-badge"')
    expect(shell).toContain("headerSportLabel === 'NCAAF'")
    expect(home).toContain("const footballLabel = isNcaaf ? 'NCAAF' : 'NFL'")
    expect(home).toContain('upcoming games')
    expect(home).toContain('Ask League Coach')
  })

  it('uses safe retry copy for matchup and trade failures', () => {
    const matchup = read('components/matchup-center/MatchupTabContainer.tsx')
    const trades = read('app/league/[leagueId]/tabs/TradesTab.tsx')

    expect(matchup).toContain('actionLabel="Retry matchup"')
    expect(matchup).toContain('Your lineup was not changed.')
    expect(trades).toContain('actionLabel="Retry trades"')
    expect(trades).toContain('Nothing was changed. Try again.')
  })
})
