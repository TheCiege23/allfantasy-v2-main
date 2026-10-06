/**
 * The player card pop-up and the Waivers screens' Competitive Edge card in Spanish (2026-10-06) —
 * components/core-app/player-card/PlayerCardSheet.tsx (with PlayerValueHistoryChart inside it) and
 * components/core-app/screens/WaiverCompetitiveEdge.tsx.
 *
 * Every card the sheet can draw is rendered in Spanish — the universal flavour with every section
 * full, the league flavour as yours and as someone else's, every section empty with the loader's real
 * reasons, the loading and error states, and a viewer without AF Pro — and the whole DOM (text,
 * titles, aria-labels) is read against the card's own English vocabulary, English weekdays and months.
 * Only PROVIDER text is cut out of the scan (`PROVIDER_TEXT` says why).
 *
 * Every derived value is REAL output: the insight comes from playerCard.ts `deriveInsight`, the waiver
 * facts from waiverEdge.ts `buildWaiverEdge`, the trade-block notes from `tradeBlockSupport`, the
 * schedule sentence from scheduleProjectionNote.ts. The fixed loader reasons are DB-bound, so each one
 * `playerCardReasonText` knows is held to its loader's source verbatim instead — a reworded reason
 * fails here rather than silently going English.
 *
 * English mode is held too: the same fixtures render the English they always did.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: new Proxy({}, { get: () => new Proxy({}, { get: () => async () => null }) }) }))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import PlayerCardSheet from '@/components/core-app/player-card/PlayerCardSheet'
import { WaiverCompetitiveEdge } from '@/components/core-app/screens/WaiverCompetitiveEdge'
import { deriveInsight, type PlayerCardData, type PlayerCardTrade, type PlayerCardWeek } from '@/lib/core-app/playerCard'
import { buildWaiverEdge } from '@/lib/competitive-edge/waiverEdge'
import { tradeBlockSupport } from '@/lib/trade-block/importedTradeBlock'
import { PLAYER_CARD_REASON_KEYS, playerCardReasonText } from '@/lib/core-app/playerCardCopy'
import { scheduleProjectionNote } from '@/lib/core-app/scheduleProjectionNote'

const EN_DAY = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/
const EN_MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/
/**
 * The card's own English, word by word, and the waiver card's. Names in the fixtures avoid every one.
 * Kept in Spanish on purpose, so not here: vs, @, SF, 1QB, superflex, redraft, PPR, AF, IR, TAXI, FAAB,
 * Sleeper, AF Pro, and "Competitive Edge" as the lock's product name. "EXP." is asserted separately —
 * Spanish abbreviates experience the same way.
 */
const OWN_EN =
  /\b(Back|player card|Follow|Unfollow|Following|every league|Watch|watching|Watching|watchlist|Close|FREE AGENT|ON YOUR ROSTER|OWNED BY|another manager|Propose Trade|trade block|TRADE BLOCK|Take off|listed|ago|AGE|HT|WT|COLLEGE|ROOKIE|Loading|could not|feed|checked|last error|skipped|budget|Based on|price|prices|PRICE|not priced|SLOT|no move|OVERALL|RK|ROSTERED|AF leagues|start|one-QB|dynasty|No market|WK|BYE|projection|engine|Both are|SCHEDULE|NEXT UP|PLAYOFF|YOUR ROSTER|nobody|TRADES|RECENT|No trade|leagues AllFantasy|LATEST|Cost(?= )|Package|Moved with|grade|Got him|Paid|values|today|Not graded|Week|Weeks|week|published|fixtures?|lineup|Value over time|By season|Bars|STARTER|BENCH|NOT ROSTERED|QUESTIONABLE|Questionable|days|season|Rostered|Priced|hedging|Bye|buy|window|snapshots|nearest|1st|2nd|Sign in|No injury|rise|fall|Competitive Edge ·|other managers|waiver|claims?|bid|bids|winning|Counted|It shows|out of date|Sleeper doesn't|has won|left|more than|less than|the same as|Their|of their|This league|league|leagues|assets?|chart|Trade history|similar players|is part of|Upgrade|Free until|then)\b/

/** Provider text, cut out of the scan: the feed's own words, never translated. */
const PROVIDER_TEXT: Record<string, string> = {
  '.af-pc-news-t': 'news headlines are the feed’s own sentence',
  '.af-pc-injury-n': 'the injury feed’s note is the provider’s prose',
}

function ownText(container: HTMLElement): string {
  const root = container.cloneNode(true) as HTMLElement
  for (const sel of Object.keys(PROVIDER_TEXT)) root.querySelectorAll(sel).forEach((n) => n.remove())
  const attrs = [...root.querySelectorAll('[title],[aria-label],[placeholder]')].flatMap((n) => [
    n.getAttribute('title') ?? '',
    n.getAttribute('aria-label') ?? '',
    n.getAttribute('placeholder') ?? '',
  ])
  const nodes: string[] = []
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n.textContent ?? '')
  return [root.textContent ?? '', nodes.join(' '), ...attrs].join(' | ')
}

