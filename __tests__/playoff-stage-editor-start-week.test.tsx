/**
 * Native League Settings → Playoffs: the stage/bracket editor shows the commissioner's chosen
 * playoff start week (from the quick field) read-only, never a computed sport default.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})
vi.mock('@/components/subscription/SubscriptionGateModal', () => ({ SubscriptionGateModal: () => null }))
const queuePatch = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useLeagueSettingsSectionAutosave', () => ({
  useLeagueSettingsSectionAutosave: () => ({ queuePatch, saving: false }),
}))

import { PlayoffSettingsEditor } from '@/components/league-settings/PlayoffSettingsEditor'
import { TradesTab } from '@/components/league-settings/tabs/TradesTab'
import { buildLeagueSettingsHome } from '@/lib/league-settings-home/buildLeagueSettingsHome'
import { PlayoffsTab } from '@/components/league-settings/tabs/PlayoffsTab'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  queuePatch.mockClear()
  // The stored stage config still holds an old sport-default week (14).
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      stages: [],
      sport: 'NFL',
      isPremium: true,
      config: { sport: 'NFL', includedStages: [], startMode: 'default', adjustedPlayoffStartWeek: 14, adjustedPlayoffWeeks: 3, premiumFeaturesUsed: false },
    }),
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PlayoffSettingsEditor start week', () => {
  it('🛑 native: shows the chosen week read-only with a pointer to the quick field', async () => {
    render(<PlayoffSettingsEditor leagueId="L" playoffStartWeek={12} />)
    const row = await screen.findByTestId('playoff-stage-start-week')
    expect(row.textContent).toContain('Week 12')
    expect(row.textContent).toContain('Quick schedule')
    expect(screen.queryByText(/Playoffs start Week 14/)).toBeNull()
  })

  it('imported (no prop): unchanged — no read-only row', async () => {
    render(<PlayoffSettingsEditor leagueId="L" />)
    await waitFor(() => expect(screen.queryByText(/Playoffs start Week 14/)).not.toBeNull())
    expect(screen.queryByTestId('playoff-stage-start-week')).toBeNull()
  })
})

describe('PlayoffsTab seeds both editors from the chosen week', () => {
  const ctx = (league: Record<string, unknown>) =>
    ({ league: { id: 'L', sport: 'NFL', teams: [], leagueSize: 12, playoffTeams: 6, ...league } }) as never

  it('🛑 native: the quick field and the stage editor both show the column week', async () => {
    render(<PlayoffsTab ctx={ctx({ platform: 'manual', playoffStartWeek: 13, settings: { playoffStartWeek: 14 } })} canEdit hasAfCommissionerSub={false} />)
    expect((screen.getByRole('spinbutton', { name: /Playoffs start/i }) as HTMLInputElement).value).toBe('13')
    const row = await screen.findByTestId('playoff-stage-start-week')
    expect(row.textContent).toContain('Week 13')
  })

  it('native with no column: falls back to the JSON copy, not 14', async () => {
    render(<PlayoffsTab ctx={ctx({ platform: 'manual', playoffStartWeek: null, settings: { playoff_structure: { playoff_start_week: 16 } } })} canEdit hasAfCommissionerSub={false} />)
    expect((screen.getByRole('spinbutton', { name: /Playoffs start/i }) as HTMLInputElement).value).toBe('16')
    expect((await screen.findByTestId('playoff-stage-start-week')).textContent).toContain('Week 16')
  })
})


describe('NBA settings use the saved rules and sport calendar', () => {
  const league = { id: 'L', sport: 'NBA', platform: 'manual', leagueSize: 16, teams: [], playoffTeams: null, playoffStartWeek: null, tradeDeadlineWeek: null, settings: { playoff_structure: { playoff_start_week: 22 } } }
  const ctx = { league } as never

  it('the playoff summary matches the editor when the columns are unset', () => {
    const sections = buildLeagueSettingsHome({ league, teams: [], canEdit: true, formatLabel: 'Redraft', scoringLabel: null, rosterSlots: null, draft: null, guillotine: null, inviteUrl: '' })
    expect(sections.flatMap(s => s.rows).find(r => r.id === 'playoffs')?.value).toBe('6 teams · starts Wk 22')
  })

  it('accepts the NBA chosen week and later season weeks, while rejecting overflow', async () => {
    render(<PlayoffsTab ctx={ctx} canEdit hasAfCommissionerSub={false} />)
    const field = screen.getByRole('spinbutton', { name: /Playoffs start/i }) as HTMLInputElement
    await screen.findByTestId('playoff-stage-start-week')
    expect(field.value).toBe('22')
    expect(field.validity.valid).toBe(true)
    fireEvent.change(field, { target: { value: '23' } })
    expect(queuePatch).toHaveBeenLastCalledWith({ playoffStartWeek: 23 })
    queuePatch.mockClear()
    fireEvent.change(field, { target: { value: '26' } })
    expect(queuePatch).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: '' } })
    expect(queuePatch).not.toHaveBeenCalled()
    const teams = screen.getByRole('spinbutton', { name: /Playoff teams/i })
    fireEvent.change(teams, { target: { value: '1' } })
    expect(queuePatch).not.toHaveBeenCalled()
    fireEvent.change(teams, { target: { value: '8' } })
    expect(queuePatch).toHaveBeenLastCalledWith({ playoffTeams: 8 })
  })

  it('shows no deadline instead of inventing week 14 and can clear a deadline', () => {
    render(<TradesTab ctx={ctx} canEdit hasAfCommissionerSub={false} />)
    const field = screen.getByRole('spinbutton', { name: /Trade deadline/i }) as HTMLInputElement
    expect(field.value).toBe('')
    expect(field.placeholder).toContain('No deadline')
    const review = screen.getByRole('spinbutton', { name: /Review window/i })
    fireEvent.change(review, { target: { value: '' } })
    fireEvent.change(review, { target: { value: '169' } })
    expect(queuePatch).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: '22' } })
    expect(queuePatch).toHaveBeenLastCalledWith({ tradeDeadlineWeek: 22 })
    fireEvent.change(field, { target: { value: '' } })
    expect(queuePatch).toHaveBeenLastCalledWith({ tradeDeadlineWeek: null })
    queuePatch.mockClear()
    fireEvent.change(field, { target: { value: '26' } })
    expect(queuePatch).not.toHaveBeenCalled()
  })
})


describe('weekly sport range compatibility', () => {
  it('retains NFL week 18 for trade deadlines', () => {
    const ctx = { league: { id: 'L', sport: 'NFL', tradeDeadlineWeek: 14 } } as never
    render(<TradesTab ctx={ctx} canEdit hasAfCommissionerSub={false} />)
    const field = screen.getByRole('spinbutton', { name: /Trade deadline/i }) as HTMLInputElement
    fireEvent.change(field, { target: { value: '18' } })
    expect(field.validity.valid).toBe(true)
    expect(queuePatch).toHaveBeenLastCalledWith({ tradeDeadlineWeek: 18 })
  })
  it('retains NFL week 18 for playoff scheduling', async () => {
    const ctx = { league: { id: 'L', sport: 'NFL', platform: 'manual', playoffStartWeek: 15, leagueSize: 12 } } as never
    render(<PlayoffsTab ctx={ctx} canEdit hasAfCommissionerSub={false} />)
    await screen.findByTestId('playoff-stage-start-week')
    const field = screen.getByRole('spinbutton', { name: /Playoffs start/i }) as HTMLInputElement
    fireEvent.change(field, { target: { value: '18' } })
    expect(field.validity.valid).toBe(true)
    expect(queuePatch).toHaveBeenLastCalledWith({ playoffStartWeek: 18 })
  })
})
