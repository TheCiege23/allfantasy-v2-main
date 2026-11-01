/**
 * The native redraft Trade Center (list + stepped propose modal) rendered in Spanish, against the REAL
 * dictionaries. The mocked `t` falls back to the KEY, never to English, so a missing Spanish string
 * shows up here as a raw `tradeCenter.*` key instead of quietly rendering the English one.
 *
 * Every assertion reads `document.body.textContent`, which includes Radix's portalled modal. Fixture
 * names are deliberately Spanish so any English that remains can only have come from the components.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { translations } from '@/lib/i18n/translations'

vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const { interpolateTemplate } = await import('@/lib/i18n/interpolate')
  const t = (key: string) => dict.es[key] ?? key
  const value = {
    language: 'es',
    setLanguage: () => {},
    t,
    tInterpolate: (key: string, vars: Record<string, string | number | undefined> = {}) => interpolateTemplate(t(key), vars),
  }
  return { useOptionalLanguage: () => value, useLanguage: () => value }
})

const client = vi.hoisted(() => ({
  listTradeProposals: vi.fn(),
  fetchRedraftTradeRuntime: vi.fn(),
  fetchRedraftTradeSettings: vi.fn(),
  fetchRedraftRoster: vi.fn(),
  createTradeProposal: vi.fn(),
  submitTradeVote: vi.fn(),
  vetoRedraftTradeProposal: vi.fn(),
}))
vi.mock('@/lib/redraft/client', () => client)

// Sibling panels and the value breakdown are separate components with their own copy (out of scope here).
vi.mock('@/app/league/[leagueId]/tabs/redraft/CommissionerReviewPanel', () => ({ CommissionerReviewPanel: () => null }))
vi.mock('@/app/league/[leagueId]/tabs/redraft/TradeDiscoveryPanel', () => ({ TradeDiscoveryPanel: () => null }))
vi.mock('@/app/league/[leagueId]/tabs/redraft/TradeBlockPanel', () => ({ TradeBlockPanel: () => null }))
vi.mock('@/app/league/[leagueId]/tabs/redraft/MarketSnapshotPanel', () => ({ MarketSnapshotPanel: () => null }))
vi.mock('@/app/league/[leagueId]/tabs/redraft/MarketValuePanel', () => ({ MarketValuePanel: () => null }))
vi.mock('@/components/league-trade/ReverseTradeDialog', () => ({ ReverseTradeDialog: () => null }))
vi.mock('@/components/trade-value/TradeValueBreakdown', () => ({ TradeValueBreakdown: () => null }))
vi.mock('@/lib/trade-reversal/client', () => ({
  previewNativeTradeReversal: vi.fn(),
  requestNativeTradeReversal: vi.fn(),
}))

import { TradeCenter } from '@/app/league/[leagueId]/tabs/redraft/TradeCenter'
import { TradeCenterModal } from '@/app/league/[leagueId]/tabs/redraft/TradeCenterModal'

/** English copy that must never survive into the Spanish screen: every static fragment of every `tradeCenter.*` English value. */
const ENGLISH_FRAGMENTS: RegExp[] = (() => {
  const out = new Map<string, RegExp>()
  for (const [key, value] of Object.entries(translations.en)) {
    if (!key.startsWith('tradeCenter.')) continue
    for (const raw of value.split(/\{\{[a-zA-Z0-9_]+\}\}/)) {
      const frag = raw.replace(/FAAB/g, '').trim()
      if (!/[A-Za-z]{3,}/.test(frag)) continue
      const esc = frag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      out.set(frag, new RegExp(`(^|[^\\p{L}])${esc}($|[^\\p{L}])`, 'u'))
    }
  }
  return [...out.values()]
})()
/** And a handful of ordinary English words, as a backstop for copy that never had a key. */
const ENGLISH_WORDS = /\b(the|and|with|trade|team|teams|accept|accepted|waiting|propose|sends|gets|gives|pending|loading|nothing|player|players)\b/i

function expectFullySpanish() {
  const text = document.body.textContent ?? ''
  const leftovers = ENGLISH_FRAGMENTS.filter((re) => re.test(text)).map((re) => re.source)
  expect(leftovers, `English copy left on the Spanish screen:\n${leftovers.join('\n')}\n---\n${text}`).toEqual([])
  expect(text.match(ENGLISH_WORDS)?.[0] ?? null, text).toBeNull()
  expect(text, 'raw i18n key on screen').not.toMatch(/tradeCenter\.[a-zA-Z]/)
  expect(text.toLowerCase()).not.toContain('waiver')
  return text
}

