/** The Trade Settings panel: the veto threshold is votes by default, switchable to a percent, in EN + ES. */
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ language: lang.language }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import TradeSettingsPanel from '@/components/app/settings/TradeSettingsPanel'
import { TRADE_SETTINGS_COPY } from '@/lib/i18n/trade-settings-copy'

let saved: Record<string, unknown> | null = null
beforeEach(() => {
  saved = null
  global.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') saved = JSON.parse(String(init.body))
    return { ok: true, json: async () => ({ settings: { trade_review_mode: 'league_vote', vetoThreshold: 5, vetoThresholdMode: 'count' } }) } as Response
  }) as never
})

describe('TradeSettingsPanel veto threshold', () => {
  it('shows the saved number as votes, and saves the mode with it', async () => {
    lang.language = 'en'
    render(<TradeSettingsPanel leagueId="L1" />)
    await waitFor(() => expect(screen.getByTestId('commissioner-veto-threshold-value').textContent).toBe('5 veto votes'))
    fireEvent.click(screen.getByTestId('commissioner-trade-edit'))
    fireEvent.change(screen.getByTestId('commissioner-veto-mode-select'), { target: { value: 'percent' } })
    fireEvent.change(screen.getByTestId('commissioner-veto-threshold-input'), { target: { value: '60' } })
    fireEvent.click(screen.getByTestId('commissioner-trade-save'))
    await waitFor(() => expect(saved).toMatchObject({ vetoThreshold: 60, vetoThresholdMode: 'percent' }))
  })

  it('a league with no threshold reads 4 votes, in Spanish too', async () => {
    lang.language = 'es'
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ settings: {} }) }) as Response) as never
    render(<TradeSettingsPanel leagueId="L1" />)
    await waitFor(() => expect(screen.getByTestId('commissioner-veto-threshold-value').textContent).toBe('4 votos de veto (predeterminado)'))
    expect(screen.getByText('Ajustes de intercambios')).toBeTruthy()
  })

  it('every string has English and Spanish with the same placeholders, and no «waiver»', () => {
    const ph = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
    for (const [k, v] of Object.entries(TRADE_SETTINGS_COPY)) {
      expect(v.en && v.es, k).toBeTruthy()
      expect(ph(v.es), k).toEqual(ph(v.en))
      expect(v.es.toLowerCase(), k).not.toContain('waiver')
    }
  })
})