function expectSpanish(out: string, label: string) {
  expect(out, label).not.toMatch(EN_DAY)
  expect(out, label).not.toMatch(EN_MONTH)
  const hit = out.match(OWN_EN)
  expect(hit?.[0] ?? null, `${label}: …${hit ? out.slice(Math.max(0, hit.index! - 60), hit.index! + 60) : ''}…`).toBeNull()
}

/** Tuesday 2026-10-06, noon ET. */
const NOW = new Date('2026-10-06T16:00:00.000Z')

const HISTORY = {
  points: [
    { day: '2026-09-14', value: 5100 },
    { day: '2026-09-28', value: 5400 },
  ],
  description: 'dynasty · superflex',
  scope: 'universal-market',
  note: 'Recorded market prices, not fantasy points or league scoring adjustments. Missing capture weeks remain gaps.',
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => HISTORY })),
  )
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  lang.language = 'en'
})

/* ── fixtures ───────────────────────────────────────────────────────────────────────────────────── */

const no = (reason: string) => ({ available: false as const, reason })
const yes = <T,>(data: T) => ({ available: true as const, data })

const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

const GRADED_AT_TRADE: PlayerCardTrade = {
  transactionId: 'tx-1',
  platform: 'sleeper',
  leagueName: 'Ice Kings',
  tradeDate: '2026-09-14T17:00:00.000Z',
  acquired: ['Jahmyr Gibbs', 'Amon-Ra St. Brown'],
  sent: ['Bijan Robinson'],
  picks: ['2027 1st', '2028 2nd'],
  grade: {
    graded: true,
    acquirerLetter: 'B',
    senderLetter: 'D',
    got: 5000,
    gave: 4000,
    frozenAt: '2026-09-15T12:00:00.000Z',
    frozenBasis: 'trade_date',
    pricedAsOf: '2026-09-14',
    tradeAt: '2026-09-14T17:00:00.000Z',
  },
}
const GRADED_FIRST: PlayerCardTrade = {
  ...GRADED_AT_TRADE,
  transactionId: 'tx-2',
  picks: [],
  grade: {
    graded: true,
    acquirerLetter: 'A',
    senderLetter: 'F',
    got: 6100,
    gave: 3900,
    frozenAt: '2026-09-30T12:00:00.000Z',
    frozenBasis: 'first_graded',
    pricedAsOf: '2026-09-30',
    tradeAt: '2026-09-14T17:00:00.000Z',
  },
}
const WITHHELD: PlayerCardTrade = {
  ...GRADED_AT_TRADE,
  transactionId: 'tx-3',
  sent: [],
  picks: [],
  grade: { graded: false, withheld: 'One side of this trade has no assets recorded.' },
}

const WEEKS: PlayerCardWeek[] = [
  { week: 5, opponent: 'CHI', home: true, bye: false, projection: 17.4, projectionKind: 'current', afProjection: 16.9 },
  { week: 6, opponent: null, home: false, bye: true, projection: null, futureStatus: 'unchecked' },
  { week: 7, opponent: 'GB', home: false, bye: false, projection: 15.2, projectionKind: 'future', futureStatus: 'published', projectionAsOf: '2026-10-01T10:00:00.000Z' },
  { week: 8, opponent: 'MIN', home: true, bye: false, projection: null, futureStatus: 'not_published', projectionAsOf: '2026-10-02T10:00:00.000Z' },
  { week: 9, opponent: 'TB', home: false, bye: false, projection: null, futureStatus: 'unchecked' },
]

