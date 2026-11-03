/**
 * The Trade Center's panels rendering SERVER text (2026-10-31), in Spanish and in English, against the
 * real dictionaries and the real producers' payload shapes:
 *
 *   commissioner review   coded check explanations, the template note, a withheld grade, the act-on note, a coded error
 *   trade block           a withheld grade's reason, a code-only interest, a coded server error
 *   Find a Trade          coded match reasons, a coded server error
 *   value breakdown       a coded format label, fit reason and legality reason
 *   reverse trade         coded preflight and outcome refusals
 *
 * In Spanish, the mocked `t` falls back to the KEY, so a missing string shows as a raw key rather than
 * quietly as English. In English, every server sentence must reach the screen byte for byte.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { translations } from '@/lib/i18n/translations'

const lang = vi.hoisted(() => ({ current: 'es' as 'es' | 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const { interpolateTemplate } = await import('@/lib/i18n/interpolate')
  const value = () => {
    const language = lang.current
    const t = (key: string) => (language === 'es' ? dict.es[key] ?? key : dict.en[key] ?? key)
    return {
      language,
      setLanguage: () => {},
      t,
      tInterpolate: (key: string, vars: Record<string, string | number | undefined> = {}) => interpolateTemplate(t(key), vars),
    }
  }
  return { useOptionalLanguage: value, useLanguage: value }
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
}))
vi.mock('@/lib/redraft/client', () => client)

import { TradeReviewPanel } from '@/components/trade-review/TradeReviewPanel'
import { TradeBlockPanel, BlockOfferLine } from '@/app/league/[leagueId]/tabs/redraft/TradeBlockPanel'
import { TradeDiscoveryPanel } from '@/app/league/[leagueId]/tabs/redraft/TradeDiscoveryPanel'
import { ReverseTradeDialog } from '@/components/league-trade/ReverseTradeDialog'
import { TradeValueBreakdown } from '@/components/trade-value/TradeValueBreakdown'
import { buildTradeReview, type TradeReviewFacts } from '@/lib/decision-os/trade/tradeReview'
import { findPartners, type DiscoveryPlayer, type DiscoveryRoster } from '@/lib/trade-discovery/redraftTradeDiscovery'
import { formatModelForLeague } from '@/lib/trade-value/formats/registry'
import { buildLeagueShape } from '@/lib/trade-value/leagueShape'
import type { ReversalOutcome, ReversalPreflight } from '@/lib/trade-reversal/client'
import type { AssetValueSnapshot, TradeValueSnapshot } from '@/lib/trade-value/types'

const ENGLISH_WORDS =
  /\b(the|and|with|trade|trades|team|teams|this|that|could|not|graded|league|value|values|player|players|review|roster|rosters|reversed|changed|nothing|only|commissioner|interest|found|failed|have|has been|week|closed|locked|reason)\b/i
const ENGLISH_FRAGMENTS: RegExp[] = (() => {
  const out = new Map<string, RegExp>()
  for (const [key, value] of Object.entries(translations.en)) {
    if (!key.startsWith('tradeCenter.')) continue
    for (const raw of value.split(/\{\{[a-zA-Z0-9_]+\}\}/)) {
      const frag = raw.replace(/FAAB/g, '').trim()
      if (!/[A-Za-z]{3,}/.test(frag) || frag === 'has') continue
      const esc = frag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      out.set(frag, new RegExp(`(^|[^\\p{L}])${esc}($|[^\\p{L}])`, 'u'))
    }
  }
  return [...out.values()]
})()

function expectFullySpanish(root: ParentNode = document.body) {
  const text = root.textContent ?? ''
  const leftovers = ENGLISH_FRAGMENTS.filter((re) => re.test(text)).map((re) => re.source)
  expect(leftovers, `English left on the Spanish screen:\n${leftovers.join('\n')}\n---\n${text}`).toEqual([])
  expect(text.match(ENGLISH_WORDS)?.[0] ?? null, text).toBeNull()
  expect(text, 'raw i18n key on screen').not.toMatch(/tradeCenter\.[a-zA-Z]/)
  expect(text.toLowerCase()).not.toContain('waiver')
  expect(text).not.toMatch(/traspaso/i)
  return text
}

beforeEach(() => {
  vi.clearAllMocks()
  lang.current = 'es'
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// ── Commissioner review ─────────────────────────────────────────────────────────────────────────

const side = (over: Record<string, unknown> = {}) => ({
  startingBefore: 100, startingDelta: 2, receivedValue: 100, receivedBenchValue: 10, sentStarterNames: [] as string[], ...over,
})
const FACTS: TradeReviewFacts = {
  sides: [{ name: 'Halcones' }, { name: 'Tigres' }],
  gapPct: { ok: true, value: 48 },
  lineup: { ok: true, value: [side({ startingDelta: -20, receivedBenchValue: 80 }), side()] },
  history: { ok: true, value: [20, 20, 20] },
  inactiveDays: { ok: true, value: [20, 3] },
  playoffPct: { ok: false, reason: 'No season forecast has been run for this league.' },
  deadlineAt: { ok: true, value: null },
  now: '2026-10-01T00:00:00.000Z',
  managerDivisions: { ok: true, value: [3, 3] },
}
const REVIEW = buildTradeReview(FACTS)
const TEMPLATE_NOTE =
  'Flagged for the commissioner: a heavily lopsided value gap; a possible tanking signal; repeat trading partners leaning one way; an inactive manager. Some checks could not be run and are listed in the review.'
const body = (over: Record<string, unknown> = {}) => ({
  review: REVIEW,
  sides: ['Halcones', 'Tigres'],
  tradeGrade: { grade: null, partnerGrade: null, gradeWithheld: 'The priced assets carry no usable value.' },
  reviewId: null,
  explanation: { noteToLeague: TEMPLATE_NOTE, headline: 'h', source: 'template' },
  actOn: { platform: 'Sleeper', deepLink: 'https://sleeper.com/x', note: 'Approve or veto this trade on Sleeper.' },
  ...over,
})

async function openReview(payload: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => payload })))
  render(<TradeReviewPanel leagueId="L" tradeId="t1" kind="redraft" defaultOpen />)
  await waitFor(() => expect(document.body.textContent).not.toContain(lang.current === 'es' ? 'Revisando…' : 'Reviewing…'))
}

describe('commissioner review', () => {
  it('Spanish: every check explanation, the template note, the withheld grade and the act-on note', async () => {
    expect(REVIEW.flags.map((f) => f.code)).toEqual(['heavily_lopsided', 'tanking_signal', 'repeat_partners', 'inactive_manager'])
    await openReview(body())
    await waitFor(() => expect(screen.getByTestId('trade-review-flags')).toBeTruthy())
    expectFullySpanish()
    const flags = screen.getByTestId('trade-review-flags').textContent!
    expect(flags).toContain('Halcones recibe un 48% más de valor de liga: supera la línea del 40% de un intercambio muy desequilibrado.')
    expect(flags).toContain('La alineación titular proyectada de Halcones baja 20.0 puntos esta semana (un 20% del total), y el 80% del valor que recibe no sería titular.')
    expect(flags).toContain('Estos dos equipos han hecho 3 intercambios esta temporada, y todos favorecen a Halcones.')
    expect(flags).toContain('La plantilla de Halcones no ha cambiado en 20 días; a partir de 14 días se considera inactiva.')
    expect(screen.getByTestId('trade-review-not-checked').textContent).toContain(
      'Equipo eliminado regalando jugadores: Todavía no se ha hecho un pronóstico de temporada para esta liga.',
    )
    expect(screen.getByTestId('trade-review-note').textContent).toBe(
      'Señalado para el comisionado: una diferencia de valor muy desequilibrada; una posible señal de perder a propósito; los mismos equipos intercambiando siempre hacia el mismo lado; un mánager inactivo. Algunas comprobaciones no se pudieron hacer y aparecen en la revisión.',
    )
    expect(document.body.textContent).toContain('Sin calificar: Los activos valorados no tienen un valor utilizable.')
    expect(screen.getByTestId('trade-review-act-on').textContent).toBe('Aprueba o veta este intercambio en Sleeper. Abrir Sleeper')
  })

  it('English: the server’s sentences reach the screen byte for byte', async () => {
    lang.current = 'en'
    await openReview(body())
    await waitFor(() => expect(screen.getByTestId('trade-review-flags')).toBeTruthy())
    const flags = screen.getByTestId('trade-review-flags').textContent!
    for (const c of REVIEW.checks.filter((x) => x.status === 'raised')) expect(flags).toContain(c.explanation)
    const notRun = REVIEW.checks.find((c) => c.status === 'not_computed')!
    expect(screen.getByTestId('trade-review-not-checked').textContent).toBe(`Not checkedEliminated team dumping: ${notRun.explanation}`)
    expect(screen.getByTestId('trade-review-note').textContent).toBe(TEMPLATE_NOTE)
    expect(document.body.textContent).toContain('Not graded: The priced assets carry no usable value.')
    expect(screen.getByTestId('trade-review-act-on').textContent).toBe('Approve or veto this trade on Sleeper. Open Sleeper')
  })

  it('an AI note and a review stored before the codes stay as written; nothing falls back to a raw key', async () => {
    const stored = { ...REVIEW, checks: REVIEW.checks.map(({ explanationParts: _drop, ...c }) => c) }
    await openReview(body({ review: stored, explanation: { noteToLeague: 'Una nota escrita por el modelo.', headline: 'h', source: 'ai' } }))
    await waitFor(() => expect(screen.getByTestId('trade-review-flags')).toBeTruthy())
    expect(screen.getByTestId('trade-review-note').textContent).toBe('Una nota escrita por el modelo.')
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/tradeCenter\./)
    // The stored English is what an older review has; it shows rather than vanishing.
    expect(text).toContain(REVIEW.checks[0]!.explanation)
  })

  it('a coded route error: Spanish copy, and the English is the route’s', async () => {
    const err = { error: 'Only the commissioner or a co-commissioner can review a trade.', code: 'not_commissioner' }
    await openReview(err, false)
    await waitFor(() => expect(document.body.textContent).toContain('Solo el comisionado o un cocomisionado puede revisar un intercambio.'))
    expectFullySpanish()
    cleanup()
    lang.current = 'en'
    await openReview(err, false)
    await waitFor(() => expect(document.body.textContent).toContain(err.error))
  })
})

// ── Trade block ─────────────────────────────────────────────────────────────────────────────────

async function openBlock() {
  render(<TradeBlockPanel leagueId="L" myRosterId="r1" currentWeek={3} onBuildProposal={() => {}} />)
  await act(async () => {
    fireEvent.click(screen.getByTestId('trade-block-toggle'))
  })
}
const INTERESTS = [
  { id: 'x1', playerId: null, playerName: null, position: null, interestType: 'position_need', visibility: 'private', note: null },
  { id: 'x2', playerId: null, playerName: null, position: null, interestType: 'faab_interest', visibility: 'public', note: null },
  { id: 'x3', playerId: null, playerName: null, position: null, interestType: 'brand_new_type', visibility: 'private', note: null },
]

describe('trade block', () => {
  it('a withheld grade’s reason, in Spanish and in English', () => {
    const offer = { gives: ['A'], receives: ['B'], grade: { graded: false as const, reason: 'One side of this trade has no assets recorded.' } }
    render(<BlockOfferLine offer={offer} />)
    expect(screen.getByTestId('block-offer-grade-withheld').textContent).toBe('Sin calificar: Un lado del intercambio no tiene activos registrados.')
    cleanup()
    lang.current = 'en'
    render(<BlockOfferLine offer={offer} />)
    expect(screen.getByTestId('block-offer-grade-withheld').textContent).toBe('Not graded: One side of this trade has no assets recorded.')
  })

  it('a code-only interest: Spanish words, the raw code in English, and an unknown type keeps its code', async () => {
    client.fetchLeagueTradeBlock.mockResolvedValue({ items: [] })
    client.fetchMyInterests.mockResolvedValue({ interests: INTERESTS })
    client.fetchRedraftRoster.mockResolvedValue({ players: [] })
    await openBlock()
    await waitFor(() => expect(document.body.textContent).toContain('necesidad de posición (privado)'))
    expect(document.body.textContent).toContain('interés en FAAB (público)')
    expect(document.body.textContent).toContain('brand_new_type (privado)')
    expect(document.body.textContent).not.toContain('position_need')
    cleanup()
    lang.current = 'en'
    await openBlock()
    await waitFor(() => expect(document.body.textContent).toContain('position_need (private)'))
    expect(document.body.textContent).toContain('faab_interest (public)')
  })

  it('a coded server error on load and on an action, in Spanish; English keeps the server’s message', async () => {
    const noRoster = Object.assign(new Error('You do not have a roster in this league'), { code: 'no_roster', status: 403 })
    client.fetchLeagueTradeBlock.mockRejectedValue(noRoster)
    client.fetchMyInterests.mockResolvedValue({ interests: [] })
    client.fetchRedraftRoster.mockResolvedValue({ players: [] })
    await openBlock()
    await waitFor(() => expect(document.body.textContent).toContain('No tienes una plantilla en esta liga.'))
    expectFullySpanish()
    cleanup()

    client.fetchLeagueTradeBlock.mockResolvedValue({ items: [] })
    client.fetchRedraftRoster.mockResolvedValue({ players: [{ id: 'b', playerId: 'p5', playerName: 'Raúl Díaz', position: 'TE', team: 'MIA' }] })
    client.addTradeBlockItem.mockRejectedValue(
      Object.assign(new Error('Cannot list a player you do not own on the trade block'), { code: 'not_owned', status: 422 }),
    )
    await openBlock()
    await waitFor(() => expect(screen.getByTestId('block-toggle-p5')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByTestId('block-toggle-p5'))
    })
    await waitFor(() => expect(document.body.textContent).toContain('No puedes poner en el bloque de intercambios a un jugador que no es tuyo.'))
    expectFullySpanish()
    cleanup()

    lang.current = 'en'
    client.fetchLeagueTradeBlock.mockRejectedValue(noRoster)
    await openBlock()
    await waitFor(() => expect(document.body.textContent).toContain('You do not have a roster in this league'))
  })
})

// ── Find a Trade ────────────────────────────────────────────────────────────────────────────────

const dp = (playerId: string, position: string, value: number | null): DiscoveryPlayer => ({ playerId, playerName: `${position} ${playerId}`, position, value, isLocked: false })
const ME: DiscoveryRoster = {
  rosterId: 'r1', teamName: 'Mine', stance: 'contender', weakPositions: ['WR'], strongPositions: ['RB'], faabBalance: 50, recentTradeCount: 1,
  players: [dp('a1', 'RB', 4000), dp('a2', 'RB', 3500), dp('a3', 'RB', 3000), dp('q1', 'QB', 4500), dp('t1', 'TE', 2500)],
}
const THEM: DiscoveryRoster = {
  rosterId: 'r2', teamName: 'Tigres del Norte', stance: 'rebuilder', weakPositions: ['RB'], strongPositions: ['WR'], faabBalance: 30, recentTradeCount: 2,
  players: [dp('w1', 'WR', 3800), dp('w2', 'WR', 3400), dp('w3', 'WR', 3000), dp('q2', 'QB', 4000), dp('t2', 'TE', 2400)],
}
const [MATCH] = findPartners({ myRoster: ME, otherRosters: [THEM], sport: 'NFL', hasNativeBlock: true })

async function openDiscovery() {
  render(<TradeDiscoveryPanel leagueId="L" myRosterId="r1" onBuildProposal={() => {}} />)
  await act(async () => {
    fireEvent.click(screen.getByTestId('trade-discovery-toggle'))
  })
}

describe('Find a Trade', () => {
  it('the real finder’s match reasons, in Spanish and then byte for byte in English', async () => {
    expect(MATCH!.matchReasons.length).toBeGreaterThanOrEqual(2)
    client.fetchTradeDiscovery.mockResolvedValue({ partners: [MATCH] })
    await openDiscovery()
    await waitFor(() => expect(screen.getByTestId('discovery-partner-card')).toBeTruthy())
    const card = screen.getByTestId('discovery-partner-card').textContent!
    expect(card).toContain('• Te sobra RB y ellos lo necesitan')
    expect(card).toContain('• Tienen WR y tú lo necesitas')
    expectFullySpanish()
    cleanup()

    lang.current = 'en'
    await openDiscovery()
    await waitFor(() => expect(screen.getByTestId('discovery-partner-card')).toBeTruthy())
    const items = Array.from(screen.getByTestId('discovery-partner-card').querySelectorAll('li')).map((li) => li.textContent)
    expect(items).toEqual(MATCH!.matchReasons.slice(0, 2).map((r) => `• ${r}`))
  })

  it('a coded load error in Spanish', async () => {
    client.fetchTradeDiscovery.mockRejectedValue(Object.assign(new Error('You can only discover trades for your own team'), { code: 'own_team_only', status: 403 }))
    await openDiscovery()
    await waitFor(() => expect(document.body.textContent).toContain('Solo puedes buscar intercambios para tu propio equipo.'))
    expectFullySpanish()
  })
})

// ── Value breakdown ─────────────────────────────────────────────────────────────────────────────

const shape = buildLeagueShape({ teams: 12, starterSlots: ['QB', 'RB', 'WR', 'FLEX'], rosterSize: 16, deadlineWeek: 12 })!
const KOTH = formatModelForLeague({ leagueType: 'redraft', aliasTags: ['king_of_the_hill'] })!
const kothInput = { base: 5000, position: 'WR', shape, teamState: { viewerIsKing: true, weeklyLossProbability: 0.4, playoffStartWeek: 14 }, assetState: { topThreeScorerProbability: 0.5 }, currentWeek: 14 }
const FORMAT_FIT = { formatId: KOTH.formatId, label: KOTH.label, fit: KOTH.adjust(kothInput), legality: KOTH.canTrade!(kothInput) }
const NO_SOURCES = { projectionValue: null, rankingValue: null, adpValue: null, fantasyCalcValue: null, idpValue: null }
const asset: AssetValueSnapshot = {
  kind: 'player', fromRosterId: 'r1', toRosterId: 'r2', playerName: 'Juan Pérez', position: 'WR',
  sources: { ...NO_SOURCES, projectionValue: 240 }, internalValue: 6552, valuationBasis: 'projection', formatFit: FORMAT_FIT as never,
} as AssetValueSnapshot
const SNAP = {
  version: '1.0',
  context: { sport: 'NFL', leagueType: 'redraft', scoring: 'ppr', rosterFormat: 'standard', capturedAt: '2026-09-02T00:00:00.000Z' },
  sides: [{ rosterId: 'r1', total: 6552, assets: [asset] }, { rosterId: 'r2', total: 0, assets: [] }],
  grade: { grade: 'B', fairnessScore: 70, confidenceScore: 60, valueDifference: 100, bullets: [] },
} as unknown as TradeValueSnapshot

describe('value breakdown', () => {
  it('a coded format label, fit reason and legality reason: Spanish, then the model’s English byte for byte', () => {
    expect(FORMAT_FIT.legality.ok).toBe(false)
    render(<TradeValueBreakdown snapshot={SNAP} sideNames={{ r1: 'Halcones', r2: 'Tigres' }} />)
    expect(screen.getByTestId('tv-asset-fit-reason').textContent).toBe(
      'Rey de la Colina · Como Rey actual, esta plantilla tiene un 20.0% de probabilidad estimada de perder a este jugador por la regla que manda a la agencia libre a los tres que más puntúan esa semana tras una derrota.',
    )
    expect(screen.getByTestId('tv-asset-legality').textContent).toBe('⚠ El Rey de la Colina termina cuando empiezan los playoffs, en la semana 14.')
    expect(screen.getByTestId('tv-asset-fit-reason').textContent!.toLowerCase()).not.toContain('waiver')
    cleanup()

    lang.current = 'en'
    render(<TradeValueBreakdown snapshot={SNAP} sideNames={{ r1: 'Halcones', r2: 'Tigres' }} />)
    expect(screen.getByTestId('tv-asset-fit-reason').textContent).toBe(`King of the Hill · ${FORMAT_FIT.fit!.reason}`)
    expect(screen.getByTestId('tv-asset-legality').textContent).toBe(`⚠ ${FORMAT_FIT.legality.reason}`)
  })
})

// ── Reverse trade ───────────────────────────────────────────────────────────────────────────────

function renderReverse(preflight: () => Promise<ReversalPreflight>, reverse: () => Promise<ReversalOutcome> = async () => ({ ok: true })) {
  render(<ReverseTradeDialog title="Halcones ⇄ Tigres" preflight={preflight} reverse={reverse} onClose={() => {}} onReversed={() => {}} />)
}

describe('reverse trade dialog', () => {
  it('a coded preflight refusal: Spanish, and the client’s English in English', async () => {
    const pre = async (): Promise<ReversalPreflight> => ({ ok: false, message: 'Could not reach AllFantasy to check this trade. Try again.', messageCode: 'unreachable', status: 0 })
    renderReverse(pre)
    await waitFor(() => expect(screen.getByTestId('reverse-trade-unavailable').textContent).toBe(
      'No se pudo conectar con AllFantasy para comprobar este intercambio. Inténtalo de nuevo.',
    ))
    expectFullySpanish()
    cleanup()
    lang.current = 'en'
    renderReverse(pre)
    await waitFor(() => expect(screen.getByTestId('reverse-trade-unavailable').textContent).toBe('Could not reach AllFantasy to check this trade. Try again.'))
  })

  it('a refused reversal, with and without the server’s blockers, in Spanish', async () => {
    const ready = async (): Promise<ReversalPreflight> => ({ ok: true, readiness: { ok: true, blockers: [] } })
    const confirm = async () => {
      await waitFor(() => expect(screen.getByTestId('reverse-trade-reason')).toBeTruthy())
      fireEvent.change(screen.getByTestId('reverse-trade-reason'), { target: { value: 'colusión' } })
      await act(async () => {
        fireEvent.click(screen.getByTestId('reverse-trade-confirm'))
      })
    }
    renderReverse(ready, async () => ({
      ok: false, message: 'Trade reversal failed Nothing was changed.', messageCode: 'server', serverError: 'Trade reversal failed', serverCode: 'REVERSAL_FAILED', status: 500, readiness: null,
    }))
    await confirm()
    await waitFor(() => expect(screen.getByTestId('reverse-trade-error').textContent).toBe('No se pudo revertir el intercambio. No se cambió nada.'))
    expectFullySpanish()
    cleanup()

    renderReverse(ready, async () => ({
      ok: false, message: 'Trade cannot be reversed Nothing was changed.', messageCode: 'server', serverError: 'Trade cannot be reversed', serverCode: 'REVERSAL_BLOCKED', status: 409,
      readiness: { ok: false, blockers: ['ALREADY_REVERSED'] },
    }))
    await confirm()
    await waitFor(() => expect(document.body.textContent).toContain('Este intercambio no se puede revertir. No se cambió nada.'))
    expectFullySpanish()
  })
})
