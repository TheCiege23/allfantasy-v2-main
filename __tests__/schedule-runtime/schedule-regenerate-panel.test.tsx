/**
 * The commissioner "Regenerate schedule" panel: asks before a mid-season rebuild, re-sends with the
 * confirmation flag only on Confirm, shows refusals in the viewer's language, and renders EN and ES.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { translations } from '@/lib/i18n/translations'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => {
    const t = (key: string) => translations[lang.language]?.[key] ?? translations.en[key] ?? key
    return {
      language: lang.language,
      t,
      tInterpolate: (key: string, vars: Record<string, string | number>) =>
        Object.entries(vars).reduce((s, [k, v]) => s.replace(`{{${k}}}`, String(v)), t(key)),
    }
  },
}))

import { ScheduleRegeneratePanel } from '@/app/league/[leagueId]/tabs/redraft/ScheduleRegeneratePanel'

const fetchMock = vi.fn()
function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}
const sentBodies = () => fetchMock.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)))

beforeEach(() => {
  lang.language = 'en'
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ScheduleRegeneratePanel', () => {
  it('before the season: one request, no confirmation, reports the first rebuilt week', async () => {
    const onChanged = vi.fn()
    respond(200, { ok: true, regeneratedFromWeek: 1, warnings: [] })
    render(<ScheduleRegeneratePanel seasonId="S1" onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate schedule' }))
    await screen.findByText('Schedule rebuilt from week 1.')
    expect(sentBodies()).toEqual([{ seasonId: 'S1', confirmMidSeasonChange: false, action: 'regenerate' }])
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('mid-season: asks, and Confirm re-sends the same request with the flag', async () => {
    respond(409, { code: 'mid_season_confirmation_required', error: 'x' })
    respond(200, { ok: true, regeneratedFromWeek: 6, warnings: [] })
    render(<ScheduleRegeneratePanel seasonId="S1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate schedule' }))
    await screen.findByRole('alertdialog')
    expect(screen.getByText('The season has started')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild remaining weeks' }))
    await screen.findByText('Schedule rebuilt from week 6.')
    expect(sentBodies()).toEqual([
      { seasonId: 'S1', confirmMidSeasonChange: false, action: 'regenerate' },
      { seasonId: 'S1', confirmMidSeasonChange: true, action: 'regenerate' },
    ])
  })

  it('mid-season: Cancel sends nothing further', async () => {
    respond(409, { code: 'mid_season_confirmation_required', error: 'x' })
    render(<ScheduleRegeneratePanel seasonId="S1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate schedule' }))
    await screen.findByRole('alertdialog')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await screen.findByText('Schedule not changed.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['DRAFT_IN_PROGRESS', 'en', "The schedule can't be regenerated while a draft is in progress. Try again once it finishes."],
    ['LEAGUE_ARCHIVED', 'es', 'No se puede regenerar el calendario de una liga archivada.'],
    ['NO_REGENERABLE_WEEKS', 'es', 'Todas las semanas de la temporada regular ya comenzaron, así que no queda nada por regenerar.'],
  ] as const)('refusal %s is shown in %s', async (code, language, text) => {
    lang.language = language
    respond(409, { code, error: 'server english' })
    render(<ScheduleRegeneratePanel seasonId="S1" />)
    fireEvent.click(screen.getAllByRole('button')[0]!)
    await screen.findByText(text)
  })

  it('renders in Spanish, including the confirmation', async () => {
    lang.language = 'es'
    respond(409, { code: 'mid_season_confirmation_required', error: 'x' })
    respond(200, { ok: true, regeneratedFromWeek: 4, warnings: [] })
    render(<ScheduleRegeneratePanel seasonId="S1" />)
    expect(screen.getByRole('heading', { name: 'Regenerar calendario' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Regenerar calendario' }))
    await screen.findByText('La temporada ya comenzó')
    fireEvent.click(screen.getByRole('button', { name: 'Reconstruir semanas restantes' }))
    await waitFor(() => expect(screen.getByText('Calendario reconstruido desde la semana 4.')).toBeTruthy())
  })

  it('every schedRegen key has a Spanish value different from the English one', () => {
    const keys = Object.keys(translations.en).filter((k) => k.startsWith('schedRegen.'))
    expect(keys.length).toBe(14)
    for (const k of keys) {
      expect(translations.es[k], k).toBeTruthy()
      expect(translations.es[k], k).not.toBe(translations.en[k])
    }
  })
})
