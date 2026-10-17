// @vitest-environment jsdom
/**
 * Trades and Matchup leftovers from the live Spanish sweep (2026-10-05): every roster player's
 * "30-day value up/down N" tooltip, an unpriced asset's "No value: <reason>", the "<name>'s roster"
 * heading, and Matchup's OUT/BYE chip. Each renders the real component in Spanish with an English
 * control; the helper pins include the template-order trap that half-translated a pick's reason.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k, tInterpolate: (k: string) => k }),
}))
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
}))

import { StockMark, UnpricedValue } from '@/components/core-app/screens/TradeAssetPicker'
import Matchup from '@/components/core-app/screens/Matchup'
import { tradeVisualCopy } from '@/lib/core-app/tradeVisualCopy'
import type { MatchupData, MatchupPlayerCell } from '@/lib/core-app/matchup'

afterEach(() => {
  cleanup()
  h.language = 'en'
})

const titleOf = (el: Element | null) => el?.getAttribute('title') ?? null

describe('Trades — the roster row marks', () => {
  it('the 30-day value mark, both directions and flat', () => {
    h.language = 'es'
    const up = render(<StockMark stock="up" delta={179} />).container.querySelector('.af-tc-stock')
    expect(titleOf(up)).toBe('Valor a 30 días: sube 179')
    expect(up?.getAttribute('aria-label')).toBe('Valor a 30 días: sube 179')
    cleanup()
    expect(titleOf(render(<StockMark stock="down" delta={-71} />).container.querySelector('.af-tc-stock'))).toBe('Valor a 30 días: baja 71')
    cleanup()
    expect(titleOf(render(<StockMark stock="flat" />).container.querySelector('.af-tc-stock'))).toBe('Valor a 30 días: sin cambios reales')
  })

  it('an unpriced asset says why, in Spanish', () => {
    h.language = 'es'
    const el = render(
      <UnpricedValue reason={{ code: 'not_on_feed', label: 'Not among the ~400 players our value feed prices' }} />,
    ).container.querySelector('[data-unpriced]')
    expect(titleOf(el)).toBe('Sin valor: No está entre los ~400 jugadores que valora nuestra fuente')
  })

  it('CONTROL — English is unchanged', () => {
    expect(titleOf(render(<StockMark stock="up" delta={179} />).container.querySelector('.af-tc-stock'))).toBe('30-day value up 179')
    cleanup()
    expect(
      titleOf(
        render(<UnpricedValue reason={{ code: 'not_on_feed', label: 'Not among the ~400 players our value feed prices' }} />).container.querySelector(
          '[data-unpriced]',
        ),
      ),
    ).toBe('No value: Not among the ~400 players our value feed prices')
  })
})

describe('tradeVisualCopy — the new entries', () => {
  it('every reason shape, the roster heading, and names untouched', () => {
    const es = (s: string) => tradeVisualCopy(s, 'es')
    expect(es('No value')).toBe('Sin valor')
    expect(es("No value: Our value feed doesn't price kickers")).toBe('Sin valor: Nuestra fuente de valores no valora a los pateadores')
    expect(es('No value: No values on file for NBA players')).toBe('Sin valor: No hay valores registrados de jugadores de NBA')
    expect(es("No value: Not on today's market board — the only value on file is from a 2026-02-01 snapshot, which is not today's market")).toBe(
      'Sin valor: No está en el mercado de hoy: el único valor registrado es de una instantánea del 2026-02-01, que no es el mercado actual',
    )
    expect(es("TheCiege26's roster")).toBe('Plantilla de TheCiege26')
    expect(tradeVisualCopy("TheCiege26's roster", 'en')).toBe("TheCiege26's roster")
  })

  it('🛑 a pick reason is not taken by the generic "{0} round {1}" template first', () => {
    // Before the fix this read "Sin valor: No market value for a 2027 ronda 2 pick in this league's format".
    expect(tradeVisualCopy("No value: No market value for a 2027 round 2 pick in this league's format", 'es')).toBe(
      'Sin valor: No hay valor de mercado para una selección de 2027, ronda 2, en el formato de esta liga',
    )
    // CONTROL — the generic template still does its own job.
    expect(tradeVisualCopy('2027 round 2', 'es')).toBe('2027 ronda 2')
  })
})

function cell(id: string, name: string, over: Partial<MatchupPlayerCell> = {}): MatchupPlayerCell {
  return {
    playerId: id, sleeperId: id, name, position: 'RB', team: 'DET', sport: 'NFL', imageUrl: null,
    projected: 12, afEngine: null, actual: null, empty: false, unavailable: null, gameState: 'upcoming', ...over,
  }
}

function matchupData(): MatchupData {
  return {
    league: { id: 'l1', name: 'Liga Prueba', platform: 'sleeper', logoUrl: null, sourceLink: null, lineupLink: null },
    week: { available: true, data: { week: 5, season: 2026, isFinal: false } },
    teams: {
      available: true,
      data: {
        you: { teamName: 'Mine', ownerName: 'me', record: '3-1', isYou: true, avatarUrl: null },
        opponent: { teamName: 'Theirs', ownerName: 'them', record: '2-2', isYou: false, avatarUrl: null },
      },
    },
    sides: { available: false, reason: 'not scored yet' },
    lineups: {
      available: true,
      data: [
        { slotLabel: 'RB', you: cell('1', 'Bye Guy', { projected: 0, unavailable: 'bye' }), opponent: cell('2', 'Out Guy', { projected: 0, unavailable: 'out' }) },
      ],
    },
    identityNote: null,
    playerScoring: { available: false, reason: 'projections' },
    winProbability: { available: false, reason: 'n/a' },
    projectedFinal: { available: false, reason: 'n/a' },
    yetToPlay: { available: false, reason: 'tally' },
    starterCountsBySide: null,
  } as MatchupData
}

describe('Matchup — the unavailable chip', () => {
  const chips = (language: 'en' | 'es') => {
    h.language = language
    const { container } = render(<Matchup data={matchupData()} />)
    return [...container.querySelectorAll('.af-mu-flag')].map((e) => e.textContent)
  }
  it('reads DESCANSO / FUERA in Spanish', () => {
    expect(chips('es')).toEqual(['DESCANSO', 'FUERA'])
  })
  it('CONTROL — BYE / OUT in English', () => {
    expect(chips('en')).toEqual(['BYE', 'OUT'])
  })
})