const standings = [
  { id: 'r1', teamName: 'Los Halcones', ownerName: 'Ana', wins: 3, losses: 1, ties: 0 },
  { id: 'r2', teamName: 'Tigres del Norte', ownerName: 'Beto', wins: 2, losses: 2, ties: 0 },
  { id: 'r3', teamName: 'Lobos Grises', ownerName: 'Carla', wins: 1, losses: 3, ties: 1 },
  { id: 'r4', teamName: 'Águilas Reales', ownerName: 'Diego', wins: 0, losses: 4, ties: 0 },
] as never[]

function player(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id, playerId: id, playerName: name, position: 'RB', team: 'MIA', sport: 'NFL', slotType: 'BN',
    injuryStatus: null, byeWeek: 9, restOfSeasonProjection: 101.4, weeklyScore: null, ...extra,
  }
}
const rosterOf = (id: string) => ({
  ...(standings.find((r) => (r as { id: string }).id === id) as unknown as object),
  players:
    id === 'r1' ? [player('p1', 'Juan Pérez', { isLocked: true })]
    : id === 'r2' ? [player('p2', 'Luis García')]
    : id === 'r3' ? [player('p3', 'Mario López')]
    : [],
})

const asset = (id: string, from: string, to: string, playerName: string, assetType = 'player') => ({
  id, fromRosterId: from, toRosterId: to, assetType, playerName, pickSeason: null, pickRound: null, pickNumber: null,
})
const future = new Date(Date.now() + 36 * 3600_000).toISOString()

const twoTeamPending = {
  id: 't2', leagueId: 'L', seasonId: 'S', proposerRosterId: 'r1', receiverRosterId: 'r2', status: 'pending',
  vetoMode: 'commissioner', vetoThreshold: null, reason: 'Nos sirve a los dos', expiresAt: future, acceptedAt: null,
  createdAt: new Date().toISOString(),
  assets: [asset('a1', 'r1', 'r2', 'Juan Pérez'), { ...asset('a2', 'r2', 'r1', '', 'draft_pick'), playerName: null, pickSeason: 2027, pickRound: 2 }, asset('a3', 'r2', 'r1', '', 'faab')],
  votes: [], tradeGrade: { grade: 'B+', partnerGrade: 'B-', gradeWithheld: null, receiptId: null },
}
const multiTeamPending = {
  ...twoTeamPending, id: 't3', additionalRosterIds: ['r3'], acceptedRosterIds: ['r2'], reason: null,
  assets: [asset('b1', 'r1', 'r2', 'Juan Pérez'), asset('b2', 'r2', 'r3', 'Luis García'), asset('b3', 'r3', 'r1', 'Mario López')],
  tradeGrade: { grade: null, partnerGrade: null, gradeWithheld: 'Grades are shown for two-team trades.', receiptId: null },
}
const accepted = { ...twoTeamPending, id: 't4', status: 'accepted', reason: null, assets: [asset('c1', 'r1', 'r2', 'Juan Pérez'), { ...asset('c2', 'r2', 'r1', '', 'future_consideration'), playerName: null }] }

const settings = { tradeReviewHours: 48, tradeDeadlineWeek: 11, draftPickTrading: true, commissionerTradeReviewType: 'league_vote' }

