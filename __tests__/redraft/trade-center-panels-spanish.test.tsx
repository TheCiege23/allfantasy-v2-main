/**
 * The Trade Center's child panels rendered in Spanish, against the REAL dictionaries: the commissioner
 * review, the trade block, Find a Trade, the two market panels, the reverse-trade dialog and the value
 * breakdown. The mocked `t` falls back to the KEY, never to English, so a missing Spanish string shows
 * up as a raw `tradeCenter.*` key instead of quietly rendering the English one.
 *
 * Server-sent text (a check's explanation, a match reason, a withheld-grade reason) is written in
 * Spanish in these fixtures, so any English left on screen can only have come from the components.
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
  fetchLeagueTradeBlock: vi.fn(),
  fetchMyInterests: vi.fn(),
  fetchRedraftRoster: vi.fn(),
  addTradeBlockItem: vi.fn(),
  removeTradeBlockItem: vi.fn(),
  addTradeInterest: vi.fn(),
  removeTradeInterest: vi.fn(),
  fetchTradeDiscovery: vi.fn(),
  fetchTradePackages: vi.fn(),
  fetchTradeMarketAggregates: vi.fn(),
  fetchAdaptiveValueTopMovers: vi.fn(),
  fetchAllFantasyMarketValues: vi.fn(),
}))
vi.mock('@/lib/redraft/client', () => client)

import { CommissionerReviewPanel } from '@/app/league/[leagueId]/tabs/redraft/CommissionerReviewPanel'
import { TradeBlockPanel, BlockOfferLine } from '@/app/league/[leagueId]/tabs/redraft/TradeBlockPanel'
import { TradeDiscoveryPanel } from '@/app/league/[leagueId]/tabs/redraft/TradeDiscoveryPanel'
import { MarketSnapshotPanel } from '@/app/league/[leagueId]/tabs/redraft/MarketSnapshotPanel'
import { MarketValuePanel } from '@/app/league/[leagueId]/tabs/redraft/MarketValuePanel'
import { ReverseTradeDialog } from '@/components/league-trade/ReverseTradeDialog'
import { TradeValueBreakdown } from '@/components/trade-value/TradeValueBreakdown'
import type { AssetValueSnapshot, TradeValueSnapshot } from '@/lib/trade-value/types'

const es = translations.es

/**
 * English copy that must never survive into the Spanish screen: every static fragment of every
 * `tradeCenter.*` English value. «has» is also a Spanish word («no has marcado»), so it is left out.
 */
const SPANISH_TOO = new Set(['has'])
const ENGLISH_FRAGMENTS: RegExp[] = (() => {
  const out = new Map<string, RegExp>()
  for (const [key, value] of Object.entries(translations.en)) {
    if (!key.startsWith('tradeCenter.')) continue
    for (const raw of value.split(/\{\{[a-zA-Z0-9_]+\}\}/)) {
      const frag = raw.replace(/FAAB/g, '').trim()
      if (!/[A-Za-z]{3,}/.test(frag) || SPANISH_TOO.has(frag)) continue
      const esc = frag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      out.set(frag, new RegExp(`(^|[^\\p{L}])${esc}($|[^\\p{L}])`, 'u'))
    }
  }
  return [...out.values()]
})()
/** And ordinary English words, as a backstop for copy that never had a key. */
const ENGLISH_WORDS =
  /\b(the|and|with|trade|team|teams|loading|nothing|player|players|review|reviewing|block|interest|interests|market|value|values|sample|accepted|vetoed|rejected|grades|preview|rising|falling|reverse|reason|cancel|close|sends|priced|projection|format|round|pick|match|needs|package|packages|suggestions|remove|private|public)\b/i

function expectFullySpanish(root: ParentNode = document.body) {
  const text = root.textContent ?? ''
  const leftovers = ENGLISH_FRAGMENTS.filter((re) => re.test(text)).map((re) => re.source)
  expect(leftovers, `English copy left on the Spanish screen:\n${leftovers.join('\n')}\n---\n${text}`).toEqual([])
  expect(text.match(ENGLISH_WORDS)?.[0] ?? null, text).toBeNull()
  expect(text, 'raw i18n key on screen').not.toMatch(/tradeCenter\.[a-zA-Z]/)
  expect(text.toLowerCase()).not.toContain('waiver')
  expect(text).not.toMatch(/traspaso/i)
  return text
}

