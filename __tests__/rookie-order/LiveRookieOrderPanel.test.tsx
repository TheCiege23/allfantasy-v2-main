import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[lang.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: lang.language, t, setLanguage: () => {} }) }
})

import { LiveRookieOrderPanel } from '@/components/league-settings/LiveRookieOrderPanel'
import { translations } from '@/lib/i18n/translations'

const config = { nonPlayoff: 'reverse_max_pf', playoff: 'finish_then_seed', withinRound: 'worse_seed' }
function liveView(over: Record<string, unknown> = {}) {
  return {
    draftSeason: 2027,
    basedOnSeason: 2026,
    source: 'imported',
    preview: false,
    canAutomate: true,
    automationActive: false,
    notes: ['Seeds are re-derived from record, then points for (Sleeper default seeding).'],
    settings: { enabled: false, config, enabledForSeason: null, finalOrder: null },
    result: {
      phase: 'playoffs',
      maxPfSource: 'max_pf',
      warnings: [],
      config,
      slots: [
        { slot: 1, teamId: 'n1', name: 'Gridiron Ghosts', group: 'non_playoff', status: 'locked', finish: null, reason: '1288.4 max PF — 1st lowest of 1 non-playoff teams' },
        { slot: 2, teamId: 's3', name: 'Taxi Squad', group: 'playoff', status: 'locked', finish: 'Lost in Semifinal', reason: 'Lost in Semifinal (seed 3)' },
        { slot: 3, teamId: 's2', name: 'Rookie Rush', group: 'playoff', status: 'provisional', finish: 'Alive (seed 2)', reason: 'Still alive in the playoffs' },
      ],
    },
    ...over,
  }
}

const fetchMock = vi.fn()
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })

beforeEach(() => {
  lang.language = 'en'
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('LiveRookieOrderPanel', () => {
  it('shows each slot with its pick, reason, and locked or pending state', async () => {
    fetchMock.mockReturnValueOnce(json(liveView()))
    render(<LiveRookieOrderPanel leagueId="L1" />)

    await screen.findByText('Gridiron Ghosts')
    expect(screen.getByText('1.01')).toBeTruthy()
    expect(screen.getByText('Lost in Semifinal (seed 3)')).toBeTruthy()
    expect(screen.getAllByText('Locked')).toHaveLength(2)
    expect(screen.getAllByText('Pending')).toHaveLength(1)
    expect(screen.getByText('Playoffs')).toBeTruthy()
    expect(screen.getByText(/Sleeper default seeding/)).toBeTruthy()
  })

  it('imported league: shows how to set the order on its platform; a native league does not', async () => {
    fetchMock.mockReturnValueOnce(json(liveView({ platform: 'sleeper' })))
    const { unmount } = render(<LiveRookieOrderPanel leagueId="L1" />)
    await screen.findByText('Gridiron Ghosts')
    expect(screen.getByTestId('imported-order-checklist')).toBeTruthy()
    expect(screen.getByText('Set this order on Sleeper')).toBeTruthy()
    expect(screen.getByText('Put Gridiron Ghosts at pick 1.')).toBeTruthy()
    // Two slots still wait on playoff games, so it says so first.
    expect(screen.getByText(/not final yet/)).toBeTruthy()
    unmount()

    fetchMock.mockReturnValueOnce(json(liveView({ source: 'native', platform: 'allfantasy' })))
    render(<LiveRookieOrderPanel leagueId="L1" />)
    await screen.findByText('Gridiron Ghosts')
    expect(screen.queryByTestId('imported-order-checklist')).toBeNull()
  })

  it('previews a setting change without saving it', async () => {
    fetchMock.mockReturnValueOnce(json(liveView())).mockReturnValueOnce(json(liveView({ preview: true })))
    render(<LiveRookieOrderPanel leagueId="L1" />)
    await screen.findByText('Gridiron Ghosts')

    fireEvent.change(screen.getByLabelText('Non-playoff teams'), { target: { value: 'reverse_record' } })

    await screen.findByText('Preview, not saved')
    const url = String(fetchMock.mock.calls[1][0])
    expect(url).toContain('/rookie-draft-order/live?')
    expect(url).toContain('nonPlayoff=reverse_record')
    expect(fetchMock.mock.calls[1][1]?.method).toBeUndefined()
  })

  it('saves the automation switch and settings with PUT', async () => {
    fetchMock
      .mockReturnValueOnce(json(liveView()))
      .mockReturnValueOnce(json({ ok: true }))
      .mockReturnValueOnce(json(liveView({ settings: { enabled: true, config, enabledForSeason: 2026, finalOrder: null } })))
    render(<LiveRookieOrderPanel leagueId="L1" />)
    await screen.findByText('Gridiron Ghosts')

    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByText('Save rookie order settings'))

    await screen.findByText('Rookie order settings saved')
    const [, init] = fetchMock.mock.calls[1]
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ enabled: true, config })
  })

  it('without AF Commissioner the switch is off-limits and an upgrade link is shown', async () => {
    fetchMock.mockReturnValueOnce(json(liveView({ canAutomate: false })))
    render(<LiveRookieOrderPanel leagueId="L1" />)
    await screen.findByText('Gridiron Ghosts')

    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Upgrade to AF Commissioner').getAttribute('href')).toBe('/upgrade?plan=commissioner')
  })

  it('tells the commissioner when there is no season data yet', async () => {
    fetchMock.mockReturnValueOnce(json({ error: 'No season data' }, 404))
    render(<LiveRookieOrderPanel leagueId="L1" />)
    await screen.findByText(translations.en['lsEd.dr.live.noData'])
  })

  it('renders its own labels in Spanish', async () => {
    lang.language = 'es'
    fetchMock.mockReturnValueOnce(json(liveView({ result: { ...liveView().result, phase: 'final' } })))
    render(<LiveRookieOrderPanel leagueId="L1" />)
    await screen.findByText('Gridiron Ghosts')

    for (const key of ['lsEd.dr.live.title', 'lsEd.dr.live.nonPlayoff', 'lsEd.dr.live.auto', 'lsEd.dr.live.phase.final', 'lsEd.dr.live.locked']) {
      const es = translations.es[key]
      expect(es, key).toBeTruthy()
      await waitFor(() => expect(screen.getAllByText(es).length).toBeGreaterThan(0))
    }
  })
})