const MARKET = {
  value: 5400,
  overallRank: 12,
  positionRank: 4,
  delta: { change: 310, days: 7 },
  format: 'DYNASTY',
  qbFormat: 'SUPERFLEX',
  source: 'fantasycalc',
  capturedAt: daysAgo(1),
}
const OWNERSHIP = { ownPct: 0.82, startPct: 0.44, rosteredIn: 41, startedIn: 22, leaguesCounted: 50 }
const COMPS = [
  { sleeperId: '4866', name: 'Saquon Barkley', position: 'RB', value: 5500 },
  { sleeperId: '9509', name: 'Bijan Robinson', position: 'RB', value: 5350 },
]
const NEWS = [
  { title: 'Gibbs limited at practice Wednesday', source: 'ESPN', url: 'https://example.com/a', publishedAt: daysAgo(0.2) },
  { title: 'Gibbs: full participant', source: 'Rotowire', url: null, publishedAt: daysAgo(3) },
]

function universal(over: Partial<PlayerCardData> = {}): PlayerCardData {
  const market = yes(MARKET)
  const ownership = yes(OWNERSHIP)
  const comps = yes(COMPS)
  return {
    context: 'universal',
    player: { externalId: 'sleeper:9221', sleeperId: '9221', sport: 'NFL', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', number: 26, imageUrl: null },
    bio: { age: 24, height: '5\'9"', weight: '200 lb', yearsExp: 0, college: 'Alabama' },
    market,
    ownership,
    schedule: yes({ weeks: WEEKS, season: 2026, projectedWeek: 5, futureWeeks: { enabled: true as const } }),
    byeWeek: 6,
    trades: yes([GRADED_AT_TRADE, GRADED_FIRST, WITHHELD]),
    comps,
    news: yes(NEWS),
    injury: yes({ status: 'QUESTIONABLE', note: 'Hamstring - Questionable for Week 5 vs. Chicago', bodyPart: 'Hamstring', reportedAt: daysAgo(1), source: 'sleeper' }),
    injuryFeed: yes({ checkedAt: daysAgo(0.1), erroredAt: daysAgo(0.02), skipped: 2 }),
    insight: deriveInsight({ name: 'Jahmyr Gibbs', market, ownership, byeWeek: 6, comps }),
    league: null,
    follow: { following: false },
    depth: null,
    ...over,
  } as PlayerCardData
}

type League = NonNullable<PlayerCardData['league']>

function league(over: Partial<League> = {}): League {
  return {
    leagueId: 'lg-42',
    leagueName: 'Ice Kings',
    platform: 'sleeper',
    slot: 'BENCH',
    isYours: true,
    owner: { teamName: 'Gibbs Galore', ownerName: 'TheCiege26' },
    price: yes({ value: 6120, mode: 'dynasty', numQbs: 2 as const, teams: 12 }),
    yourRoster: [
      { name: 'Breece Hall', value: 4800 },
      { name: 'Kyren Williams', value: null },
    ],
    trades: [GRADED_FIRST],
    playoffSchedule: yes({ weeks: WEEKS.slice(0, 3), startWeek: 15 }),
    watched: false,
    tradeBlock: { ...tradeBlockSupport('sleeper'), listed: false, byYou: false, teamName: null, since: null },
    ...over,
  }
}

function sheet(data: PlayerCardData | null, status: 'loading' | 'ready' | 'error' = 'ready') {
  return render(
    <PlayerCardSheet
      subject={{ sport: 'NFL', sleeperId: '9221', name: 'Jahmyr Gibbs', position: 'RB' }}
      data={data}
      status={status}
      onClose={() => {}}
      onOpen={() => {}}
    />,
  )
}

/** Expand the insight so its detail and basis are in the DOM, and wait for the value chart. */
async function settle(container: HTMLElement, withChart = true) {
  const insight = container.querySelector('.af-pc-insight-h')
  if (insight) fireEvent.click(insight)
  if (withChart) await waitFor(() => expect(container.querySelector('table')).not.toBeNull())
}

const lockedAccess = {
  depth: 'player_depth',
  unlocked: false,
  hasPlan: false,
  preLaunchFree: false,
  startsAt: '2026-10-15T04:00:00.000Z',
  planName: 'AF Pro',
  label: 'Player deep dives',
  upgradePath: '/pro',
} as never
const freeAccess = { ...(lockedAccess as object), unlocked: true, preLaunchFree: true } as never

/* ── the player card ────────────────────────────────────────────────────────────────────────────── */

describe('player card — Spanish', () => {
  beforeEach(() => {
    lang.language = 'es'
  })

  it('the universal card, every section full, reads Spanish throughout', async () => {
    const { container } = sheet(universal({ depth: freeAccess }))
    await settle(container)
    const out = ownText(container)
    expectSpanish(out, 'universal')
    // The header and the follow star.
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Ficha de Jahmyr Gibbs')
    expect(out).toContain('‹ Volver')
    expect(container.querySelector('.af-pc-star')?.getAttribute('aria-label')).toBe('Seguir a Jahmyr Gibbs')
    expect(container.querySelector('.af-pc-x')?.getAttribute('aria-label')).toBe('Cerrar la ficha del jugador')
    // Bio: a rookie, and Spanish labels; the provider's height and weight stay.
    expect(out).toContain('EDAD')
    expect(out).toContain('EXP.')
    expect(out).toContain('NOVATO')
    expect(out).toContain('UNIVERSIDAD')
    // Availability: the designation is Player Finder's word, the stamp says when.
    expect(container.querySelector('.af-pc-injury-s')?.textContent).toBe('DUDOSO')
    expect(container.querySelector('.af-pc-feed')?.textContent).toBe(
      'fuente revisada hace 2 h · último error hace 29 min · 2 ejecuciones omitidas por presupuesto',
    )
    // The insight, built from its parts.
    expect(out).toContain('El precio de Gibbs subió 310 en 7 días.')
    expect(out).toContain('Ahora vale 5,400, un 6.1% más.')
    expect(out).toContain('Basado en dinastía · superflex · registros de fantasycalc con 7 días de diferencia.')
    // Tiles and the price basis.
    expect(out).toContain('PRECIO DE INTERCAMBIO')
    expect(out).toContain('+310 · 7 d')
    expect(out).toContain('RANGO POS. · RB')
    expect(out).toContain('de 50 ligas de AF · 44% titular')
    expect(out).toContain('dinastía · superflex · fantasycalc')
    // The schedule strip.
    expect(out).toContain('SEM 5 · vs CHI')
    expect(out).toContain('SEM 6 · DESCANSO')
    expect(out).toContain('aún sin publicar')
    expect(out).toContain('líneas PPR tempranas de Sleeper, al 1 oct')
    // Trades: the frozen grade says WHEN, through gradeMoment — never "values today".
    expect(out).toContain('Costó Bijan Robinson + 2027 · ronda 1 + 2028 · ronda 2')
    expect(out).toContain('Llegó junto a Amon-Ra St. Brown')
    expect(out).toContain('5,000 por 4,000 con los valores de la liga en la fecha del traspaso (14 sep)')
    expect(out).toContain(
      '6,100 por 3,900 con los valores de la liga del 30 sep 2026, 16 días después del traspaso (no hay registro del mercado de la fecha del traspaso)',
    )
    expect(out).not.toContain('de hoy')
    expect(out).toContain('Sin calificar: Un lado del intercambio no tiene activos registrados.')
    expect(out).toContain('Paquete no registrado')
    // Value history chart (PlayerValueHistoryChart) inside the card.
    expect(out).toContain('Valor a lo largo del tiempo')
    // Provider text stays: names, the feed's headline and source.
    expect(container.textContent).toContain('Gibbs limited at practice Wednesday')
    expect(container.textContent).toContain('Saquon Barkley')
  })

  it('every insight the card can derive, built in Spanish from its parts', async () => {
    const market = yes({ ...MARKET, delta: { change: -400, days: 7 } })
    const variants: Array<[string, PlayerCardData['insight'], string]> = [
      ['price down', deriveInsight({ name: 'Jahmyr Gibbs', market, ownership: no('x'), byeWeek: null, comps: no('x') }), 'Una caída de este tamaño'],
      ['hedge', deriveInsight({ name: 'Jahmyr Gibbs', market: no('x'), ownership: yes(OWNERSHIP), byeWeek: null, comps: no('x') }), 'Está en plantillas del 82% de nuestras ligas, pero solo es titular en el 44% de ellas.'],
      ['bye', deriveInsight({ name: 'Jahmyr Gibbs', market: no('x'), ownership: no('x'), byeWeek: 6, comps: no('x') }), 'Descansa en la semana 6'],
      ['comps', deriveInsight({ name: 'Jahmyr Gibbs', market: no('x'), ownership: no('x'), byeWeek: null, comps: yes(COMPS) }), 'Con un precio similar al de Saquon Barkley, Bijan Robinson.'],
    ]
    for (const [label, insight, phrase] of variants) {
      expect(insight?.parts, label).toBeTruthy()
      const { container, unmount } = sheet(universal({ insight }))
      await settle(container)
      const out = ownText(container)
      expectSpanish(out, label)
      expect(out, label).toContain(phrase)
      unmount()
    }
  })

  it('the league card, yours: slot, league price, playoff weeks, your roster, the trade-block button', async () => {
    const { container } = sheet(universal({ context: 'league', league: league() }))
    await settle(container)
    const out = ownText(container)
    expectSpanish(out, 'league, yours')
    expect(out).toContain('‹ Ice Kings')
    expect(out).toContain('EN TU PLANTILLA')
    expect(out).toContain('PRECIO EN LA LIGA')
    expect(out).toContain('dinastía · SF · 12 equipos')
    expect(out).toContain('BANCA')
    expect(out).toContain('CALENDARIO DE PLAYOFFS · SEM 15-17')
    expect(out).toContain('TU PLANTILLA EN RB')
    expect(out).toContain('INTERCAMBIOS EN ESTA LIGA')
    expect(container.querySelector('.af-pc-block-btn')?.textContent).toBe('Poner en venta')
    expect(out).toContain('Sleeper no comparte sus jugadores en venta con apps externas')
  })

  it('the league card, someone else’s: owner, Propose Trade, their block listing, the watchlist star', async () => {
    const data = universal({
      context: 'league',
      follow: null,
      league: league({
        isYours: false,
        slot: 'STARTER',
        owner: { teamName: 'Gibbs Galore', ownerName: null },
        tradeBlock: { ...tradeBlockSupport('sleeper'), listed: true, byYou: false, teamName: 'Gibbs Galore', since: daysAgo(3) },
      }),
    })
    const { container } = sheet(data)
    await settle(container)
    const out = ownText(container)
    expectSpanish(out, 'league, theirs')
    expect(out).toContain('LO TIENE OTRO MÁNAGER')
    expect(out).toContain('TITULAR')
    expect(out).toContain('Proponer intercambio')
    expect(container.querySelector('.af-pc-block-tag')?.textContent).toBe('EN VENTA · Gibbs Galore · publicado hace 3 d')
    expect(container.querySelector('.af-pc-star')?.getAttribute('title')).toBe('Añadir a tu lista de seguimiento')
  })

  it('a free agent, a foreign-id league, and another platform’s block note', async () => {
    for (const [slot, platform] of [
      ['NOT ROSTERED', 'espn'],
      ['UNREADABLE', 'fleaflicker'],
    ] as const) {
      const data = universal({
        context: 'league',
        league: league({ slot, platform, isYours: false, owner: null, yourRoster: [], trades: [], tradeBlock: { ...tradeBlockSupport(platform), listed: false, byYou: false, teamName: null, since: null } }),
      })
      const { container, unmount } = sheet(data)
      await settle(container)
      const out = ownText(container)
      expectSpanish(out, slot)
      if (slot === 'NOT ROSTERED') expect(out).toContain('AGENTE LIBRE')
      else expect(out).toContain('Todavía no podemos emparejar los ids de jugadores de esta liga con los nuestros')
      unmount()
    }
  })

  it('every section empty, with the loaders’ real reasons', async () => {
    const data = universal({
      bio: { age: null, height: null, weight: null, yearsExp: 3, college: null },
      market: no('No market snapshot on file for this player.'),
      ownership: no('Only 3 leagues imported — too few for an ownership rate to mean anything yet.'),
      schedule: no('No club on file for this player, so his fixtures cannot be looked up.'),
      trades: no('No trade involving this player in your leagues.'),
      comps: no('No price for this player, so there is nothing to compare against.'),
      news: no('No recent item mentions this player.'),
      injury: no('No injury designation reported in the last 14 days.'),
      injuryFeed: yes({ checkedAt: null, erroredAt: null, skipped: 0 }),
      insight: null,
    })
    const { container } = render(
      <PlayerCardSheet subject={{ sport: 'NFL', sleeperId: 'x9', name: 'Jahmyr Gibbs' }} data={data} status="ready" onClose={() => {}} onOpen={() => {}} />,
    )
    const out = ownText(container)
    expectSpanish(out, 'empty')
    expect(out).toContain('No hay ningún registro de mercado de este jugador.')
    expect(out).toContain('No se reportó ninguna designación de lesión en los últimos 14 días.')
    expect(out).toContain('la fuente todavía no completó una ejecución para este deporte')
    expect(out).toContain('Ninguna noticia reciente menciona a este jugador.')

    const leagueEmpty = universal({
      context: 'league',
      league: league({
        price: no('This player is not in the value set for this league format.'),
        playoffSchedule: no('This league has not published a playoff start week, so its playoff schedule cannot be named.'),
        yourRoster: [],
        trades: [],
      }),
    })
    cleanup()
    const second = sheet(leagueEmpty)
    await settle(second.container)
    const out2 = ownText(second.container)
    expectSpanish(out2, 'league empty')
    expect(out2).toContain('sin precio')
    expect(out2).toContain('Ningún intercambio de esta liga lo ha movido.')
    expect(out2).toContain('No tienes a nadie más en esta posición en esta liga')
  })

  it('loading and error', () => {
    const loading = sheet(null, 'loading')
    expect(ownText(loading.container)).toContain('Cargando el mercado de este jugador…')
    expectSpanish(ownText(loading.container), 'loading')
    cleanup()
    const error = sheet(null, 'error')
    expect(ownText(error.container)).toContain('No se pudo cargar la ficha de este jugador.')
    expectSpanish(ownText(error.container), 'error')
  })

  it('without AF Pro: the lock names the withheld part in Spanish, in both flavours', async () => {
    for (const data of [
      universal({ depth: lockedAccess, trades: no('Trade history is part of AF Pro.'), comps: no('x'), insight: null }),
      universal({ depth: lockedAccess, context: 'league', league: league({ trades: [] }), insight: null }),
    ]) {
      const { container, unmount } = sheet(data)
      const out = ownText(container)
      expectSpanish(out, 'locked')
      expect(out).toMatch(/(Historial de intercambios y jugadores similares|Intercambios en esta liga): parte de AF Pro/)
      unmount()
    }
  })

  it('a trade-block mark that did not save says so in Spanish', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/watch')
          ? { ok: false, json: async () => ({ error: 'Only players on your own roster can go on your trade block.', code: 'not_your_player' }) }
          : { ok: true, json: async () => HISTORY },
      ),
    )
    const { container } = sheet(universal({ context: 'league', league: league() }))
    fireEvent.click(container.querySelector('.af-pc-block-btn')!)
    await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toBe('Solo puedes poner en venta a jugadores de tu propia plantilla.'))
  })
})