/** Placeholders and aria-labels are not textContent, so check them on their own. */
function expectSpanishAttributes() {
  for (const el of Array.from(document.querySelectorAll('[placeholder],[aria-label]'))) {
    const v = `${el.getAttribute('placeholder') ?? ''} ${el.getAttribute('aria-label') ?? ''}`
    expect(v).not.toMatch(ENGLISH_WORDS)
    expect(v).not.toMatch(/tradeCenter\./)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// ── Commissioner review ─────────────────────────────────────────────────────────────────────────

const REVIEW = {
  review: {
    model: 'trade-review-v1',
    recommendation: 'consider_veto',
    flags: [],
    checks: [
      { code: 'heavily_lopsided', severity: 'high', status: 'raised', explanation: 'Tigres recibe un 48 % más de valor.' },
      { code: 'deadline_rush', severity: 'medium', status: 'raised', explanation: 'Se envió a última hora.' },
      { code: 'tanking_signal', severity: 'high', status: 'clear', explanation: 'x' },
      { code: 'repeat_partners', severity: 'low', status: 'clear', explanation: 'x' },
      { code: 'eliminated_team_dumping', severity: 'medium', status: 'not_computed', explanation: 'Esta liga aún no tiene pronóstico.' },
    ],
  },
  sides: ['Halcones', 'Tigres'],
  tradeGrade: { grade: 'F', partnerGrade: 'A', gradeWithheld: null },
  reviewId: 'rcpt_es',
  explanation: { noteToLeague: 'Revisado para el comisionado.', headline: 'h', source: 'template' },
  actOn: { platform: 'Sleeper', deepLink: 'https://sleeper.com/x', note: 'Este intercambio se decide en Sleeper.' },
}

async function openReview(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })))
  render(<CommissionerReviewPanel leagueId="L" proposalId="t1" />)
  await act(async () => {
    fireEvent.click(screen.getByTestId('trade-review-toggle'))
  })
}

describe('commissioner review — Spanish', () => {
  it('collapsed: the toggle reads in Spanish', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<CommissionerReviewPanel leagueId="L" proposalId="t1" />)
    expect(screen.getByTestId('trade-review-toggle').textContent).toContain('Revisión del comisionado')
    expectFullySpanish()
  })

  it('a full review: recommendation, grade, flags, not checked, clear, the act-on link and the advice line', async () => {
    await openReview(REVIEW)
    await waitFor(() => expect(screen.getByTestId('trade-review-recommendation')).toBeTruthy())
    const text = expectFullySpanish()
    expect(screen.getByTestId('trade-review-recommendation').textContent).toBe('Plantéate un veto')
    expect(screen.getByTestId('trade-review-grade').textContent).toBe('Halcones F · Tigres A')
    expect(screen.getByTestId('trade-review-flags').textContent).toContain('Muy desequilibrado')
    expect(screen.getByTestId('trade-review-flags').textContent).toContain('Prisas por la fecha límite')
    expect(screen.getByTestId('trade-review-not-checked').textContent).toBe(
      'Sin revisarEquipo eliminado regalando jugadores: Esta liga aún no tiene pronóstico.',
    )
    expect(screen.getByTestId('trade-review-clear').textContent).toBe('Sin problemas: Señal de perder a propósito · Mismos equipos otra vez')
    expect(screen.getByTestId('trade-review-act-on').textContent).toContain('Abrir Sleeper')
    expect(text).toContain('Solo es un consejo: AllFantasy nunca aprueba ni veta un intercambio por su cuenta.')
  })

  it.each([
    ['approve', 'Sin alertas: se puede aprobar'],
    ['review_with_managers', 'Revísalo con los mánagers'],
  ])('recommendation %s', async (recommendation, label) => {
    await openReview({ ...REVIEW, review: { ...REVIEW.review, recommendation } })
    await waitFor(() => expect(screen.getByTestId('trade-review-recommendation').textContent).toBe(label))
    expectFullySpanish()
  })

  it('not graded, with and without a reason', async () => {
    await openReview({ ...REVIEW, tradeGrade: { grade: null, partnerGrade: null, gradeWithheld: 'faltan valores' }, actOn: null })
    await waitFor(() => expect(document.body.textContent).toContain('Sin calificar: faltan valores'))
    expectFullySpanish()
    cleanup()
    await openReview({ ...REVIEW, tradeGrade: { grade: null, partnerGrade: null, gradeWithheld: null }, actOn: null })
    await waitFor(() => expect(document.body.textContent).toContain('Sin calificar'))
    expectFullySpanish()
  })

  it('a failed review falls back to Spanish copy', async () => {
    await openReview(null, false)
    await waitFor(() => expect(document.body.textContent).toContain('No se pudo revisar este intercambio en este momento.'))
    expectFullySpanish()
  })
})

// ── Trade block ─────────────────────────────────────────────────────────────────────────────────

const blockItem = (over: Record<string, unknown>) => ({
  id: 'i1', rosterId: 'r2', playerId: 'p2', playerName: 'Luis García', position: 'WR', team: 'MIA',
  askingForPositions: [], wantsFaab: false, wantsDraftPicks: false, note: null, expiresAt: null, suggestedOffer: null,
  ...over,
})

