/**
 * League home for an IMPORTED league (2026-11-22): imported and native leagues share one Overview. What only an
 * AllFantasy-hosted league has stays off an import, most of all the seat tracker, which read a 140-team Fantrax
 * league with one linked team as "1 of 140 joined" and offered invites to a league AllFantasy does not host. The
 * same render with `imported` off is the control: it shows the seats.
 */
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NativeLeagueHome } from '@/components/league/native/NativeLeagueHome'

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({}) }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const league = {
  id: 'imp1', name: 'Road To Glory', platform: 'fantrax', sport: 'NCAAF', season: 2026, teamCount: 140, format: 'dynasty',
  scoring: 'College', currentWeek: 12, lifecycleState: 'in_season', isDynasty: true, leagueType: 'dynasty', settings: {},
} as never

const team = (id: string, teamName: string, wins: number, claimedByUserId: string | null = null) => ({
  id, externalId: id, teamName, ownerName: teamName, avatarUrl: null, role: 'member', isOrphan: false, claimedByUserId,
  draftPosition: null, wins, losses: 24 - wins, ties: 0, pointsFor: wins * 150, pointsAgainst: 0, currentRank: null,
  faabRemaining: null, waiverPriority: null,
}) as never

/** One claimed team out of a 140-team league: the case that read "1 of 140 joined". */
const TEAMS = [team('a', 'Iowa State', 23), team('b', 'Louisiana', 23), team('me', 'Georgia Tech', 16, 'viewer')]
const IMPORTED_TABS = ['native_home', 'decide', 'roster', 'matchups', 'standings', 'trades', 'activity']

function renderHome(imported: boolean, availableTabIds: string[] = IMPORTED_TABS) {
  return render(
    <NativeLeagueHome league={league} teams={TEAMS} userTeamId="me" isCommissioner draftDateIso={null} snapshot={null}
      settingsOpen={false} onOpenSettings={() => {}} onSelectTab={() => {}} availableTabIds={availableTabIds} imported={imported} />,
  )
}

const text = () => document.body.textContent ?? ''

describe('League home for an imported league', () => {
  it('control: the same league rendered as native shows the seat tracker', () => {
    renderHome(false)
    expect(text()).toMatch(/joined/i)
  })

  it('shows no seats, invites, setup checklist or seat-based league health', () => {
    renderHome(true)
    expect(text()).not.toMatch(/joined/i)
    expect(text()).not.toMatch(/invite/i)
    expect(screen.queryByTestId('native-home-replay-intro')).toBeNull()
    expect(fetchMock.mock.calls.some(([u]) => /dynasty-hub|rules-explainer|matchup-center/.test(String(u)))).toBe(false)
  })

  it('keeps your team, the standings and the week', () => {
    renderHome(true)
    expect(text()).toContain('Georgia Tech')
    expect(text()).toContain('Iowa State')
    expect(text()).toContain('Week 12')
    expect(text()).toContain('Open matchup')
  })

  it('offers league chat only when the league has a chat tab', () => {
    renderHome(true)
    expect(text()).not.toContain('Open league chat')
    cleanup()
    renderHome(true, [...IMPORTED_TABS, 'league_chat'])
    expect(text()).toContain('Open league chat')
  })

  it('hides a button whose tab the imported league does not have', () => {
    renderHome(true)
    expect(screen.queryByRole('button', { name: 'Players' })).toBeNull()
    expect(screen.getByRole('button', { name: 'My team' })).toBeTruthy()
  })
})