describe('player card — loader reasons are held to their source', () => {
  const SOURCES = ['lib/core-app/playerCard.ts', 'lib/trade-block/importedTradeBlock.ts'].map((p) => readFileSync(join(process.cwd(), p), 'utf8')).join('\n')

  it.each(PLAYER_CARD_REASON_KEYS.map((k) => [k]))('"%s" is still written verbatim, and has Spanish', (key) => {
    expect(SOURCES).toContain(key)
    expect(playerCardReasonText(key, 'es')).not.toBe(key)
  })

  it('the templated ones: the injury window, too few leagues, another platform’s block', () => {
    expect(SOURCES).toContain('`No injury designation reported in the last ${INJURY_WINDOW_DAYS} days.`')
    expect(SOURCES).toContain('`Only ${ownershipBoard.leaguesCounted} leagues imported — too few for an ownership rate to mean anything yet.`')
    expect(playerCardReasonText(tradeBlockSupport('espn').note, 'es')).toBe(
      'ESPN no comparte sus jugadores en venta con AllFantasy, y por ahora solo se pueden poner en venta jugadores en ligas de Sleeper.',
    )
    expect(playerCardReasonText(tradeBlockSupport('mystery').note, 'es')).toMatch(/^Esta plataforma no comparte/)
  })

  it('English passes through, and an unknown reason stays whole English', () => {
    expect(playerCardReasonText('No market snapshot on file for this player.', 'en')).toBe('No market snapshot on file for this player.')
    expect(playerCardReasonText('a reason nobody wrote', 'es')).toBe('a reason nobody wrote')
  })

  it('the schedule sentence, every branch', () => {
    const base = { weeks: WEEKS, projectedWeek: 5 }
    for (const data of [
      { ...base, futureWeeks: { enabled: true as const } },
      base,
      { ...base, projectedWeek: null },
      { ...base, projectedWeek: null, futureWeeks: { enabled: true as const } },
    ]) {
      expectSpanish(scheduleProjectionNote(data, 'es'), JSON.stringify(data.projectedWeek))
    }
  })
})