async function openBlock() {
  render(<TradeBlockPanel leagueId="L" myRosterId="r1" currentWeek={3} onBuildProposal={() => {}} />)
  await act(async () => {
    fireEvent.click(screen.getByTestId('trade-block-toggle'))
  })
}

describe('trade block — Spanish', () => {
  it('my block, the league block with a graded offer and a note, my interests', async () => {
    client.fetchLeagueTradeBlock.mockResolvedValue({
      items: [
        blockItem({ id: 'mine', rosterId: 'r1', playerId: 'p1', playerName: 'Juan Pérez' }),
        blockItem({
          note: 'Busco un corredor',
          suggestedOffer: { gives: ['Juan Pérez'], receives: ['Luis García'], grade: { graded: true, letter: 'B', partnerLetter: 'D', label: 'Slightly favors you', giveValue: 1, getValue: 2 } },
        }),
      ],
    })
    client.fetchMyInterests.mockResolvedValue({
      interests: [
        { id: 'x1', playerId: 'p3', playerName: 'Mario López', position: 'RB', interestType: 'player_interest', visibility: 'private', note: null },
        { id: 'x2', playerId: 'p4', playerName: 'Pedro Ruiz', position: 'QB', interestType: 'player_interest', visibility: 'public', note: null },
      ],
    })
    client.fetchRedraftRoster.mockResolvedValue({
      players: [
        { id: 'a', playerId: 'p1', playerName: 'Juan Pérez', position: 'RB', team: 'MIA' },
        { id: 'b', playerId: 'p5', playerName: 'Raúl Díaz', position: 'TE', team: 'MIA' },
      ],
    })
    await openBlock()
    await waitFor(() => expect(screen.getByTestId('league-block-card')).toBeTruthy())
    const text = expectFullySpanish()
    expect(text).toContain('Bloque de intercambios e intereses')
    expect(text).toContain('Mi bloque de intercambios')
    expect(screen.getByTestId('block-toggle-p1').textContent).toBe('Quitar')
    expect(screen.getByTestId('block-toggle-p5').textContent).toBe('Añadir al bloque')
    expect(text).toContain('Bloque de intercambios de la liga')
    expect(screen.getByTestId('mark-interest-p2').textContent).toBe('Marcar interés')
    expect(screen.getByTestId('block-build-r2').textContent).toBe('Armar propuesta')
    expect(screen.getByTestId('block-offer').textContent).toBe(
      'Oferta sugerida: envía Juan Pérez a cambio de Luis GarcíaCalificación: tú B · ellos D — Te favorece ligeramente',
    )
    expect(text).toContain('Mis intereses')
    expect(text).toContain('Mario López (privado)')
    expect(text).toContain('Pedro Ruiz (público)')
    expect(text).toContain('quitar')
  })

  it('empty: no other managers listed, no interests', async () => {
    client.fetchLeagueTradeBlock.mockResolvedValue({ items: [] })
    client.fetchMyInterests.mockResolvedValue({ interests: [] })
    client.fetchRedraftRoster.mockResolvedValue({ players: [] })
    await openBlock()
    await waitFor(() => expect(document.body.textContent).toContain('Todavía no has marcado ningún interés.'))
    expect(document.body.textContent).toContain('Los otros mánagers todavía no han puesto jugadores en el bloque.')
    expectFullySpanish()
  })

  it('a failed load falls back to Spanish copy', async () => {
    client.fetchLeagueTradeBlock.mockRejectedValue('boom')
    client.fetchMyInterests.mockResolvedValue({ interests: [] })
    client.fetchRedraftRoster.mockResolvedValue({ players: [] })
    await openBlock()
    await waitFor(() => expect(document.body.textContent).toContain('No se pudo cargar el bloque de intercambios'))
    expectFullySpanish()
  })

  it('a failed action falls back to Spanish copy', async () => {
    client.fetchLeagueTradeBlock.mockResolvedValue({ items: [] })
    client.fetchMyInterests.mockResolvedValue({ interests: [] })
    client.fetchRedraftRoster.mockResolvedValue({ players: [{ id: 'b', playerId: 'p5', playerName: 'Raúl Díaz', position: 'TE', team: 'MIA' }] })
    client.addTradeBlockItem.mockRejectedValue('boom')
    await openBlock()
    await waitFor(() => expect(screen.getByTestId('block-toggle-p5')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByTestId('block-toggle-p5'))
    })
    await waitFor(() => expect(document.body.textContent).toContain('No se pudo completar la acción'))
    expectFullySpanish()
  })

  it.each([
    ['Major win (you)', 'Gran ventaja para ti'],
    ['Slightly favors you', 'Te favorece ligeramente'],
    ['Even', 'Equilibrado'],
    ['Slightly favors opponent', 'Favorece ligeramente al rival'],
    ['Major overpay', 'Pagas mucho de más'],
  ])('the offer line translates the grade label %s', (label, spanish) => {
    render(<BlockOfferLine offer={{ gives: ['A'], receives: ['B'], grade: { graded: true, letter: 'C', partnerLetter: 'C', label, giveValue: 1, getValue: 1 } }} />)
    expect(screen.getByTestId('block-offer-grade').textContent).toBe(`Calificación: tú C · ellos C — ${spanish}`)
    expectFullySpanish()
  })

  it('a withheld grade says why, in Spanish', () => {
    render(<BlockOfferLine offer={{ gives: ['A'], receives: ['B'], grade: { graded: false, reason: 'faltan valores' } }} />)
    expect(screen.getByTestId('block-offer-grade-withheld').textContent).toBe('Sin calificar: faltan valores')
    expectFullySpanish()
  })
})

