/**
 * Owner, 2026-11-28: "move every sport's league home onto the same screen". Every AllFantasy-hosted
 * redraft league, any sport, opens League home on the one simple screen; other formats keep theirs.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UserLeague, UserLeagueTeam } from '@/app/dashboard/types'
import { isRedraftFormatUserLeague } from '@/lib/league/is-nfl-redraft-core-dashboard'

vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ hasPro: true, hasSupreme: false, hasCommissioner: false }) }))
vi.mock('@/components/redraft/RedraftCommunicationPanel', () => ({ RedraftCommunicationPanel: () => null }))
vi.mock('@/components/dashboard/ManagerReplayInsightsCard', () => ({ ManagerReplayInsightsCard: () => null }))

import { NflRedraftLeagueHomeDashboard } from '@/components/league-home/NflRedraftLeagueHomeDashboard'

const base = { id: 'L1', name: 'Test', platform: 'allfantasy', format: 'redraft', teamCount: 10, leagueType: 'redraft' }
const teams = [{ id: 't1', teamName: 'Mine', ownerName: 'me', claimedByUserId: 'u1' }] as unknown as UserLeagueTeam[]

describe('which leagues get the simple League home', () => {
  it('every sport\'s plain redraft league; not dynasty, keeper, best ball, guillotine or a specialty variant', () => {
    for (const sport of ['NFL', 'MLB', 'NBA', 'NHL', 'NCAAB', 'SOCCER']) {
      expect(isRedraftFormatUserLeague({ ...base, sport } as UserLeague)).toBe(true)
    }
    expect(isRedraftFormatUserLeague({ ...base, sport: 'MLB', isDynasty: true } as UserLeague)).toBe(false)
    expect(isRedraftFormatUserLeague({ ...base, sport: 'MLB', bestBallMode: true } as UserLeague)).toBe(false)
    expect(isRedraftFormatUserLeague({ ...base, sport: 'MLB', guillotineMode: true } as UserLeague)).toBe(false)
    expect(isRedraftFormatUserLeague({ ...base, sport: 'MLB', keeperPhaseActive: true } as UserLeague)).toBe(false)
    expect(isRedraftFormatUserLeague({ ...base, sport: 'MLB', leagueVariant: 'survivor' } as UserLeague)).toBe(false)
    expect(isRedraftFormatUserLeague({ ...base, sport: 'MLB', leagueType: 'dynasty' } as UserLeague)).toBe(false)
  })

  it('the League home button routes every hosted league there, Survivor included; imports after', () => {
    const shell = readFileSync(resolve(__dirname, '../../app/league/[leagueId]/LeagueShell.tsx'), 'utf8')
    const nativeHome = shell.slice(shell.indexOf("case 'native_home': {"), shell.indexOf("case 'home':"))
    const simple = nativeHome.indexOf('<NflRedraftLeagueHomeDashboard')
    expect(nativeHome).toMatch(/\n\s*if \(!importedWhatsNext\) \{\n\s*const stakesFormat = stakesFormatFor\(selectedLeague\)/)
    // Survivor's island is its Island tab; the home no longer mounts the whole board.
    expect(nativeHome).not.toContain('<SurvivorNativeHome')
    expect(shell).toMatch(/SIMPLE_HOME_FORMAT_TABS = new Set\(\[\n\s*'survivor', 'survivor_tribal', 'survivor_challenges', 'survivor_jury'/)
    expect(simple).toBeLessThan(nativeHome.indexOf('<NativeLeagueHome'))
    // Dynasty and specialty formats keep "What's next?" (engine turns, the format walkthrough) as their one card.
    expect(nativeHome).toContain('nextSlot={plainRedraft ? undefined : whatsNext}')
    expect(nativeHome).toContain('formatRows={tabDefs.filter((item) => SIMPLE_HOME_FORMAT_TABS.has(item.id))}')
  })
})

describe('the simple home on a non-football league', () => {
  const mlbTabs = ['native_home', 'roster', 'draft', 'team', 'matchups', 'league', 'standings', 'ai_coaching', 'league_chat']

  it('MLB in season: reads its phase without the season row, and uses the sport\'s own tab ids', () => {
    const onOpenTab = vi.fn()
    render(
      <NflRedraftLeagueHomeDashboard league={{ ...base, sport: 'MLB', lifecycleState: 'in_season', currentWeek: 3 } as UserLeague}
        leagueId="L1" teamSlots={teams} isCommissioner={false} draftDateIso={null} hasActiveRedraftSeason={false}
        onOpenSettings={vi.fn()} onOpenTab={onOpenTab} availableTabIds={mlbTabs} rulesSlot={<div data-testid="rules-slot" />} />,
    )
    expect(screen.getByTestId('g32-home-status')).toHaveTextContent('Week 3')
    expect(screen.getByTestId('rules-slot')).toBeInTheDocument()
    // The rules slot replaces the members' rules row.
    expect(screen.queryByTestId('g32-home-row-settings')).toBeNull()
    fireEvent.click(screen.getByTestId('g32-home-row-intelligence'))
    expect(onOpenTab).toHaveBeenLastCalledWith('ai_coaching')
  })

  it('soccer: Squad and Table stand in for roster and standings; a missing tab drops its row', () => {
    const onOpenTab = vi.fn()
    render(
      <NflRedraftLeagueHomeDashboard league={{ ...base, sport: 'SOCCER', lifecycleState: 'in_season' } as UserLeague}
        leagueId="L1" teamSlots={teams} isCommissioner={false} draftDateIso={null} hasActiveRedraftSeason
        onOpenSettings={vi.fn()} onOpenTab={onOpenTab} availableTabIds={['native_home', 'squad', 'table', 'fixtures']} />,
    )
    fireEvent.click(screen.getByTestId('g32-home-row-roster'))
    expect(onOpenTab).toHaveBeenLastCalledWith('squad')
    fireEvent.click(screen.getByTestId('g32-home-row-standings'))
    expect(onOpenTab).toHaveBeenLastCalledWith('table')
    expect(screen.queryByTestId('g32-home-row-chat')).toBeNull()
  })

  it('off-season: Season complete, Final standings', () => {
    const onOpenTab = vi.fn()
    render(
      <NflRedraftLeagueHomeDashboard league={{ ...base, sport: 'NBA', lifecycleState: 'completed' } as UserLeague}
        leagueId="L1" teamSlots={teams} isCommissioner={false} draftDateIso={null} hasActiveRedraftSeason
        onOpenSettings={vi.fn()} onOpenTab={onOpenTab} availableTabIds={mlbTabs} />,
    )
    expect(screen.getByRole('heading', { name: 'Season complete' })).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('g32-home-next-action'))
    expect(onOpenTab).toHaveBeenLastCalledWith('standings')
  })
})

describe('dynasty and specialty formats on the simple home', () => {
  it('a dynasty league reads its format, shows its format rows, and its next slot replaces the draft card', () => {
    const onOpenTab = vi.fn()
    render(
      <NflRedraftLeagueHomeDashboard league={{ ...base, sport: 'NFL', leagueType: 'dynasty', isDynasty: true } as UserLeague}
        leagueId="L1" teamSlots={teams} isCommissioner={false} draftDateIso={null} hasActiveRedraftSeason={false}
        onOpenSettings={vi.fn()} onOpenTab={onOpenTab} availableTabIds={['native_home', 'roster', 'dynasty_picks', 'dynasty_taxi']}
        formatRows={[{ id: 'dynasty_picks', label: 'Picks' }, { id: 'dynasty_taxi', label: 'Taxi' }]}
        nextSlot={<div data-testid="whats-next-slot" />} formatSlot={<div data-testid="stakes-slot" />} />,
    )
    expect(screen.getByTestId('g32-home-status')).toHaveTextContent(/NFL · Dynasty/i)
    expect(screen.getByTestId('whats-next-slot')).toBeInTheDocument()
    expect(screen.queryByTestId('g32-home-next')).toBeNull()
    expect(screen.getByTestId('stakes-slot')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('g32-home-row-format-dynasty_picks'))
    expect(onOpenTab).toHaveBeenLastCalledWith('dynasty_picks')
  })
})