describe('player card — English is unchanged', () => {
  it('the same universal card reads as it always did', async () => {
    const { container } = sheet(universal())
    await settle(container)
    const out = container.textContent ?? ''
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Jahmyr Gibbs player card')
    expect(out).toContain('‹ Back')
    expect(out).toContain('ROOKIE')
    expect(container.querySelector('.af-pc-injury-s')?.textContent).toBe('QUESTIONABLE')
    expect(container.querySelector('.af-pc-feed')?.textContent).toBe('feed checked 2h · last error 29m · 2 runs skipped for budget')
    expect(out).toContain("Gibbs's price is up 310 over 7 days.")
    expect(out).toContain('Based on dynasty · superflex · fantasycalc snapshots 7 days apart.')
    expect(out).toContain('+310 · 7d')
    expect(out).toContain('of 50 AF leagues · 44% start')
    expect(out).toContain('dynasty · superflex · fantasycalc')
    expect(out).toContain('WK6 · BYE')
    expect(out).toContain("Sleeper's early PPR lines, as of Oct 1")
    expect(out).toContain('Cost Bijan Robinson + 2027 1st + 2028 2nd')
    expect(out).toContain('5,000 for 4,000 on the league’s values at the time of the trade (Sep 14)')
    expect(out).toContain('Not graded: One side of this trade has no assets recorded.')
    expect(out).toContain('Value over time')
  })

  it('the league card and the lock', () => {
    const { container } = sheet(universal({ context: 'league', league: league({ isYours: false, owner: { teamName: 'Gibbs Galore', ownerName: 'TheCiege26' } }) }))
    const out = container.textContent ?? ''
    expect(out).toContain('OWNED BY THECIEGE26')
    expect(out).toContain('Propose Trade')
    expect(out).toContain('PLAYOFF SCHEDULE · WK 15-17')
    cleanup()
    const locked = sheet(universal({ depth: lockedAccess, insight: null }))
    expect(locked.container.textContent).toContain('Trade history and similar players are part of AF Pro')
  })
})