// ── Find a Trade ────────────────────────────────────────────────────────────────────────────────

const partner = {
  rosterId: 'r2', teamName: 'Tigres del Norte', managerDisplayName: null, partnerNeeds: ['RB'], partnerSurpluses: ['WR'],
  myNeeds: [], mySurpluses: [], matchScore: 82, matchReasons: ['Les sobra un receptor y a ti te falta.'], warningFlags: [],
}

async function openDiscovery() {
  render(<TradeDiscoveryPanel leagueId="L" myRosterId="r1" onBuildProposal={() => {}} />)
  await act(async () => {
    fireEvent.click(screen.getByTestId('trade-discovery-toggle'))
  })
}

describe('Find a Trade — Spanish', () => {
  it('a partner card and its package ideas, with fairness and warning flags', async () => {
    client.fetchTradeDiscovery.mockResolvedValue({ partners: [partner] })
    client.fetchTradePackages.mockResolvedValue({
      suggestedPackages: [
        {
          packageId: 'k1', giveAssets: [{ kind: 'player', playerName: 'Juan Pérez', value: 1 }, { kind: 'faab', faabAmount: 10, value: 1 }],
          receiveAssets: [{ kind: 'player', playerName: 'Luis García', value: 1 }], myTotalValue: 1, partnerTotalValue: 1, valueDelta: 0,
          fairnessBand: 'slight edge you', confidence: 1, reasons: [], canStartProposal: true,
          warningFlags: ['VALUE_GAP_HIGH', 'FAAB_UNSUPPORTED_OR_LIMITED', 'SAME_POSITION_SWAP'],
        },
        { packageId: 'k2', giveAssets: [{ kind: 'player', playerName: 'Raúl Díaz', value: 1 }], receiveAssets: [{ kind: 'player', playerName: 'Pedro Ruiz', value: 1 }],
          myTotalValue: 1, partnerTotalValue: 1, valueDelta: 0, fairnessBand: 'low confidence', confidence: 1, reasons: [], canStartProposal: true,
          warningFlags: ['LOW_DATA_CONFIDENCE', 'NCAAF_LIMITED_DATA', 'POSITION_DEPTH_RISK', 'TRADE_BLOCK_MATCH'] },
      ],
    })
    await openDiscovery()
    await waitFor(() => expect(screen.getByTestId('discovery-partner-card')).toBeTruthy())
    let text = expectFullySpanish()
    expect(text).toContain('Buscar un intercambio: los mejores equipos para negociar e ideas de paquetes')
    expect(text).toContain('Afinidad 82')
    expect(text).toContain('necesita RB')
    expect(text).toContain('le sobra WR')
    expect(screen.getByTestId('discovery-packages-r2').textContent).toBe('Ideas de paquetes')
    expect(screen.getByTestId('discovery-build-r2').textContent).toBe('Armar propuesta')
    expect(text).toContain('Solo son sugerencias. Tú siempre revisas y envías el intercambio. No se cambia ningún valor.')

    await act(async () => {
      fireEvent.click(screen.getByTestId('discovery-packages-r2'))
    })
    await waitFor(() => expect(screen.getByTestId('discovery-packages').textContent).toContain('Luis García'))
    text = expectFullySpanish()
    expect(text).toContain('Juan Pérez + $10 FAAB → Luis García')
    expect(text).toContain('[ligera ventaja para ti]')
    expect(text).toContain('gran diferencia de valor, FAAB no disponible o limitado, cambio en la misma posición')
    expect(text).toContain('[confianza baja]')
    expect(text).toContain('datos poco fiables, datos limitados de NCAAF, riesgo de quedarte corto en la posición, coincide con el bloque de intercambios')
  })

  it.each([
    ['balanced', 'equilibrado'],
    ['slight edge partner', 'ligera ventaja para el otro equipo'],
    ['lopsided', 'desequilibrado'],
  ])('fairness band %s', async (band, spanish) => {
    client.fetchTradeDiscovery.mockResolvedValue({ partners: [partner] })
    client.fetchTradePackages.mockResolvedValue({
      suggestedPackages: [{ packageId: 'k', giveAssets: [{ kind: 'player', playerName: 'A', value: 1 }], receiveAssets: [{ kind: 'player', playerName: 'B', value: 1 }],
        myTotalValue: 1, partnerTotalValue: 1, valueDelta: 0, fairnessBand: band, confidence: 1, reasons: [], warningFlags: [], canStartProposal: true }],
    })
    await openDiscovery()
    await waitFor(() => expect(screen.getByTestId('discovery-partner-card')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByTestId('discovery-packages-r2'))
    })
    await waitFor(() => expect(screen.getByTestId('discovery-packages').textContent).toContain(`[${spanish}]`))
    expectFullySpanish()
  })

  it('no packages, and no partners', async () => {
    client.fetchTradeDiscovery.mockResolvedValue({ partners: [partner] })
    client.fetchTradePackages.mockResolvedValue({ suggestedPackages: [] })
    await openDiscovery()
    await waitFor(() => expect(screen.getByTestId('discovery-partner-card')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByTestId('discovery-packages-r2'))
    })
    await waitFor(() => expect(document.body.textContent).toContain('Todavía no hay ideas de paquetes claras; prueba a armarlo a mano.'))
    expectFullySpanish()
    cleanup()

    client.fetchTradeDiscovery.mockResolvedValue({ partners: [] })
    await openDiscovery()
    await waitFor(() => expect(document.body.textContent).toContain('Todavía no aparecen equipos con los que negociar.'))
    expectFullySpanish()
  })

  it('while loading, and a failed load', async () => {
    client.fetchTradeDiscovery.mockReturnValue(new Promise(() => {}))
    await openDiscovery()
    expect(document.body.textContent).toContain('Buscando equipos…')
    expectFullySpanish()
    cleanup()

    client.fetchTradeDiscovery.mockRejectedValue('boom')
    await openDiscovery()
    await waitFor(() => expect(document.body.textContent).toContain('No se pudieron cargar las sugerencias de intercambio'))
    expectFullySpanish()
  })
})

