import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const lang = vi.hoisted(() => ({ language: 'es' as 'es' | 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  // The real catalog, so the card's keys resolve exactly as in the app.
  const { translations: dict } = await import('@/lib/i18n/translations')
  const { interpolateTemplate } = await import('@/lib/i18n/interpolate')
  const t = (k: string) => dict[lang.language]?.[k] ?? dict.en[k] ?? k
  return {
    useOptionalLanguage: () => ({ language: lang.language, t, tInterpolate: (k: string, v: Record<string, string | number> = {}) => interpolateTemplate(t(k), v) }),
  }
})

import { SideContestsCard } from '@/components/league/native/screens/SideContestsCard'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); lang.language = 'es' })

const ON = { high_score: { enabled: true, prizeCents: 2000 }, closest_loss: { enabled: true, prizeCents: 1000 } }
const OFF = { high_score: { enabled: false, prizeCents: 0 }, closest_loss: { enabled: false, prizeCents: 0 } }
const view = (over: Record<string, unknown> = {}) => ({
  native: true,
  canEdit: false,
  config: ON,
  season: 2026,
  weeks: [{
    week: 2,
    contests: {
      high_score: [
        { rosterId: 'A', value: 130, prizeCents: 1000, teamName: 'Aces' },
        { rosterId: 'C', value: 130, prizeCents: 1000, teamName: 'Cats' },
      ],
      closest_loss: [{ rosterId: 'D', value: 1.5, prizeCents: 1000, teamName: 'Dogs', opponentRosterId: 'B', opponentName: 'Bees' }],
    },
  }],
  totals: [{ rosterId: 'A', teamName: 'Aces', wins: { high_score: 1, closest_loss: 0 }, prizeCents: 1000 }],
  ...over,
})
const stub = (v: unknown) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => v })))

describe('weekly prizes card in Spanish', () => {
  it('reads the week, the tie, the share and the money in Spanish', async () => {
    stub(view())
    render(<SideContestsCard leagueId="L" />)
    expect((await screen.findByTestId('side-contest-high_score')).textContent).toBe(
      'Puntuación más alta de la semana: Aces y Cats, 130.00 puntos (empate) · $10 cada uno',
    )
    expect(screen.getByTestId('side-contest-closest_loss').textContent).toBe('Derrota más ajustada: Dogs, perdió por 1.50 ante Bees · $10')
    expect(screen.getByText('Premios semanales')).toBeTruthy()
    expect(screen.getByText('Semana 2')).toBeTruthy()
    expect(screen.getByText('Premios de la temporada')).toBeTruthy()
  })

  it('the commissioner sets it up in Spanish', async () => {
    stub(view({ canEdit: true, config: OFF, weeks: [], totals: [] }))
    render(<SideContestsCard leagueId="L" />)
    expect(await screen.findByText(/Premia la puntuación más alta de la semana/)).toBeTruthy()
    fireEvent.click(screen.getByText('Configurar'))
    fireEvent.click(screen.getByTestId('side-contest-toggle-high_score'))
    expect(screen.getByText('Premio por semana $')).toBeTruthy()
    expect(screen.getByText('El equipo con más puntos de la semana.')).toBeTruthy()
    expect(screen.getByText(/Un empate reparte el premio/)).toBeTruthy()
    expect(screen.getByText('Guardar')).toBeTruthy()
    expect(screen.getByText('Cancelar')).toBeTruthy()
  })

  it('no English left on the member view', async () => {
    stub(view())
    const { container } = render(<SideContestsCard leagueId="L" />)
    await screen.findByTestId('side-contest-high_score')
    expect(container.textContent).not.toMatch(/\b(Weekly|points|lost by|each|tie|Season|Week|Earlier)\b/)
  })

  it('English is unchanged', async () => {
    lang.language = 'en'
    stub(view())
    render(<SideContestsCard leagueId="L" />)
    expect((await screen.findByTestId('side-contest-high_score')).textContent).toBe('Weekly high score: Aces and Cats, 130.00 points (tie) · $10 each')
  })
})