/* ── the Waivers screens' Competitive Edge card ─────────────────────────────────────────────────── */

const edgeAccess = (unlocked: boolean, preLaunchFree = false) =>
  ({
    depth: 'competitive_edge',
    unlocked,
    hasPlan: unlocked && !preLaunchFree,
    preLaunchFree,
    startsAt: '2026-10-15T04:00:00.000Z',
    planName: 'AF Pro',
    label: 'Competitive Edge',
    upgradePath: '/pro',
  }) as never

const CLAIMS = [
  { teamExternalId: '2', position: 'RB', bid: 18, atIso: '2026-09-01T00:00:00.000Z' },
  { teamExternalId: '2', position: 'RB', bid: 4, atIso: '2026-09-02T00:00:00.000Z' },
  { teamExternalId: '2', position: 'WR', bid: 0, atIso: '2026-09-03T00:00:00.000Z' },
  { teamExternalId: '3', position: 'TE', bid: 0, atIso: '2026-09-04T00:00:00.000Z' },
  { teamExternalId: '3', position: 'QB', bid: 0, atIso: '2026-09-05T00:00:00.000Z' },
  { teamExternalId: '3', position: 'K', bid: 0, atIso: '2026-09-06T00:00:00.000Z' },
]
const MANAGERS = [
  { teamExternalId: '1', name: 'Viewer', faabRemaining: 40 },
  { teamExternalId: '2', name: 'Tasha', faabRemaining: 72 },
  { teamExternalId: '3', name: 'Dee', faabRemaining: 40 },
  { teamExternalId: '4', name: 'Mike', faabRemaining: 12 },
]
const edgeOf = (usesFaab: boolean, claims = CLAIMS, stale = true) =>
  buildWaiverEdge({ season: 2026, usesFaab, claims, managers: MANAGERS, viewerTeamExternalId: '1', asOf: '2026-09-25T12:44:20.000Z', stale })