beforeEach(() => {
  vi.clearAllMocks()
  client.fetchRedraftTradeSettings.mockResolvedValue({ settings, faabByRosterId: { r1: 80, r2: 40, r3: 20 }, isCommissioner: true })
  client.fetchRedraftTradeRuntime.mockResolvedValue({
    coverage: { pendingTrades: 2, transactionCount: 1, voteCount: 1 },
    settings: { pickExecutionStatus: 'supported' },
  })
  client.listTradeProposals.mockResolvedValue([twoTeamPending, multiTeamPending, accepted])
  client.fetchRedraftRoster.mockImplementation(async (id: string) => rosterOf(id))
  client.createTradeProposal.mockResolvedValue({ proposal: { id: 'new' }, decisionOs: null })
  // The value preview route: answer with a grade so the review step renders its graded totals.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({
      snapshot: { context: { capturedAt: new Date('2026-10-01T12:00:00Z').toISOString() } },
      tradeGrade: { grade: 'A-', partnerGrade: 'C', gradeLabel: null, gradeWithheld: null, giveValue: 40.2, getValue: 55.7, evaluationReceiptId: null },
    }),
  })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('redraft Trade Center list — Spanish', () => {
  it('pending two-team, multi-team and accepted rows read fully in Spanish', async () => {
    render(<TradeCenter leagueId="L" seasonId="S" standings={standings} myRosterId={null} isCommissioner />)
    await waitFor(() => expect(screen.getAllByTestId('trade-proposal-row')).toHaveLength(3))
    await waitFor(() => expect(screen.getByTestId('trade-settings-summary')).toBeTruthy())
    await waitFor(() => expect(screen.getByTestId('redraft-trade-runtime-summary')).toBeTruthy())
    const text = expectFullySpanish()

    expect(text).toContain('Centro de intercambios')
    expect(text).toContain('Proponer intercambio')
    expect(text).toContain('Revisión: votación de la liga')
    expect(text).toContain('Fecha límite: Semana 11')
    // Explicit plurals: 2 → many, 1 → one.
    expect(text).toContain('2 pendientes')
    expect(text).toContain('1 registro')
    expect(text).toContain('1 voto')
    // Two-team pending: the server-side explainer's own Spanish, and the pick/asset labels.
    expect(text).toContain('Los Halcones recibe')
    expect(text).toContain('2027 Ronda 2')
    expect(text).toContain('Esperando al otro mánager')
    // Multi-team: the badge, the count, who is still owed an answer, and the translated grade note.
    expect(screen.getByTestId('trade-proposal-accept-count').textContent).toBe('aceptado por 1 de 2')
    expect(text).toContain('Intercambio de 3 equipos')
    expect(text).toContain('Falta: Lobos Grises.')
    expect(screen.getByTestId('trade-proposal-grade-note').textContent?.trim()).toBe(
      'Las calificaciones se muestran en intercambios entre dos equipos.',
    )
    // Accepted: status badge and the commissioner's reverse control.
    expect(text).toContain('aceptado')
    expect(screen.getByTestId('trade-proposal-reverse').textContent).toBe('Revertir intercambio')
    expect(text).toContain('Consideración futura')
    expect(text).toContain('veto del comisionado')
  })

  it('the empty state is Spanish', async () => {
    client.listTradeProposals.mockResolvedValue([])
    client.fetchRedraftTradeRuntime.mockResolvedValue(null)
    render(<TradeCenter leagueId="L" seasonId="S" standings={standings} />)
    await waitFor(() => expect(document.body.textContent).toContain('Todavía no hay ofertas de intercambio'))
    expectFullySpanish()
  })

  it('a failed action falls back to Spanish copy', async () => {
    client.submitTradeVote.mockRejectedValue('boom')
    render(<TradeCenter leagueId="L" seasonId="S" standings={standings} />)
    await waitFor(() => expect(screen.getAllByTestId('trade-proposal-row')).toHaveLength(3))
    fireEvent.click(screen.getAllByText('votar a favor')[0]!)
    await waitFor(() => expect(document.body.textContent).toContain('No se pudo registrar tu voto a favor'))
    expectFullySpanish()
  })
})

function renderModal(extra: Partial<React.ComponentProps<typeof TradeCenterModal>> = {}) {
  return render(
    <TradeCenterModal
      open
      onClose={() => {}}
      leagueId="L"
      seasonId="S"
      standings={standings}
      currentWeek={12}
      myRosterId="r1"
      settings={settings}
      faabByRosterId={{ r1: 80, r2: 40, r3: 20 }}
      {...extra}
    />,
  )
}