// ── Market snapshot and market value ────────────────────────────────────────────────────────────

const summary = {
  sampleSize: 24, acceptedCount: 10, rejectedCount: 6, canceledCount: 1, vetoedCount: 2, expiredCount: 5, processedCount: 10,
  averageFairness: 71, medianFairness: 70, averageConfidence: null, averageValueDelta: 3, lastEventAt: null,
}
const aggregates = (over: Record<string, unknown> = {}) => ({
  scope: 'league', requestedScope: 'league', sampleStatus: 'ok', summary,
  gradeDistribution: { aRange: 4, bRange: 8, cRange: 6, dfRange: 3, unknown: 3 },
  reviewDistribution: {}, generatedAt: '2026-10-01T00:00:00Z', ...over,
})
const mover = (playerId: string, direction: string, adjustmentPercent: number) => ({
  playerId, playerName: `Jugador ${playerId}`, position: 'RB', baseValue: 1, marketPreviewValue: 1, adjustmentPercent,
  adjustmentPoints: 1, confidence: 1, sampleSize: 3, direction, reasons: [],
})

async function openSnapshot() {
  render(<MarketSnapshotPanel leagueId="L" />)
  await act(async () => {
    fireEvent.click(screen.getByTestId('market-snapshot-toggle'))
  })
}