describe('Waivers Competitive Edge — Spanish', () => {
  beforeEach(() => {
    lang.language = 'es'
  })

  it('a FAAB league: every fact, the heading and the basis', () => {
    const { container } = render(<WaiverCompetitiveEdge access={edgeAccess(true, true)} edge={{ available: true, data: edgeOf(true) }} />)
    const out = ownText(container)
    expectSpanish(out, 'faab')
    expect(out).toContain('Ventaja competitiva · los reclamos de los demás mánagers')
    expect(container.querySelector('[data-testid="waiver-edge-waiver.outbid_by"]')?.textContent).toBe('1 de los 3 otros mánagers tiene más FAAB que tus $40.')
    expect(out).toContain('A Tasha le quedan $72 de FAAB, más que tus $40.')
    expect(out).toContain('A Dee le quedan $40 de FAAB, lo mismo que a ti.')
    expect(out).toContain('A Mike le quedan $12 de FAAB, menos que tus $40.')
    expect(out).toContain('Tasha ganó 3 reclamos esta temporada y gastó $22 en total.')
    expect(out).toContain('Su oferta ganadora más alta fue de $18 (RB).')
    expect(out).toContain('1 de sus 3 reclamos fue una oferta de $0.')
    expect(out).toContain('3 de sus 3 reclamos fueron ofertas de $0.')
    expect(out).toContain('2 de sus 3 reclamos fueron de RB.')
    expect(out).toContain('Mike no ganó ningún reclamo esta temporada.')
    expect(out).toContain('Esta liga lleva 6 reclamos ganados esta temporada.')
    expect(container.querySelector('[data-testid="waiver-competitive-edge-basis"]')?.textContent).toBe(
      'Datos de los reclamos ganados en el historial de Sleeper de esta liga en la temporada 2026, a 25 sept, 8:44 ET (puede estar desactualizado). Sleeper no publica las ofertas perdidas, así que solo cuenta las ganadas. Muestra lo que hicieron, no lo que ofertarán.',
    )
  })

  it('a rolling-priority league, and one with no claims yet', () => {
    for (const [label, edge] of [
      ['rolling', edgeOf(false)],
      ['none', edgeOf(true, [], false)],
    ] as const) {
      const { container, unmount } = render(<WaiverCompetitiveEdge access={null} edge={{ available: true, data: edge }} />)
      const out = ownText(container)
      expectSpanish(out, label)
      if (label === 'rolling') expect(out).toContain('Tasha ganó 3 reclamos esta temporada.')
      else expect(out).toContain('Todavía no hay reclamos ganados registrados en esta liga esta temporada.')
      unmount()
    }
  })

  it('a league it cannot read, and the lock', () => {
    const reason = render(
      <WaiverCompetitiveEdge
        access={null}
        edge={{ available: false, reason: "Competitive Edge reads Sleeper waiver history today. ESPN leagues aren't connected yet." }}
      />,
    )
    expectSpanish(ownText(reason.container), 'reason')
    expect(reason.container.textContent).toContain('Las ligas de ESPN todavía no están conectadas.')
    cleanup()
    const locked = render(<WaiverCompetitiveEdge access={edgeAccess(false)} edge={{ available: true, data: edgeOf(true) }} />)
    expectSpanish(ownText(locked.container), 'locked')
    expect(locked.container.textContent).toContain('Competitive Edge: parte de AF Pro')
  })
})

describe('Waivers Competitive Edge — English is unchanged', () => {
  it('the facts and the basis', () => {
    const { container } = render(<WaiverCompetitiveEdge access={edgeAccess(true)} edge={{ available: true, data: edgeOf(true) }} />)
    const out = container.textContent ?? ''
    expect(out).toContain("Competitive Edge · other managers' waiver activity")
    expect(out).toContain('Tasha has $72 of FAAB left — more than your $40.')
    expect(out).toContain('Dee has $40 of FAAB left — the same as yours.')
    expect(container.querySelector('[data-testid="waiver-competitive-edge-basis"]')?.textContent).toBe(
      "Counted from winning waiver claims in this league's Sleeper history for the 2026 season, as of Sep 25, 8:44 AM ET — may be out of date. Sleeper doesn't publish losing bids, so these are wins only. It shows what they did, not what they'll bid.",
    )
  })
})