describe('redraft Trade Center modal — Spanish, every step', () => {
  it('partner → assets → review → sent, two teams', async () => {
    renderModal()
    // Step 1.
    expect(document.body.textContent).toContain('Paso 1 de 3 · Los Halcones')
    expect(document.body.textContent).toContain('Elige el equipo con el que quieres intercambiar.')
    // The shared modal's close (X) button is named in Spanish too.
    expect(screen.getByTestId('app-modal-close').getAttribute('aria-label')).toBe('Cerrar')
    fireEvent.click(screen.getByTestId('trade-partner-card-r2'))
    expect(document.body.textContent).toContain('agrega hasta 2 equipos más')
    // The chosen partner draws a tick, not only a pink tint.
    expect(screen.getByTestId('trade-partner-card-r2').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('trade-partner-check-r2').getAttribute('data-selection-check')).toBe('on')
    expect(screen.getByTestId('trade-partner-check-r3').getAttribute('data-selection-check')).toBe('off')
    expectFullySpanish()

    // Step 2.
    fireEvent.click(screen.getByTestId('trade-step-next'))
    await waitFor(() => expect(screen.getByTestId('trade-asset-player-p2')).toBeTruthy())
    expect(document.body.textContent).toContain('Nada seleccionado')
    expect(screen.getByTestId('trade-asset-check-p1').getAttribute('data-selection-check')).toBe('off')
    fireEvent.click(screen.getByTestId('trade-asset-player-p1'))
    fireEvent.click(screen.getByTestId('trade-asset-player-p2'))
    expect(screen.getByTestId('trade-asset-player-p1').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('trade-asset-check-p1').getAttribute('data-selection-check')).toBe('on')
    fireEvent.change(screen.getByTestId('trade-faab-mine'), { target: { value: '90' } })
    const assetsText = expectFullySpanish()
    expect(assetsText).toContain('Los Halcones envía')
    expect(assetsText).toContain('FAAB (80 disponible)')
    expect(assetsText).toContain('Descanso sem. 9')
    expect(assetsText).toContain('101.4 puntos')
    expect(assetsText).toContain('El FAAB supera el saldo disponible.')
    expect(assetsText).toContain('Aquí no se pueden ofrecer selecciones del draft')

    // Step 3, with warnings (deadline passed, locked player, FAAB over).
    fireEvent.click(screen.getByTestId('trade-step-next'))
    await waitFor(() => expect(screen.getByTestId('trade-value-grade-totals')).toBeTruthy())
    const reviewText = expectFullySpanish()
    expect(reviewText).toContain('Valor del intercambio')
    expect(reviewText).toContain('Los Halcones recibe')
    expect(reviewText).toContain('⚠ La fecha límite de intercambios (semana 11) ya pasó.')
    expect(reviewText).toContain('⚠ Un jugador seleccionado está bloqueado esta semana.')
    expect(reviewText).toContain('Modo de revisión: votación de la liga · vence en 48 h.')
    expect(reviewText).toContain('Nota para el otro mánager (opcional)')
    expect(reviewText).toContain('Valoración completa')
    expect(screen.getByPlaceholderText('Por qué esto les sirve a ambos equipos…')).toBeTruthy()
  })

  it('a sendable two-team proposal reaches the Spanish success view', async () => {
    renderModal({ currentWeek: 3, initialReceiverRosterId: 'r2' })
    await waitFor(() => expect(screen.getByTestId('trade-asset-player-p2')).toBeTruthy())
    fireEvent.click(screen.getByTestId('trade-asset-player-p2'))
    fireEvent.change(screen.getByTestId('trade-faab-mine'), { target: { value: '5' } })
    fireEvent.click(screen.getByTestId('trade-step-next'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('trade-submit'))
    })
    await waitFor(() => expect(screen.getByTestId('trade-success')).toBeTruthy())
    const text = expectFullySpanish()
    expect(text).toContain('Propuesta de intercambio enviada')
    expect(text).toContain('Los Halcones → Tigres del Norte. El otro mánager ya puede revisarla y responder.')
    expect(text).toContain('Listo')
  })

  it('multi-team: destination pickers, uninvolved team, grade note, success', async () => {
    renderModal({ currentWeek: 3 })
    fireEvent.click(screen.getByTestId('trade-partner-card-r2'))
    fireEvent.click(screen.getByTestId('trade-extra-partner-r3'))
    fireEvent.click(screen.getByTestId('trade-step-next'))
    await waitFor(() => expect(screen.getByTestId('trade-asset-player-p3')).toBeTruthy())
    fireEvent.click(screen.getByTestId('trade-asset-player-p2'))
    // Lobos Grises neither sends nor receives yet.
    expect(screen.getByTestId('trade-uninvolved-teams').textContent).toContain(
      'Lobos Grises todavía no tiene nada en este intercambio.',
    )
    expect(document.body.textContent).toContain('Para')
    expect(document.body.textContent).toContain('Entrega')
    expectFullySpanish()

    fireEvent.click(screen.getByTestId('trade-asset-player-p3'))
    fireEvent.click(screen.getByTestId('trade-step-next'))
    const reviewText = expectFullySpanish()
    expect(screen.getByTestId('trade-multi-team-grade-note').textContent?.trim()).toBe(
      'Las calificaciones se muestran en intercambios entre dos equipos. Cada equipo tiene que aceptar este para que se procese.',
    )
    expect(reviewText).toContain('Nota para los otros mánagers (opcional)')

    await act(async () => {
      fireEvent.click(screen.getByTestId('trade-submit'))
    })
    await waitFor(() => expect(screen.getByTestId('trade-success')).toBeTruthy())
    expect(expectFullySpanish()).toContain(
      'Los Halcones, Tigres del Norte, Lobos Grises. Cada equipo tiene que aceptar para que se procese.',
    )
  })

  it('a failed submit falls back to Spanish copy', async () => {
    client.createTradeProposal.mockRejectedValue('boom')
    renderModal({ currentWeek: 3, initialReceiverRosterId: 'r2' })
    await waitFor(() => expect(screen.getByTestId('trade-asset-player-p2')).toBeTruthy())
    fireEvent.click(screen.getByTestId('trade-asset-player-p2'))
    fireEvent.change(screen.getByTestId('trade-faab-mine'), { target: { value: '5' } })
    fireEvent.click(screen.getByTestId('trade-step-next'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('trade-submit'))
    })
    await waitFor(() => expect(document.body.textContent).toContain('No se pudo enviar el intercambio'))
    expectFullySpanish()
  })
})
