import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const fetchTradesPanel = vi.fn()
vi.mock('@/components/core-app/screens/tradesPanelFetch', () => ({
  fetchTradesPanel: (...args: unknown[]) => fetchTradesPanel(...args),
}))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: 'es' }),
}))

import { TradeInbox } from '@/components/core-app/screens/TradeInbox'
import { TradeProposePanel, proposalBlockCopy } from '@/components/core-app/screens/TradeProposePanel'

afterEach(() => { cleanup(); fetchTradesPanel.mockReset() })

describe('Core trade actions in Spanish', () => {
  it('explains what Sleeper does not share and retains the manual entry action', async () => {
    fetchTradesPanel.mockResolvedValue({ ok: true, data: {
      activeTrades: [], historyTrades: [], pendingOffers: [],
      pending: { scanned: true, reason: null, platform: 'sleeper', leagueUrl: 'https://sleeper.com', weeksUnanswered: 0 },
    } })
    render(<TradeInbox leagueId="lg" view="offers" onLoad={() => {}} onEnterByHand={() => {}} />)
    expect(await screen.findByText('Las ofertas pendientes de Sleeper no aparecen aquí')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Evaluar una oferta de Sleeper' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Abrir Sleeper' })).toBeTruthy()
    expect(document.body.textContent).toContain('no comparte las ofertas antes de que se acepten')
  })

  it('explains why a proposal cannot be delivered', () => {
    render(<TradeProposePanel leagueId="lg" give={[{ kind: 'faab', amount: 10 }]} get={[]}
      rosters={[]} viewerRosterId={null} partnerRosterId={null} onChoosePartner={() => {}} />)
    expect(document.body.textContent).toContain('Enviar como propuesta')
    expect(document.body.textContent).toContain('Solo puedes enviar propuestas desde una plantilla vinculada')
    expect(proposalBlockCopy('2027 Round 1 — typed by hand, so the league has no pick to match it to', 'es'))
      .toContain('no coincide con ninguna selección registrada')
  })
})
