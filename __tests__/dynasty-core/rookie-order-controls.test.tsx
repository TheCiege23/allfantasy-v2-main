import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DevySettingsPanel } from '@/components/devy/DevySettingsPanel'
import DynastySettingsPanel from '@/components/app/settings/DynastySettingsPanel'

afterEach(() => vi.unstubAllGlobals())
describe('rookie draft order settings', () => {
  it('does not offer or resave the unused Devy rookie-order field', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => init?.method === 'PUT' ? {} : { config: { rookiePickOrderMethod: 'lottery', devyPickOrderMethod: 'custom', devySlotCount: 3, taxiSize: 0, rookieDraftRounds: 3, devyDraftRounds: 3, bestBallEnabled: false, startupDraftType: 'snake', rookieDraftType: 'linear', devyDraftType: 'linear', earlyDeclareBehavior: 'allow', devyPickTradeRules: 'allowed', rookiePickTradeRules: 'allowed', nflDevyExcludeKDST: true, promotionTiming: 'manager_choice_before_rookie_draft', dispersalDevyFAEnabled: false, rightsExpirationEnabled: false } } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<DevySettingsPanel leagueId="league-1" isCommissioner />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const body = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))
    expect(body).not.toHaveProperty('rookiePickOrderMethod')
    expect(body.devyPickOrderMethod).toBe('custom')
    expect(screen.queryByText('Rookie pick order')).toBeNull()
  })
  it('saves changes to lottery settings without requiring an unrelated settings edit', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => init?.method === 'PUT' ? {} : ({
      isDynasty: true,
      effective: { rookiePickOrderMethod: 'weighted_lottery', rookieDraftRounds: 4, rookieDraftType: 'linear' },
      constants: { rookiePickOrderMethods: [{ value: 'commissioner', label: 'Commissioner' }, { value: 'weighted_lottery', label: 'Weighted lottery' }] },
      lotteryEligibility: { eligible: false, isStartupLeague: true },
    }) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<DynastySettingsPanel leagueId="league-1" isCommissioner />)
    fireEvent.change(await screen.findByLabelText('Teams in lottery'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/draft-lottery/config') && init?.method === 'PUT')).toBe(true))
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/draft-lottery/config'))!
    expect(JSON.parse(String(call[1]?.body)).lotteryConfig.lotteryTeamCount).toBe(4)
  })
  it('directs standings and Max PF to automatic order instead of offering ineffective choices', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
      isDynasty: true,
      effective: { rookiePickOrderMethod: 'max_pf', useMaxPfForNonPlayoff: true, rookieDraftRounds: 4, rookieDraftType: 'linear' },
      constants: { rookiePickOrderMethods: [{ value: 'max_pf', label: 'Reverse Max PF' }, { value: 'reverse_standings', label: 'Reverse standings' }, { value: 'commissioner', label: 'Commissioner override' }, { value: 'weighted_lottery', label: 'Weighted lottery' }] },
    }) })))
    render(<DynastySettingsPanel leagueId="league-1" isCommissioner />)
    const select = await screen.findByLabelText('Rookie draft order source') as HTMLSelectElement
    expect([...select.options].map((option) => option.value)).toEqual(['commissioner', 'weighted_lottery'])
    expect(select.value).toBe('commissioner')
    expect(screen.getByText(/Set automatic order by standings or Max PF in Draft Settings/)).toBeTruthy()
    expect(screen.queryByLabelText('Max PF for non-playoff')).toBeNull()
  })
})
