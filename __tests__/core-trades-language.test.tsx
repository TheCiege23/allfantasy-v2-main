import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { TradesData, TradeRecord } from '@/lib/core-app/trades'
import { tradeUiCopy } from '@/lib/core-app/tradeUiCopy'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: 'es' }),
}))

import Trades from '@/components/core-app/screens/Trades'

afterEach(cleanup)

describe('Trades Spanish view', () => {
  it('names both sides of a completed trade without losing its assets', () => {
    const record = {
      transactionId: 'tx-1', season: 2026, week: 1, rosterIds: ['1', '2'], yourSide: 'in',
      playersIn: 1, playersOut: 1, picks: 0, partnerTeamName: 'Rivales', at: new Date('2026-09-05T22:16:13Z'),
      players: [
        { manager: 'Tu equipo', isYou: true, received: [{ sleeperId: '1', name: 'Jugador A', position: 'RB', team: 'ATL' }] },
        { manager: 'Rivales', isYou: false, received: [{ sleeperId: '2', name: 'Jugador B', position: 'WR', team: 'DET' }] },
      ],
    } as TradeRecord
    const data = {
      league: { id: 'l1', name: 'Liga Uno', platform: 'sleeper' },
      gradingContext: { available: false, reason: 'no grading context' },
      deadline: { available: false, reason: 'this league’s trade deadline is not ingested' },
      inbox: { available: true, data: [] }, sent: { available: true, data: [] },
      history: { available: true, data: [record] },
      grades: { available: false, reason: 'no trades on file for this league' },
      canonicalHistory: true,
    } as unknown as TradesData

    render(<Trades data={data} />)
    expect(document.body.textContent).toContain('Recibiste')
    expect(document.body.textContent).toContain('Rivales recibió')
    expect(screen.getByRole('button', { name: 'Jugador A' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Jugador B' })).toBeTruthy()
  })

  it('explains the league scope, deadline, offers and completed history', () => {
    const data = {
      league: { id: 'l1', name: 'Liga Uno', platform: 'sleeper' },
      gradingContext: { available: true, data: { leagueName: 'Liga Uno', format: 'Dinastía', teamCount: 12 } },
      deadline: { available: true, data: { none: true, week: null, regularSeasonLength: null } },
      inbox: { available: true, data: [] },
      sent: { available: true, data: [] },
      history: { available: true, data: [] },
      grades: { available: false, reason: 'no trades on file for this league' },
    } as unknown as TradesData

    render(<Trades data={data} />)
    expect(document.body.textContent).toContain('Calificado solo para esta liga')
    expect(document.body.textContent).toContain('Sin fecha límite')
    expect(screen.getByRole('heading', { name: 'Recibidas' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Intercambios completados' })).toBeTruthy()
    expect(document.body.textContent).toContain('No hay intercambios registrados en esta liga')
  })

  it('keeps trade grade amounts and timing in translated explanations', () => {
    expect(tradeUiCopy('Gridiron Vultures got the better end — Tú got 7,200 in league value for 9,000.', 'es'))
      .toContain('tú recibiste 7,200 por 9,000')
    expect(tradeUiCopy("Graded on this league's values when first graded Sep 5 (Dynasty · 12 teams).", 'es'))
      .toContain('cuando se calificó por primera vez Sep 5')
  })
})
