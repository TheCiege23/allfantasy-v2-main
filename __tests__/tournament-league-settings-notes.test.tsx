/**
 * Tournament conference leagues on the league settings screens:
 *   - co-commissioners added by the tournament who hold no team are listed (the managers list is
 *     built from rosters, so it never showed them);
 *   - the league playoff fields are replaced by "Playoffs are run by the tournament".
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})
vi.mock('@/components/subscription/SubscriptionGateModal', () => ({ SubscriptionGateModal: () => null }))
vi.mock('@/hooks/useLeagueSettingsSectionAutosave', () => ({
  useLeagueSettingsSectionAutosave: () => ({ queuePatch: vi.fn(), saving: false }),
}))

import { PlayoffsTab } from '@/components/league-settings/tabs/PlayoffsTab'
import { readTournamentCoCommissioners, SeatlessCoCommissioners } from '@/components/league-settings/TournamentLeagueNotes'
import MemberSettingsPanel from '@/components/app/settings/MemberSettingsPanel'
import { buildConferenceSeasonPlan, CONFERENCE_SEASON_PLAN_KEY } from '@/lib/tournament/divisions/conferenceSeasonPlan'
import { defaultFormatSettings } from '@/lib/tournament/divisions/engine'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ stages: [], sport: 'NFL', isPremium: true, config: null }) })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const plan = buildConferenceSeasonPlan('t1', defaultFormatSettings('NFL'))
const ctx = (settings: Record<string, unknown>) =>
  ({ league: { id: 'L', sport: 'NFL', platform: 'allfantasy', teams: [], leagueSize: 12, playoffTeams: 6, playoffStartWeek: 15, settings } }) as never

describe('playoff fields on a tournament conference league', () => {
  it('are replaced by the tournament note', () => {
    render(<PlayoffsTab ctx={ctx({ [CONFERENCE_SEASON_PLAN_KEY]: plan })} canEdit hasAfCommissionerSub={false} />)
    const note = screen.getByTestId('tournament-playoffs-note')
    expect(note.textContent).toContain('Playoffs are run by the tournament')
    expect(note.textContent).toContain('through week 17')
    expect(note.textContent).toContain('weeks 11–17')
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled() // the stage editor is not mounted
  })

  it('an ordinary league keeps its playoff fields', () => {
    render(<PlayoffsTab ctx={ctx({})} canEdit hasAfCommissionerSub={false} />)
    expect(screen.queryByTestId('tournament-playoffs-note')).toBeNull()
    expect(screen.getAllByRole('spinbutton').length).toBeGreaterThan(0)
  })
})

describe('seatless tournament co-commissioners', () => {
  const people = readTournamentCoCommissioners({
    tournamentCoCommissioners: [
      { userId: 'co1', username: 'jules', displayName: 'Jules', hasTeam: false },
      { userId: 'co2', username: 'sam', displayName: 'Sam', hasTeam: true },
      { bogus: true },
    ],
  })

  it('parses the managers route list defensively', () => {
    expect(people.map(p => p.userId)).toEqual(['co1', 'co2'])
    expect(readTournamentCoCommissioners({})).toEqual([])
  })

  it('lists only the co-commissioners who hold no team', () => {
    render(<SeatlessCoCommissioners people={people} />)
    const section = screen.getByTestId('tournament-co-commissioners')
    expect(section.textContent).toContain('Jules')
    expect(section.textContent).not.toContain('Sam')
  })

  it('renders nothing when every co-commissioner has a team, or there are none', () => {
    const { container } = render(<SeatlessCoCommissioners people={people.filter(p => p.hasTeam)} />)
    expect(container.innerHTML).toBe('')
  })

  it('the member settings screen shows them from the managers route', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ managers: [], tournamentCoCommissioners: [{ userId: 'co1', username: 'jules', displayName: 'Jules', hasTeam: false }] }) })
    render(<MemberSettingsPanel leagueId="L" />)
    const section = await screen.findByTestId('tournament-co-commissioners')
    expect(section.textContent).toContain('Jules')
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/commissioner/leagues/L/managers')
  })
})
