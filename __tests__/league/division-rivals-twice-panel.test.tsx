/**
 * The division settings panel's "Play division rivals twice" toggle: it loads from the saved config,
 * is sent on save, flips the schedule note, and reads in Spanish without «waiver».
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[lang.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: lang.language, t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: lang.language, t }) }
})

import { DivisionSettingsCommissionerPanel } from '@/components/league-settings/DivisionSettingsCommissionerPanel'

const teams = [1, 2, 3, 4].map((i) => ({ id: `t${i}`, teamName: `T${i}`, ownerName: null, avatarUrl: null }))
function stub(rivalsTwice?: boolean) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () =>
      init?.method === 'PUT'
        ? { ok: true, config: { ...JSON.parse(String(init.body)), lastUpdatedAt: null, lastUpdatedBy: null } }
        : {
            isCommissioner: true,
            isSurvivor: false,
            config: { count: 2, names: ['East', 'West'], teamAssignments: { t1: 0, t2: 0, t3: 1, t4: 1 }, aiNamingEnabled: false, playoffRule: 'top_seeds', ...(rivalsTwice === undefined ? {} : { rivalsTwice }), lastUpdatedAt: null, lastUpdatedBy: null },
            teams,
          },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
afterEach(() => { lang.language = 'en'; vi.unstubAllGlobals(); cleanup() })

describe('Play division rivals twice', () => {
  it('starts off, and turning it on sends rivalsTwice and changes the note', async () => {
    const fetchMock = stub()
    const r = render(<DivisionSettingsCommissionerPanel leagueId="l1" />)
    const box = (await r.findByTestId('division-rivals-twice')) as HTMLInputElement
    expect(box.checked).toBe(false)
    expect(r.getByTestId('division-schedule-note').textContent).toBe('The schedule plays division rivals first, then everyone else once.')
    fireEvent.click(box)
    expect(r.getByTestId('division-schedule-note').textContent).toContain('each division rival a second time with home and away swapped')
    fireEvent.click(r.getByText(/^Save/))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'PUT')).toBe(true))
    const put = fetchMock.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === 'PUT')!
    expect(JSON.parse(String((put[1] as RequestInit).body))).toMatchObject({ rivalsTwice: true, playoffRule: 'top_seeds' })
  })

  it('loads a saved "on", and reads in Spanish with no «waiver»', async () => {
    stub(true)
    lang.language = 'es'
    const r = render(<DivisionSettingsCommissionerPanel leagueId="l1" />)
    const box = (await r.findByTestId('division-rivals-twice')) as HTMLInputElement
    expect(box.checked).toBe(true)
    expect(r.container.textContent).toContain('Jugar dos veces contra los rivales de división')
    expect(r.getByTestId('division-schedule-note').textContent).toContain('cambiando local y visitante')
    expect(r.container.textContent?.toLowerCase()).not.toContain('waiver')
    expect(r.container.textContent).not.toMatch(/\bdivision\.[a-zA-Z]/)
  })
})