describe('market snapshot — Spanish', () => {
  it('a full snapshot with movers in every direction', async () => {
    client.fetchTradeMarketAggregates.mockResolvedValue(aggregates())
    client.fetchAdaptiveValueTopMovers.mockResolvedValue({
      topMovers: [mover('a', 'rising', 6), mover('b', 'falling', -4), mover('c', 'stable', 0), mover('d', 'insufficient', 0)],
    })
    await openSnapshot()
    await waitFor(() => expect(screen.getByTestId('adaptive-preview-section')).toBeTruthy())
    const text = expectFullySpanish()
    for (const s of [
      'Resumen del mercado de AllFantasy', 'Muestra 24', 'Aceptados 10', 'Vetados 2', 'Rechazados 6',
      'Equidad media 71', 'Equidad mediana 70', 'Confianza media —',
      'Calificaciones: A 4 · B 8 · C 6 · D/F 3 · ? 3',
      'Historial del mercado de solo lectura. No cambia el valor de los jugadores.',
      'Vista previa del mercado de AllFantasy: los que más se mueven',
      '+6% (sube)', '-4% (baja)', '0% (estable)', '0% (sin datos suficientes)',
      'Solo es una vista previa. No cambia el valor oficial de los jugadores.',
    ]) expect(text, s).toContain(s)
  })

  it('no movers yet', async () => {
    client.fetchTradeMarketAggregates.mockResolvedValue(aggregates())
    client.fetchAdaptiveValueTopMovers.mockResolvedValue({ topMovers: [] })
    await openSnapshot()
    await waitFor(() => expect(document.body.textContent).toContain('Todavía no hay suficiente historial de intercambios en AllFantasy para ajustar jugadores.'))
    expectFullySpanish()
  })

  it('not enough history, with and without a count so far', async () => {
    client.fetchTradeMarketAggregates.mockResolvedValue(aggregates({ sampleStatus: 'insufficient', summary: { ...summary, sampleSize: 3 } }))
    client.fetchAdaptiveValueTopMovers.mockResolvedValue({ topMovers: [] })
    await openSnapshot()
    await waitFor(() => expect(screen.getByTestId('market-snapshot-insufficient').textContent).toBe(
      'Todavía no hay suficiente historial del mercado de AllFantasy (3 hasta ahora).',
    ))
    expectFullySpanish()
    cleanup()

    client.fetchTradeMarketAggregates.mockResolvedValue(aggregates({ sampleStatus: 'empty', summary: { ...summary, sampleSize: 0 } }))
    await openSnapshot()
    await waitFor(() => expect(screen.getByTestId('market-snapshot-insufficient').textContent).toBe(
      'Todavía no hay suficiente historial del mercado de AllFantasy.',
    ))
    expectFullySpanish()
  })

  it('while loading, and a failed load that is fetched once, not on every render', async () => {
    client.fetchTradeMarketAggregates.mockReturnValue(new Promise(() => {}))
    client.fetchAdaptiveValueTopMovers.mockResolvedValue({ topMovers: [] })
    await openSnapshot()
    expect(document.body.textContent).toContain('Cargando…')
    expectFullySpanish()
    cleanup()

    client.fetchTradeMarketAggregates.mockReset().mockRejectedValue('boom')
    await openSnapshot()
    await waitFor(() => expect(document.body.textContent).toContain('No se pudo cargar el resumen del mercado'))
    expectFullySpanish()
    await new Promise((r) => setTimeout(r, 50))
    expect(client.fetchTradeMarketAggregates).toHaveBeenCalledTimes(1)
  })
})

async function openMarketValue() {
  render(<MarketValuePanel leagueId="L" />)
  await act(async () => {
    fireEvent.click(screen.getByTestId('market-value-toggle'))
  })
}

describe('market value — Spanish', () => {
  it('published values and the disclaimer', async () => {
    client.fetchAllFantasyMarketValues.mockResolvedValue({
      sport: 'NFL',
      values: [{ playerId: 'a', playerName: 'Juan Pérez', position: 'RB', baseValue: 100, marketValue: 106, adjustmentPercent: 6, confidence: 70, sampleSize: 12, direction: 'rising', generatedAt: 'x' }],
    })
    await openMarketValue()
    await waitFor(() => expect(screen.getByTestId('market-value-disclaimer')).toBeTruthy())
    const text = expectFullySpanish()
    expect(text).toContain('Valor de mercado de AllFantasy')
    expect(screen.getByTestId('market-value-disclaimer').textContent?.trim()).toBe(
      'El valor de mercado de AllFantasy es independiente de los valores del proveedor, el ADP, las proyecciones y las instantáneas históricas.',
    )
  })

  it('not enough history, loading, and a failed load fetched once', async () => {
    client.fetchAllFantasyMarketValues.mockResolvedValue({ sport: 'NFL', values: [] })
    await openMarketValue()
    await waitFor(() => expect(screen.getByTestId('market-value-insufficient')).toBeTruthy())
    expect(screen.getByTestId('market-value-insufficient').textContent?.trim()).toBe(
      'Todavía no hay suficiente historial verificado del mercado de AllFantasy para publicar un valor de mercado oficial.',
    )
    expectFullySpanish()
    cleanup()

    client.fetchAllFantasyMarketValues.mockReturnValue(new Promise(() => {}))
    await openMarketValue()
    expect(document.body.textContent).toContain('Cargando…')
    expectFullySpanish()
    cleanup()

    client.fetchAllFantasyMarketValues.mockReset().mockRejectedValue('boom')
    await openMarketValue()
    await waitFor(() => expect(document.body.textContent).toContain('No se pudieron cargar los valores de mercado'))
    expectFullySpanish()
    await new Promise((r) => setTimeout(r, 50))
    expect(client.fetchAllFantasyMarketValues).toHaveBeenCalledTimes(1)
  })
})

