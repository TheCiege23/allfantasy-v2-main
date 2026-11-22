/**
 * The "Lineups: Daily / Weekly" control in the commissioner settings (roster tab), in English and
 * Spanish. It saves through the settings PATCH (`lineupMode`) and shows the server's refusal — a
 * season under way, daily not available yet — in the reader's language, reverting the choice.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { translations } from '@/lib/i18n/translations'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[lang.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: lang.language, t, setLanguage: () => {} }) }
})

import { LineupModeSetting } from '@/app/league/[leagueId]/components/settings/LineupModeSetting'

const SRC = resolve(__dirname, '../../app/league/[leagueId]/components/settings/LineupModeSetting.tsx')

const fetchMock = vi.fn()

beforeEach(() => {
  lang.language = 'en'
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const radio = (name: RegExp) => screen.getByRole('radio', { name })

describe('LineupModeSetting', () => {
  it('every key it uses exists in English AND Spanish', () => {
    const src = readFileSync(SRC, 'utf8')
    const keys = new Set([...src.matchAll(/['"](lineupMode\.[A-Za-z.]+)['"]/g)].map((x) => x[1]!))
    expect(keys.size).toBeGreaterThanOrEqual(10)
    for (const k of keys) {
      expect(translations.en[k], `en ${k}`).toBeTruthy()
      expect(translations.es[k], `es ${k}`).toBeTruthy()
      expect(translations.es[k]).not.toBe(translations.en[k])
    }
  })

  it('shows both modes with a one-line explanation, weekly selected by default', () => {
    render(<LineupModeSetting leagueId="L" sport="NBA" initialMode={null} canEdit />)
    expect(radio(/Weekly/)).toBeChecked()
    expect(radio(/Daily/)).not.toBeChecked()
    expect(screen.getByText(/only the days he starts count/)).toBeTruthy()
    expect(screen.getByText(/each starter scores his full week/)).toBeTruthy()
  })

  it('reads in Spanish', () => {
    lang.language = 'es'
    render(<LineupModeSetting leagueId="L" sport="MLB" initialMode="daily" canEdit />)
    expect(screen.getByText('Alineaciones')).toBeTruthy()
    expect(radio(/Diarias/)).toBeChecked()
    expect(radio(/Semanales/)).not.toBeChecked()
  })

  it('renders nothing outside NBA, NHL and MLB', () => {
    const { container } = render(<LineupModeSetting leagueId="L" sport="NFL" initialMode="weekly" canEdit />)
    expect(container.innerHTML).toBe('')
  })

  it('saves lineupMode through the settings PATCH', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    render(<LineupModeSetting leagueId="L" sport="NHL" initialMode="weekly" canEdit />)
    fireEvent.click(radio(/Daily/))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/league/settings')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ leagueId: 'L', lineupMode: 'daily' })
    await waitFor(() => expect(radio(/Daily/)).toBeChecked())
  })

  it('a refused switch reverts and says why, in the reader’s language', async () => {
    lang.language = 'es'
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ code: 'lineup_mode_season_in_progress', error: 'x' }) })
    render(<LineupModeSetting leagueId="L" sport="NBA" initialMode="weekly" canEdit />)
    fireEvent.click(radio(/Diarias/))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(translations.es['lineupMode.err.seasonInProgress'])
    expect(radio(/Semanales/)).toBeChecked()
  })

  it('is read-only for a member who cannot edit', () => {
    render(<LineupModeSetting leagueId="L" sport="NBA" initialMode="weekly" canEdit={false} />)
    expect(radio(/Daily/)).toBeDisabled()
  })
})