// ── Reverse trade ───────────────────────────────────────────────────────────────────────────────

/** Every blocker either engine can return (`BLOCKER_COPY` in lib/trade-reversal/client.ts). */
const BLOCKERS = [
  'NO_EXECUTION_SNAPSHOT', 'ROSTER_CHANGED_SINCE_EXECUTION', 'PICK_CHANGED_SINCE_EXECUTION', 'CONTRACT_SNAPSHOT_MISSING',
  'CONTRACT_CHANGED_SINCE_EXECUTION', 'CONTRACT_RESTORATION_ILLEGAL', 'ALREADY_REVERSED', 'TRADE_NOT_PROCESSED',
  'PROPOSAL_NOT_ACCEPTED', 'TRADE_NOT_FOUND', 'PROPOSAL_NOT_FOUND', 'ROSTER_MISSING', 'SNAPSHOT_NOT_GENERIC',
  'SNAPSHOT_NOT_NATIVE', 'CAP_LEDGER_MISSING', 'CAP_RECORD_MOVED_SINCE_EXECUTION',
]

function renderReverse(preflight: () => Promise<unknown>, reverse: () => Promise<unknown> = async () => ({ ok: true })) {
  return render(
    <ReverseTradeDialog
      title="Los Halcones ⇄ Tigres del Norte"
      preflight={preflight as never}
      reverse={reverse as never}
      onClose={() => {}}
      onReversed={() => {}}
    />,
  )
}

describe('reverse trade dialog — Spanish', () => {
  it('checking', () => {
    renderReverse(() => new Promise(() => {}))
    expect(screen.getByTestId('reverse-trade-checking').textContent?.trim()).toBe('Comprobando si todavía se puede revertir este intercambio…')
    expect(screen.getByTestId('reverse-trade-cancel').textContent?.trim()).toBe('Cancelar')
    expectFullySpanish()
  })

  it('blocked: every known blocker in Spanish, and an unknown code still renders', async () => {
    renderReverse(async () => ({ ok: true, readiness: { ok: false, blockers: [...BLOCKERS, 'SOMETHING_NEW'] } }))
    await waitFor(() => expect(screen.getAllByTestId('reverse-trade-blocker')).toHaveLength(BLOCKERS.length + 1))
    const text = expectFullySpanish()
    expect(text).toContain('Revertir intercambio')
    expect(text).toContain('Este intercambio no se puede revertir:')
    const items = screen.getAllByTestId('reverse-trade-blocker').map((li) => li.textContent?.trim())
    BLOCKERS.forEach((code, i) => expect(items[i], code).toBe(es[`tradeCenter.reverseDialog.blocker.${code}`]))
    expect(items.at(-1)).toBe('Este intercambio no se puede revertir (SOMETHING_NEW).')
    expect(screen.getByTestId('reverse-trade-cancel').textContent?.trim()).toBe('Cerrar')
  })

  it('ready: the warning, the reason field and its placeholder, cancel and confirm', async () => {
    renderReverse(async () => ({ ok: true, readiness: { ok: true, blockers: [] } }))
    await waitFor(() => expect(screen.getByTestId('reverse-trade-confirm')).toBeTruthy())
    const text = expectFullySpanish()
    expectSpanishAttributes()
    expect(text).toContain('Las dos plantillas vuelven a como estaban antes de este intercambio, FAAB incluido.')
    expect(text).toContain('Motivo (queda registrado con la reversión)')
    expect(screen.getByTestId('reverse-trade-reason').getAttribute('placeholder')).toBe('p. ej., la revisión del comisionado encontró colusión')
    expect(screen.getByTestId('reverse-trade-cancel').textContent?.trim()).toBe('Cancelar')
    expect(screen.getByTestId('reverse-trade-confirm').textContent?.trim()).toBe('Revertir intercambio')
  })

  it('reversing', async () => {
    renderReverse(async () => ({ ok: true, readiness: { ok: true, blockers: [] } }), () => new Promise(() => {}))
    await waitFor(() => expect(screen.getByTestId('reverse-trade-reason')).toBeTruthy())
    fireEvent.change(screen.getByTestId('reverse-trade-reason'), { target: { value: 'colusión' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('reverse-trade-confirm'))
    })
    expect(screen.getByTestId('reverse-trade-confirm').textContent?.trim()).toBe('Revirtiendo…')
    expectFullySpanish()
  })
})

// ── Trade value breakdown ───────────────────────────────────────────────────────────────────────

const NO_SOURCES = { projectionValue: null, rankingValue: null, adpValue: null, fantasyCalcValue: null, idpValue: null }
const pl = (over: Partial<AssetValueSnapshot> = {}): AssetValueSnapshot => ({
  kind: 'player', fromRosterId: 'r1', toRosterId: 'r2', playerName: 'Juan Pérez', position: 'WR',
  sources: { ...NO_SOURCES, projectionValue: 240 }, internalValue: 6552, valuationBasis: 'projection', ...over,
})
const snap = (a: AssetValueSnapshot[], b: AssetValueSnapshot[] = []): TradeValueSnapshot =>
  ({
    version: '1.0',
    context: { sport: 'NFL', leagueType: 'redraft', scoring: 'ppr', rosterFormat: 'standard', capturedAt: '2026-09-02T00:00:00.000Z' },
    sides: [
      { rosterId: 'r1', total: a.reduce((s, x) => s + x.internalValue, 0), assets: a },
      { rosterId: 'r2', total: b.reduce((s, x) => s + x.internalValue, 0), assets: b },
    ],
    grade: { grade: 'B', fairnessScore: 70, confidenceScore: 60, valueDifference: 100, bullets: [] },
  }) as unknown as TradeValueSnapshot

describe('trade value breakdown — Spanish', () => {
  it('every basis, a pick, FAAB, an unnamed player, a missing basis, a format fit and a legality note', () => {
    const fit = { label: 'Superflex', fit: { multiplier: 1, reason: 'sin efecto en este formato' }, legality: { ok: false, reason: null } }
    render(
      <TradeValueBreakdown
        sideNames={{ r1: 'Los Halcones', r2: 'Tigres del Norte' }}
        snapshot={snap(
          [
            pl({ formatFit: fit as never }),
            pl({ playerName: 'Raúl Díaz', valuationBasis: 'idp' }),
            pl({ playerName: 'Pedro Ruiz', valuationBasis: 'market' }),
            pl({ playerName: '  ', valuationBasis: 'none', internalValue: 0 }),
          ],
          [
            { kind: 'draft_pick', fromRosterId: 'r2', toRosterId: 'r1', pickSeason: 2027, pickRound: 2, sources: NO_SOURCES, internalValue: 900 } as never,
            { kind: 'draft_pick', fromRosterId: 'r2', toRosterId: 'r1', sources: NO_SOURCES, internalValue: 500 } as never,
            { kind: 'faab', fromRosterId: 'r2', toRosterId: 'r1', faabAmount: 25, sources: NO_SOURCES, internalValue: 100 } as never,
            pl({ playerName: 'Mario López', valuationBasis: undefined, fromRosterId: 'r2', toRosterId: 'r1' }),
          ],
        )}
      />,
    )
    const text = expectFullySpanish()
    for (const s of [
      'Los Halcones envía', 'Tigres del Norte envía',
      es['tradeCenter.value.basis.projection.long']!, es['tradeCenter.value.basis.idp.long']!,
      es['tradeCenter.value.basis.market.long']!, es['tradeCenter.value.basis.none.long']!,
      'Proyección', 'Escasez IDP', 'Mercado', 'Sin valorar', 'Jugador sin nombre',
      '2027 Ronda 2', 'Selección del draft', '$25 FAAB',
      'Valorada según dónde cae realmente la selección en tu liga, no por el número de su ronda.',
      'Valorado según la propia cantidad.', 'Esta instantánea no registra cómo se valoró.',
      'sin cambio', '⚠ Este activo no se puede intercambiar ahora mismo.',
    ]) expect(text, s).toContain(s)
    expect(screen.getByTestId('tv-unpriced-note').textContent?.trim()).toBe(es['tradeCenter.value.unpriced.one'].replace('{{count}}', '1'))
  })

  it('two unpriced players, an unlabelled format, and an empty side', () => {
    const fit = { fit: { multiplier: 1.08, reason: 'premio por TE' }, legality: null }
    render(
      <TradeValueBreakdown
        snapshot={snap([pl({ valuationBasis: 'none', internalValue: 0, formatFit: fit as never }), pl({ playerName: 'Raúl Díaz', valuationBasis: 'none', internalValue: 0 })])}
      />,
    )
    const text = expectFullySpanish()
    expect(text).toContain('Formato · premio por TE')
    expect(text).toContain('+8%')
    expect(text).toContain('Nada en este lado.')
    expect(screen.getByTestId('tv-unpriced-note').textContent?.trim()).toBe(
      '⚠ No se pudieron valorar 2 jugadores de este intercambio, así que los totales de arriba están incompletos. Faltan datos por nuestra parte; no significa que no valgan nada.',
    )
  })
})
