/**
 * The /core home's bands, and HomeCards' own panels, in Spanish (2026-10-04) — the last English on the
 * home after #2043 (schedule band, decision queue) and #2046 (freshness stamps).
 *
 * Each band is rendered as the page renders it: the SERVER component (which keeps every data decision,
 * `Date.now()` included) with its client view inside, the language from `useOptionalLanguage`. Where a
 * loader's builder is pure it is called for real — `tradesSince`, `groupAlerts`, `playActionFor`; where
 * the loader is DB-bound (dash34, recentTrades, todayStrip) the fixture carries its English byte for byte
 * plus the `parts` it now writes. And English is pinned byte for byte, because readers key on it.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/core',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import { Dash3ATriage, type TriageBookRow } from '@/components/core-app/screens/Dash3ATriage'
import { Dash34Carryover, Dash34Coverage } from '@/components/core-app/screens/Dash34Carryover'
import type { Dash34Data } from '@/components/core-app/screens/Dashboard34'
import { DashDraftsBand } from '@/components/core-app/screens/DashDraftsBand'
import { DashGameDayBand } from '@/components/core-app/screens/DashGameDayBand'
import { DashSinceLastVisit } from '@/components/core-app/screens/DashSinceLastVisit'
import { DashTradeBand } from '@/components/core-app/screens/DashTradeBand'
import { DashUserOs } from '@/components/core-app/screens/DashUserOs'
import { CoreHomeCards, emptyHomeLoads, type HomeScopeInfo } from '@/components/core-app/home/HomeCards'
import type { DraftHqAllRow } from '@/lib/core-app/draftHqAll'
import type { PlayFeedItem } from '@/lib/live/playFeedPresentation'
import * as playFeed from '@/lib/live/playFeedPresentation'
import type { LiveEvent } from '@/lib/live/eventDetector'
import type { TodayStripData } from '@/lib/core-app/todayStrip'
import { groupAlerts, tradesSince, type SinceLastVisitBrief } from '@/lib/core-app/sinceLastVisit'
import type { RecentTrade } from '@/lib/core-app/recentTrades'
import type { UserOsSnapshot } from '@/lib/decision-os/userOs'
import type { HomeCardOrder } from '@/lib/core-app/homeCardOrder'

const EN_DAY = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/
const EN_MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/

/** Visible text plus every title and aria-label — the reader hears those too. */
const text = (el: HTMLElement) => {
  const attrs = [el, ...el.querySelectorAll('[title],[aria-label]')].flatMap((n) => [n.getAttribute('title') ?? '', n.getAttribute('aria-label') ?? ''])
  return [el.textContent ?? '', ...attrs].join(' | ')
}

/** Names the English it found and where, so a failure says which string is left. */
function expectSpanish(out: string, english: RegExp, label: string) {
  for (const re of [EN_DAY, EN_MONTH, english]) {
    const m = re.exec(out)
    expect(m ? `${m[0]} in …${out.slice(Math.max(0, m.index - 40), m.index + 40)}…` : null, label).toBeNull()
  }
}

function es(ui: React.ReactElement): string {
  lang.language = 'es'
  const { container } = render(ui)
  return text(container)
}
function en(ui: React.ReactElement): string {
  lang.language = 'en'
  const { container } = render(ui)
  return text(container)
}

afterEach(() => {
  cleanup()
  lang.language = 'en'
})

/* ── Starters in doubt ───────────────────────────────────────────────────────────────────────── */

const T_NOW = new Date('2026-09-06T16:00:00Z')

function triageRow(over: Partial<TriageBookRow> = {}): TriageBookRow {
  return {
    initials: 'AJ',
    name: 'Ashton Jeanty',
    imageUrl: null,
    leagues: [
      { id: 'l1', name: 'Bla bla bla', platform: 'sleeper', imageUrl: null, slot: 'starter', bench: [{ name: 'Tyjae Spears', position: 'RB' }, { name: 'Zach Charbonnet', position: 'RB' }] },
      { id: 'l2', name: 'Guillotine League 26', platform: 'sleeper', imageUrl: null, slot: 'bench' },
      { id: 'l3', name: 'Work League', platform: 'espn', imageUrl: null, slot: 'ir' },
      { id: 'l4', name: 'Taxi Squad', platform: 'sleeper', imageUrl: null, slot: 'taxi' },
      ...Array.from({ length: 4 }, (_, i) => ({ id: `x${i}`, name: `Extra ${i}`, platform: 'sleeper', imageUrl: null, slot: null })),
    ],
    note: 'RB · Out',
    position: 'RB',
    team: 'LV',
    sport: 'NFL',
    status: 'Out',
    exposure: '8 of 61',
    exposureCount: 8,
    exposureTotal: 61,
    startingIn: 1,
    benchIn: 1,
    irIn: 1,
    taxiIn: 1,
    description: null,
    value: { value: 6400, overallRank: 14, positionRank: 4 },
    reportedAt: T_NOW.toISOString(),
    reportedAgo: '3h ago',
    nextKickoffAt: new Date(T_NOW.getTime() + 90 * 60_000).toISOString(),
    tone: 'bad',
    ...over,
  }
}
const BASIS = { format: 'DYNASTY', qbFormat: 'ONE_QB' }

describe('Starters in doubt (Dash3ATriage)', () => {
  const ENGLISH = /Starters in doubt|may not play|most valuable|In \d+ of|starting in|benched in|on IR in|on taxi in|Trade value|overall|reported|kickoff|swap in|\bmore\b|Find free agents|Values from|Not tuned|NFL only|STARTER|\bbench\b/

  it('every line reads Spanish — slots, value, age, every kickoff bucket, the overflow and the basis', () => {
    const rows = Array.from({ length: 7 }, (_, i) => triageRow({ name: `Player ${i}`, initials: `P${i}` }))
    for (const mins of [-5, 30, 90, 60 * 50]) {
      const out = es(<Dash3ATriage book={rows.map((r) => ({ ...r, nextKickoffAt: new Date(T_NOW.getTime() + mins * 60_000).toISOString() }))} now={T_NOW} valueBasis={BASIS} />)
      expectSpanish(out, ENGLISH, `kickoff ${mins}m`)
      expect(out).toContain('Titulares en duda')
      expect(out).toContain('En 8 de 61 ligas: titular en 1, en la banca en 1, en IR en 1, en el taxi en 1')
      expect(out).toContain('Valor de intercambio: RB4, #14 general')
      expect(out).toContain('reportado hace 3 h')
      expect(out).toContain('Fuera')
      expect(out).toContain('TITULAR')
      expect(out).toContain('pon a Tyjae Spears o Zach Charbonnet')
      expect(out).toContain('+2 más')
      expect(out).toContain('Buscar agentes libres en Bla bla bla')
      expect(out).toContain('+1 titulares señalados más: auditoría completa de exposición')
      expect(out).toContain('Valores de FantasyCalc (dynasty, 1QB, PPR de 12 equipos)')
      cleanup()
    }
    expect(es(<Dash3ATriage book={[triageRow({ nextKickoffAt: new Date(T_NOW.getTime() - 60_000).toISOString() })]} now={T_NOW} valueBasis={BASIS} />)).toContain('partido en curso')
    cleanup()
    expect(es(<Dash3ATriage book={[triageRow()]} now={T_NOW} valueBasis={BASIS} />)).toContain('inicio en 2 h')
    cleanup()
    expect(es(<Dash3ATriage book={[triageRow({ nextKickoffAt: new Date(T_NOW.getTime() + 20 * 60_000).toISOString() })]} now={T_NOW} valueBasis={BASIS} />)).toContain('inicio en 20 min')
    cleanup()
    expect(es(<Dash3ATriage book={[triageRow({ nextKickoffAt: new Date(T_NOW.getTime() + 50 * 3_600_000).toISOString() })]} now={T_NOW} valueBasis={BASIS} />)).toContain('inicio en 2 d')
  })

  it('a row with no starting league points at Player Finder, in Spanish', () => {
    const out = es(<Dash3ATriage book={[triageRow({ leagues: [{ id: 'l2', name: 'G', platform: 'sleeper', imageUrl: null, slot: 'bench' }], status: 'Doubtful' })]} now={T_NOW} valueBasis={null} />)
    expect(out).toContain('Abrir Buscar jugadores')
    expect(out).toContain('Poco probable')
    expect(out).not.toMatch(/Open Player Finder|Doubtful/)
  })

  it('English is unchanged, byte for byte', () => {
    const out = en(<Dash3ATriage book={[triageRow()]} now={T_NOW} valueBasis={BASIS} />)
    expect(out).toContain('Starters in doubt')
    expect(out).toContain('may not play this week · most valuable first')
    expect(out).toContain('In 8 of 61 leagues: starting in 1, benched in 1, on IR in 1, on taxi in 1')
    expect(out).toContain('Trade value: RB4, #14 overall')
    expect(out).toContain('reported 3h ago')
    expect(out).toContain('kickoff in 2h')
    expect(out).toContain('swap in Tyjae Spears or Zach Charbonnet')
    expect(out).toContain('Find free agents in Bla bla bla')
    expect(out).toContain('Values from FantasyCalc (dynasty, 1QB, 12-team PPR). Not tuned to your league’s settings, and NFL only.')
  })
})

/* ── First kickoff, Chimmy's brief, the notice, coverage (Dash34Carryover) ─────────────────── */

function dash(over: Partial<Dash34Data> = {}): Dash34Data {
  return { firstLock: null, notice: null, chimmyBrief: null, coverage: [], ...over } as unknown as Dash34Data
}

const LOCK = {
  countdown: '3d 02:00',
  countdownTo: new Date(Date.now() + (3 * 24 + 2) * 3_600_000 + 30_000).toISOString(),
  countdownLabel: 'FIRST KICKOFF',
  kickoffLabel: 'NFL · Preseason · Week 3',
  headline: 'Steelers at Bills',
  awayClub: null,
  homeClub: null,
  slots: [],
  openHref: '/core/my-team?league=l1',
  openLabel: 'Check Bla bla bla',
  parts: { sport: 'NFL', slate: 'pre', week: 3, away: 'Steelers', home: 'Bills', leagueName: 'Bla bla bla' },
} as unknown as NonNullable<Dash34Data['firstLock']>

const BRIEF = {
  label: "CHIMMY'S BRIEF",
  headline: '2 rosters need attention',
  headlineParts: { kind: 'urgent', count: 2 },
  lines: [
    {
      key: 'empty-slots',
      tone: 'bad',
      text: '3 starting slots are empty in 4 leagues: A, B, C and 1 more.',
      parts: { kind: 'empty-slots', totalEmpty: 3, leagueCount: 4, names: ['A', 'B', 'C'], more: 1 },
    },
    {
      key: 'concentration',
      tone: 'bad',
      text: 'Ashton Jeanty (RB) is out in 3 of your 61 leagues — in your lineup in 1 of them.',
      parts: { kind: 'concentration', name: 'Ashton Jeanty', position: 'RB', status: 'Out', exposureCount: 3, totalActive: 61, startingIn: 1 },
    },
    {
      key: 'kickoff',
      tone: 'plain',
      text: 'Ashton Jeanty plays next at',
      atIso: '2026-10-04T17:00:00.000Z',
      parts: { kind: 'kickoff', name: 'Ashton Jeanty' },
    },
    { key: 'flagged', tone: 'warn', text: '2 more leagues carry a flagged player who can still play.', parts: { kind: 'flagged', count: 2 } },
  ],
  caveat:
    'Built from the injury feed and the fixture list — not from your leagues. No sync has ever run against any of your 61 leagues, so there are no scores, records or lineups behind this.',
  caveatParts: { everSynced: false, totalActive: 61 },
  askLabel: 'Ask Chimmy',
  moreHref: '/core/week',
  moreLabel: 'See every call',
} as unknown as NonNullable<Dash34Data['chimmyBrief']>

const NOTICE = {
  title: 'No league has been read yet',
  body: 'All 61 of your leagues are imported, but a sync has never run against any of them — so there are no scores, records or lineups behind this screen yet.',
  href: '/import',
  label: 'Check your connections',
  parts: { totalActive: 61 },
}

const COVERAGE = [
  { label: 'Live scores', reason: 'no weekly scoring is ingested for imported leagues' },
  { label: 'AF projections', reason: 'requires per-league scoring rules and a synced roster' },
  { label: 'Records and standings', reason: 'no league result has been read yet' },
  { label: 'Which slot is which', reason: 'roster templates are not read, so a slot has no name' },
  { label: 'Pending trade offers and waiver claims', reason: 'only completed transactions are read' },
  { label: 'League chatter', reason: 'Discord and platform chat are not ingested' },
  {
    label: 'Injury status for Josh Allen, Mike Williams, Josh Johnson and 2 more',
    reason: 'more than one player shares that name and we will not guess which',
    parts: { kind: 'ambiguous-injury', names: ['Josh Allen', 'Mike Williams', 'Josh Johnson'], more: 2 },
  },
]

describe('Dash34Carryover and Dash34Coverage', () => {
  const ENGLISH =
    /FIRST KICKOFF|Preseason|Week \d|\bat\b|Check |CHIMMY.S BRIEF|rosters need|starting slots|\bempty\b|plays next|leagues carry|flagged player|Built from|fixture list|No league has been read|imported|your connections|See every call|\bin \d|underway|What this screen|Live scores|AF projections|Records and standings|Which slot|Pending trade|League chatter|Injury status|shares that name/

  it('the first-kickoff band, the brief and the notice read Spanish', () => {
    const out = es(<Dash34Carryover data={dash({ firstLock: LOCK, chimmyBrief: BRIEF, notice: NOTICE })} />)
    expectSpanish(out, ENGLISH, 'carryover')
    expect(out).toContain('PRIMER INICIO')
    expect(out).toContain('en 3 d 2 h')
    expect(out).toContain('NFL · Pretemporada · Semana 3')
    expect(out).toContain('Steelers en Bills')
    expect(out).toContain('Revisar Bla bla bla')
    expect(out).toContain('EL RESUMEN DE CHIMMY')
    expect(out).toContain('2 plantillas necesitan atención')
    expect(out).toContain('3 puestos titulares están vacíos en 4 ligas: A, B, C y 1 más.')
    expect(out).toContain('Ashton Jeanty (RB) está fuera en 3 de tus 61 ligas: en tu alineación en 1 de ellas.')
    expect(out).toContain('Ashton Jeanty juega su próximo partido el dom')
    expect(out).toContain('2 ligas más tienen un jugador señalado que aún puede jugar.')
    expect(out).toContain('no en tus ligas. Nunca se ha sincronizado ninguna de tus 61 ligas')
    expect(out).toContain('Ver todas las recomendaciones')
    expect(out).toContain('Todavía no se ha leído ninguna liga')
    expect(out).toContain('Tus 61 ligas están importadas')
    expect(out).toContain('Revisa tus conexiones')
  })

  it('every headline and every singular, and the quiet case without parts', () => {
    const one = {
      ...BRIEF,
      headline: '1 draft is running',
      headlineParts: { kind: 'drafting', count: 1 },
      lines: [
        { key: 'empty-slots', text: 'x', parts: { kind: 'empty-slots', totalEmpty: 1, leagueCount: 1, names: ['A'], more: 0 } },
        { key: 'concentration', text: 'x', parts: { kind: 'concentration', name: 'J', position: null, status: 'IR', exposureCount: 2, totalActive: 1, startingIn: 0 } },
        { key: 'flagged', text: 'x', parts: { kind: 'flagged', count: 1 } },
      ],
      caveat: 'Built from the injury feed and the fixture list. Live scores, projections and standings are not part of it.',
      caveatParts: { everSynced: true, totalActive: 1 },
    }
    const out = es(<Dash34Carryover data={dash({ chimmyBrief: one as never, notice: { ...NOTICE, body: 'x', parts: { totalActive: 1 } } })} />)
    expectSpanish(out, ENGLISH, 'singulars')
    expect(out).toContain('1 draft está en marcha')
    expect(out).toContain('1 puesto titular está vacío en 1 liga: A.')
    expect(out).toContain('J está en IR en 2 de tus 1 ligas: en la banca en todas.')
    expect(out).toContain('1 liga más tiene un jugador señalado que aún puede jugar.')
    expect(out).toContain('Basado en el parte de lesiones y el calendario de partidos. No incluye marcadores en vivo, proyecciones ni clasificaciones.')
    expect(out).toContain('Tu liga está importada')
    cleanup()
    const flagged = es(<Dash34Carryover data={dash({ chimmyBrief: { ...BRIEF, headline: 'x', headlineParts: { kind: 'flagged', count: 3 }, lines: [] } as never })} />)
    expect(flagged).toContain('3 ligas tienen un jugador que vale la pena revisar')
    cleanup()
    // The quiet brief from a stored summary built before parts existed: fixed text, still Spanish.
    const quiet = es(
      <Dash34Carryover data={dash({ chimmyBrief: { ...BRIEF, headline: 'Nothing is waiting on you', headlineParts: undefined, lines: [], caveat: one.caveat, caveatParts: undefined } as never })} />,
    )
    expect(quiet).toContain('Nada te está esperando')
    expect(quiet).toContain('Basado en el parte de lesiones')
  })

  it('a first kickoff already under way, and one minutes out', () => {
    const under = es(<Dash34Carryover data={dash({ firstLock: { ...LOCK, countdownTo: new Date(Date.now() - 60_000).toISOString() } })} />)
    expect(under).toContain('en curso')
    cleanup()
    const soon = es(<Dash34Carryover data={dash({ firstLock: { ...LOCK, countdownTo: new Date(Date.now() + 20 * 60_000 + 30_000).toISOString() } })} />)
    expect(soon).toContain('en 20 min')
    cleanup()
    const noLeague = es(<Dash34Carryover data={dash({ firstLock: { ...LOCK, openLabel: 'Open Player Finder', parts: { ...LOCK.parts!, leagueName: null, slate: 'post', sport: null } } })} />)
    expect(noLeague).toContain('Abrir Buscar jugadores')
    expect(noLeague).toContain('Postemporada · Semana 3')
  })

  it('a line or a lock without parts stays whole English — never half of one', () => {
    const out = es(
      <Dash34Carryover
        data={dash({
          firstLock: { ...LOCK, parts: undefined },
          chimmyBrief: { ...BRIEF, lines: [{ key: 'odd', text: 'Something the loader added later.' }] } as never,
        })}
      />,
    )
    expect(out).toContain('NFL · Preseason · Week 3')
    expect(out).toContain('Steelers at Bills')
    expect(out).toContain('Check Bla bla bla')
    expect(out).toContain('Something the loader added later.')
  })

  it('coverage reads Spanish, every fixed item and the ambiguous names', () => {
    const out = es(<Dash34Coverage data={dash({ coverage: COVERAGE as never })} />)
    expectSpanish(out, ENGLISH, 'coverage')
    expect(out).toContain('Lo que esta pantalla no vigila (7)')
    expect(out).toContain('Marcadores en vivo')
    expect(out).toContain('Estado de lesión de Josh Allen, Mike Williams, Josh Johnson y 2 más')
    expect(out).toContain('más de un jugador comparte ese nombre y no vamos a adivinar cuál')
  })

  it('English is unchanged, byte for byte', () => {
    const out = en(<Dash34Carryover data={dash({ firstLock: LOCK, chimmyBrief: BRIEF, notice: NOTICE })} />)
    for (const s of [
      'FIRST KICKOFF',
      'in 3d 2h',
      'NFL · Preseason · Week 3',
      'Steelers at Bills',
      'Check Bla bla bla',
      "CHIMMY'S BRIEF",
      '2 rosters need attention',
      BRIEF.lines[0]!.text,
      BRIEF.lines[1]!.text,
      // Dash34When has localised after mount, so the day is the browser's — Sunday in every US zone.
      'Ashton Jeanty plays next at Sun',
      BRIEF.caveat,
      'See every call',
      NOTICE.title,
      NOTICE.body,
      NOTICE.label,
    ]) expect(out).toContain(s)
    cleanup()
    const cov = en(<Dash34Coverage data={dash({ coverage: COVERAGE as never })} />)
    expect(cov).toContain('What this screen is not watching (7)')
    expect(cov).toContain('Injury status for Josh Allen, Mike Williams, Josh Johnson and 2 more — more than one player shares that name and we will not guess which')
  })
})

/* ── Drafts on the clock ─────────────────────────────────────────────────────────────────────── */

const D_NOW = new Date('2026-08-24T20:00:00Z')
function draft(over: Partial<DraftHqAllRow> = {}): DraftHqAllRow {
  return {
    leagueId: 'l1',
    leagueName: 'Guillotine League 26',
    platform: 'sleeper',
    imageUrl: null,
    phase: 'live',
    rawStatus: 'drafting',
    draftType: 'snake',
    rounds: 15,
    teamCount: 18,
    yourSlot: 4,
    picksMade: 22,
    pickExpiresAt: new Date(D_NOW.getTime() + 45 * 60_000).toISOString(),
    ...over,
  } as DraftHqAllRow
}

describe('Drafts on the clock (DashDraftsBand)', () => {
  const ENGLISH = /Drafts on the clock|drafts? live now|Your slot|picks? made|No picks|pick clock|Pick timer|On the clock|no pick timer|Open draft room|more in Draft HQ|DRAFTING|PAUSED|IN PROGRESS/

  it('every card, every clock and every status reads Spanish', () => {
    const rows = [
      draft(),
      draft({ leagueId: 'l2', rawStatus: 'paused', pickExpiresAt: null, yourSlot: null, picksMade: null }),
      draft({ leagueId: 'l3', rawStatus: 'in_progress', picksMade: 1, pickExpiresAt: new Date(D_NOW.getTime() + 30_000).toISOString() }),
      draft({ leagueId: 'l4', pickExpiresAt: new Date(D_NOW.getTime() + 125 * 60_000).toISOString() }),
      draft({ leagueId: 'l5', pickExpiresAt: new Date(D_NOW.getTime() - 1).toISOString() }),
    ]
    const out = es(<DashDraftsBand data={{ rows } as never} now={D_NOW} />)
    expectSpanish(out, ENGLISH, 'drafts')
    expect(out).toContain('Drafts en marcha')
    expect(out).toContain('5 drafts en vivo ahora')
    expect(out).toContain('EN CURSO')
    expect(out).toContain('EN PAUSA')
    expect(out).toContain('Tu posición 4 · 22 selecciones hechas')
    expect(out).toContain('1 selección hecha')
    expect(out).toContain('Aún no hay selecciones registradas')
    expect(out).toContain('45 min en el reloj')
    expect(out).toContain('Menos de 1 min en el reloj')
    expect(out).toContain('2 h 05 min en el reloj')
    expect(out).toContain('En el reloj: no se informó un tiempo para elegir')
    expect(out).toContain('Abrir la sala del draft')
    expect(out).toContain('+1 más en Centro del draft')
    cleanup()
    // Four visible: the expired clock is the fifth card, so check it alone.
    expect(es(<DashDraftsBand data={{ rows: [rows[4]!] } as never} now={D_NOW} />)).toContain('Se agotó el tiempo para elegir')
  })

  it('English is unchanged', () => {
    const out = en(<DashDraftsBand data={{ rows: [draft(), draft({ leagueId: 'l2', rawStatus: 'paused', pickExpiresAt: null })] } as never} now={D_NOW} />)
    for (const s of ['Drafts on the clock', '2 drafts live now', 'DRAFTING', 'PAUSED', 'Your slot 4 · 22 picks made', '45 min on the pick clock', 'On the clock — no pick timer reported', 'Open draft room'])
      expect(out).toContain(s)
  })
})

/* ── Game day ────────────────────────────────────────────────────────────────────────────────── */

const G_NOW = new Date('2026-09-07T18:30:00Z')

function liveEvent(over: Partial<LiveEvent>): LiveEvent {
  return {
    gameId: 'g1',
    playerId: 'ri-1',
    playerName: 'Bijan Robinson',
    team: 'ATL',
    type: 'TOUCHDOWN',
    stat: 'rushing_touchdowns',
    delta: 1,
    value: 1,
    detectedAt: new Date(G_NOW.getTime() - 5 * 60_000),
    idempotencyKey: `k-${Math.random()}`,
    detail: '',
    ...over,
  } as LiveEvent
}

/** What `getPlayFeed` builds from an event, through the real headline and action builders. */
function playFrom(event: LiveEvent, position: string | null = 'RB'): PlayFeedItem {
  return {
    id: event.idempotencyKey,
    gameId: event.gameId,
    type: event.type,
    playerName: event.playerName,
    sleeperId: null,
    team: event.team,
    teamLogoUrl: null,
    imageUrl: null,
    position,
    headline: playFeed.headlineFor(event, position),
    action: playFeed.playActionFor(event),
    actionParts: (playFeed as unknown as { playActionParts?: (e: LiveEvent) => unknown }).playActionParts?.(event),
    yards: playFeed.playYards(event),
    detectedAt: event.detectedAt.toISOString(),
  } as PlayFeedItem
}

const EVENTS: Array<[LiveEvent, string, string]> = [
  [liveEvent({ stat: 'run', delta: 34, role: 'rusher' }), '34-yard rushing TD', 'TD por tierra de 34 yardas'],
  [liveEvent({ stat: 'pass', delta: 12, role: 'receiver', passerName: 'Kirk Cousins' }), '12-yard receiving TD from Kirk Cousins', 'TD de recepción de 12 yardas, pase de Kirk Cousins'],
  [liveEvent({ stat: 'pass', delta: 40, role: 'passer', receiverName: 'Drake London' }), '40-yard TD pass to Drake London', 'pase de TD de 40 yardas a Drake London'],
  [liveEvent({ stat: 'total_touchdowns' }), 'scored a touchdown', 'anotó un touchdown'],
  [liveEvent({ type: 'BIG_PLAY', stat: 'run', delta: 41, role: 'rusher' }), '41-yard run', 'carrera de 41 yardas'],
  [liveEvent({ type: 'BIG_PLAY', stat: 'rushing_long', value: 0, role: 'rusher' }), 'long run', 'carrera larga'],
  [liveEvent({ type: 'BIG_PLAY', stat: 'pass', delta: 33, role: 'receiver', passerName: 'Kyler Murray' }), '33-yard catch from Kyler Murray', 'recepción de 33 yardas, pase de Kyler Murray'],
  [liveEvent({ type: 'BIG_PLAY', stat: 'receiving_long', value: 0, role: 'receiver' }), 'long catch', 'recepción larga'],
  [liveEvent({ type: 'BIG_PLAY', stat: 'pass', delta: 55, role: 'passer', receiverName: 'Ja’Marr Chase' }), '55-yard completion to Ja’Marr Chase', 'pase completo de 55 yardas a Ja’Marr Chase'],
  [liveEvent({ type: 'BIG_PLAY', stat: 'passing_long', value: 0, role: 'passer' }), 'long completion', 'pase completo largo'],
  [liveEvent({ type: 'BIG_PLAY', stat: 'kick_return_yards', delta: 60 }), '60-yard gain', 'ganancia de 60 yardas'],
  [liveEvent({ type: 'BIG_PLAY', stat: 'other' }), 'big gain', 'gran ganancia'],
  [liveEvent({ type: 'FIELD_GOAL', stat: 'field_goal' }), 'made a field goal', 'convirtió un gol de campo'],
  [liveEvent({ type: 'TURNOVER', stat: 'interception', role: 'interceptor' }), 'intercepted a pass', 'interceptó un pase'],
  [liveEvent({ type: 'TURNOVER', stat: 'fumble', role: 'recoverer' }), 'recovered a fumble', 'recuperó un balón suelto'],
  [liveEvent({ type: 'TURNOVER', stat: 'passing_interceptions' }), 'threw an interception', 'lanzó una intercepción'],
  [liveEvent({ type: 'TURNOVER', stat: 'fumbles_lost' }), 'lost a fumble', 'perdió un balón suelto'],
  [liveEvent({ type: 'TURNOVER', stat: 'other' }), 'turned it over', 'perdió el balón'],
  [liveEvent({ type: 'DEFENSIVE_SCORE', stat: 'interception_touchdowns' }), 'pick-six', 'intercepción devuelta para TD'],
  [liveEvent({ type: 'DEFENSIVE_SCORE', stat: 'fumble_return_touchdowns' }), 'fumble return TD', 'TD por devolución de balón suelto'],
  [liveEvent({ type: 'DEFENSIVE_SCORE', stat: 'safety' }), 'safety', 'safety'],
  [liveEvent({ type: 'DEFENSIVE_SCORE', stat: 'other' }), 'defensive TD', 'TD defensivo'],
  [liveEvent({ type: 'SPECIAL_TEAMS_SCORE', stat: 'kick_return_touchdowns' }), 'kickoff return TD', 'TD por devolución de patada inicial'],
  [liveEvent({ type: 'SPECIAL_TEAMS_SCORE', stat: 'punt_return_touchdowns' }), 'punt return TD', 'TD por devolución de despeje'],
  [liveEvent({ type: 'SPECIAL_TEAMS_SCORE', stat: 'other' }), 'special teams TD', 'TD de equipos especiales'],
]

function strip(over: Partial<TodayStripData> = {}): TodayStripData {
  return {
    record: { available: true, data: { wins: 4, losses: 2, week: 1 } },
    health: { available: false, reason: 'not read' },
    next24: [
      {
        kind: 'game',
        text: 'DAL at PHI',
        sub: 'NFL · Week 1',
        parts: { sport: 'NFL', week: 1 },
        time: new Date(G_NOW.getTime() + 3_600_000).toISOString(),
        tone: 'accent',
        game: {
          home: 'Philadelphia Eagles',
          away: 'Dallas Cowboys',
          homeLogo: null,
          awayLogo: null,
          href: '/core/live?sport=NFL',
          odds: 'PHI favored by 7 · O/U 47.5 · line as of 1:05 PM ET',
          oddsParts: { favorite: 'PHI', spread: 7, pickem: false, total: 47.5, staleClock: '1:05 PM ET' },
          oddsAt: null,
        },
      },
      {
        kind: 'game',
        text: 'KC at BUF',
        sub: 'NFL · Week 1',
        parts: { sport: 'NFL', week: 1 },
        time: new Date(G_NOW.getTime() + 2 * 3_600_000).toISOString(),
        tone: 'accent',
        game: { home: 'Buffalo Bills', away: 'Kansas City Chiefs', homeLogo: null, awayLogo: null, href: '/core/live', odds: 'Pick’em', oddsParts: { favorite: null, spread: null, pickem: true, total: null, staleClock: null }, oddsAt: null },
      },
      {
        kind: 'game',
        text: 'NYJ at NE',
        sub: 'NFL',
        parts: { sport: 'NFL', week: null },
        time: new Date(G_NOW.getTime() + 3 * 3_600_000).toISOString(),
        tone: 'accent',
        game: { home: 'NE', away: 'NYJ', homeLogo: null, awayLogo: null, href: '/core/live', odds: 'Odds unavailable', oddsParts: { favorite: null, spread: null, pickem: false, total: null, staleClock: null }, oddsAt: null },
      },
    ],
    ...over,
  } as unknown as TodayStripData
}

describe('Game day (DashGameDayBand)', () => {
  const ENGLISH = /Game day|ahead|behind|right now|\bweek\b|Week \d|none of your matchups|Every NFL scoring play|not only your players|Next 24 hours|betting lines|\bat\b|favored|O\/U|line as of|Pick’em|Odds unavailable|Starts in|Live scoring|\bBIG\b|\bTO\b|-yard|\byards?\b|scored a touchdown|catch|completion|gain|field goal|intercepted|interception|fumble|turned|pick-six|return|special teams|defensive/

  it('the real play builders still write the English every surface shows', () => {
    for (const [event, english] of EVENTS) expect(playFeed.playActionFor(event)).toBe(english)
  })

  it('every play, the record, every odds shape and the schedule read Spanish', () => {
    const plays = EVENTS.map(([e]) => playFrom(e))
    for (let i = 0; i < plays.length; i += 6) {
      const out = es(<DashGameDayBand strip={strip()} plays={plays.slice(i, i + 6)} now={G_NOW} regularSeasonUnderway />)
      expectSpanish(out, ENGLISH, `plays ${i}`)
      for (const [, , spanish] of EVENTS.slice(i, i + 6)) expect(out).toContain(spanish)
      expect(out).toContain('Día de partido')
      expect(out).toContain('4 por delante')
      expect(out).toContain('2 por detrás')
      expect(out).toContain('ahora mismo · semana 1')
      expect(out).toContain('Todas las jugadas de anotación de la NFL, no solo las de tus jugadores')
      expect(out).toContain('Próximas 24 horas · líneas de apuestas')
      expect(out).toContain('Dallas Cowboys')
      expect(out).toContain('PHI favorito por 7 · total del partido 47.5 · línea de las 1:05 PM ET')
      expect(out).toContain('parejo')
      expect(out).toContain('Cuotas no disponibles')
      expect(out).toContain('NFL · Semana 1 · Empieza en')
      expect(out).toContain('Puntuación en vivo')
      cleanup()
    }
    const quiet = es(<DashGameDayBand strip={strip({ record: { available: false, reason: 'x' } as never })} plays={plays.slice(0, 1)} now={G_NOW} regularSeasonUnderway />)
    expect(quiet).toContain('ninguno de tus enfrentamientos ha sumado puntos todavía')
  })

  it('a play or an odds line without parts stays whole English', () => {
    const legacy = { ...playFrom(EVENTS[0]![0]), actionParts: undefined, headline: 'Bijan Robinson ran for a touchdown' } as PlayFeedItem
    const s = strip()
    const row = { ...s.next24[0]!, game: { ...s.next24[0]!.game!, oddsParts: undefined } }
    const out = es(<DashGameDayBand strip={{ ...s, next24: [row] } as never} plays={[legacy]} now={G_NOW} regularSeasonUnderway />)
    expect(out).toContain('Bijan Robinson ran for a touchdown')
    expect(out).toContain('PHI favored by 7 · O/U 47.5 · line as of 1:05 PM ET')
  })

  it('English is unchanged', () => {
    const out = en(<DashGameDayBand strip={strip()} plays={[playFrom(EVENTS[1]![0], 'WR')]} now={G_NOW} regularSeasonUnderway />)
    for (const s of [
      'Game day',
      '4 ahead',
      '2 behind',
      ' right now · week 1',
      'Every NFL scoring play — not only your players',
      'Bijan Robinson (WR) 12-yard receiving TD from Kirk Cousins',
      'Next 24 hours · betting lines',
      'Dallas Cowboys',
      'at',
      'PHI favored by 7 · O/U 47.5 · line as of 1:05 PM ET',
      'NFL · Week 1 · Starts in',
      'Live scoring →',
    ])
      expect(out).toContain(s)
  })
})

/* ── Since your last visit ───────────────────────────────────────────────────────────────────── */

const S_NOW = new Date('2026-09-14T15:00:00Z')

function recentTrade(over: Partial<RecentTrade> = {}): RecentTrade {
  return {
    id: 't1',
    leagueId: 'league-1',
    leagueName: 'Dynasty Gridiron',
    leagueAvatarUrl: null,
    sport: 'NFL',
    platformLeagueId: 'p1',
    acceptedAt: new Date(S_NOW.getTime() - 3_600_000).toISOString(),
    partial: false,
    sides: [
      { rosterId: 1, managerName: 'chxnk', teamName: null, avatarUrl: null, received: [{ kind: 'player', name: 'Darren Waller' }, { kind: 'player', name: 'Puka Nacua' }, { kind: 'pick', name: '2027 1st' }], grade: null, gradeBasis: null, gradeReason: '' },
      { rosterId: 2, managerName: 'Hustead', teamName: null, avatarUrl: null, received: [], grade: null, gradeBasis: null, gradeReason: '' },
    ],
    ...over,
  } as unknown as RecentTrade
}

function brief(over: Partial<SinceLastVisitBrief> = {}): SinceLastVisitBrief {
  const since = new Date(S_NOW.getTime() - 5 * 3_600_000)
  return {
    sinceAt: since.toISOString(),
    tradesSinceAt: new Date(since.getTime() - 3 * 3_600_000).toISOString(),
    firstVisit: false,
    windowCapped: false,
    trades: {
      ...tradesSince([recentTrade()], since, 10),
      items: tradesSince([recentTrade()], since, 10).items.map((t) => ({ ...t, handoff: { href: 'https://sleeper.com/x', label: 'Open in Sleeper', screen: 'trade' } })),
    },
    injuries: [
      { playerId: 'p1', name: 'George Kittle', position: 'TE', from: 'Questionable', to: 'Out', leagues: ['A', 'B'] },
      { playerId: 'p2', name: 'Nico Collins', position: 'WR', from: null, to: 'Doubtful', leagues: ['A'], handoff: { href: 'https://sleeper.com/y', label: 'Open in Sleeper', screen: 'lineup' } },
      { playerId: 'p3', name: 'Joe Burrow', position: 'QB', from: 'IR', to: null, leagues: [], followed: true },
      ...Array.from({ length: 5 }, (_, i) => ({ playerId: `q${i}`, name: `Q ${i}`, position: null, from: null, to: 'Out', leagues: ['A'] })),
    ],
    standings: [
      { leagueId: 'league-1', leagueName: 'Dynasty Gridiron', wins: 3, losses: 1, ties: 1, won: 1, lost: 0, tied: 1, rank: 3, previousRank: 5 },
      { leagueId: 'league-2', leagueName: 'Work', wins: 1, losses: 3, ties: 0, won: 0, lost: 1, tied: 0, rank: 9, previousRank: 7 },
    ],
    alerts: groupAlerts([
      ...Array.from({ length: 9 }, () => ({ type: 'chimmy_alert', title: 'x', createdAt: S_NOW })),
      ...Array.from({ length: 3 }, () => ({ type: 'player_injury_update', title: 'y', createdAt: S_NOW })),
      { type: 'trade_proposed', title: 'z', createdAt: S_NOW },
      { type: 'waiver_processed', title: 'w', createdAt: S_NOW },
    ]),
    comparisonPending: true,
    ...over,
  }
}

describe('Since your last visit (DashSinceLastVisit)', () => {
  const ENGLISH =
    /Since your last visit|since \d|\bago\b|last 7 days|new trade|reaches|further back|\bgot\b|no players or picks|injury change|on your rosters|players you follow|no designation|Following|of your leagues|\bmore\b|Results in|\bwent\b|\bnow\b|\bup to\b|\bdown to\b|\bwas\b|unread alert|Chimmy alerts|injury updates|trade offers|waiver results|Open alerts|Open in|appear from your next visit|Questionable|Doubtful|\bOut\b/

  it('every row, every count and the first-visit note read Spanish', () => {
    const out = es(<DashSinceLastVisit brief={brief()} now={S_NOW} />)
    expectSpanish(out, ENGLISH, 'brief')
    expect(out).toContain('Desde tu última visita')
    expect(out).toContain('desde hace 5 h')
    expect(out).toContain('1 intercambio nuevo')
    expect(out).toContain('(llega 3 h más atrás)')
    expect(out).toContain('chxnk recibió Darren Waller, Puka Nacua +1; Hustead no recibió jugadores ni selecciones registrados')
    expect(out).toContain('Abrir en Sleeper')
    expect(out).toContain('8 cambios de lesión en tus plantillas y jugadores que sigues')
    expect(out).toContain('Dudoso → Fuera · 2 de tus ligas')
    expect(out).toContain('sin designación → Poco probable · A')
    expect(out).toContain('IR → sin designación · Siguiendo')
    expect(out).toContain('+2 más')
    expect(out).toContain('Resultados en 2 ligas')
    expect(out).toContain('quedó 1–0–1, ahora 3–1–1, sube al #3 (antes #5)')
    expect(out).toContain('quedó 0–1, ahora 1–3, baja al #9 (antes #7)')
    expect(out).toContain('14 alertas sin leer')
    expect(out).toContain('9 alertas de Chimmy, 3 novedades de lesiones, 1 ofertas de intercambio, 1 resultados de reclamos')
    expect(out).toContain('Abrir alertas')
    expect(out).toContain('Los cambios de lesiones y clasificaciones aparecen desde tu próxima visita')
  })

  it('the first visit, a capped count and the singulars', () => {
    const since = new Date(S_NOW.getTime() - 5 * 3_600_000)
    const many = Array.from({ length: 3 }, (_, i) => recentTrade({ id: `t${i}` }))
    const out = es(
      <DashSinceLastVisit
        brief={brief({
          firstVisit: true,
          tradesSinceAt: since.toISOString(),
          trades: tradesSince(many, since, 3),
          injuries: [{ playerId: 'p1', name: 'K', position: null, from: 'Questionable', to: 'Out', leagues: ['A'] }],
          standings: [{ leagueId: 'l', leagueName: 'L', wins: 1, losses: 0, ties: 0, won: 1, lost: 0, tied: 0, rank: null, previousRank: null }],
          alerts: groupAlerts([{ type: 'lineup_lock', title: 'x', createdAt: S_NOW }]),
          comparisonPending: false,
        })}
        now={S_NOW}
      />,
    )
    expectSpanish(out, ENGLISH, 'first visit')
    expect(out).toContain('últimos 7 días')
    expect(out).toContain('3+ intercambios nuevos')
    expect(out).toContain('1 cambio de lesión en tus plantillas')
    expect(out).toContain('Resultados en 1 liga')
    expect(out).toContain('1 alerta sin leer')
    expect(out).toContain('1 bloqueos de alineación')
  })

  it('a trade summary without parts stays whole English', () => {
    const b = brief()
    const out = es(<DashSinceLastVisit brief={{ ...b, trades: { ...b.trades, items: b.trades.items.map((t) => ({ ...t, parts: undefined })) } }} now={S_NOW} />)
    expect(out).toContain('chxnk got Darren Waller, Puka Nacua +1; Hustead got no players or picks on record')
  })

  it('English is unchanged', () => {
    const out = en(<DashSinceLastVisit brief={brief()} now={S_NOW} />)
    for (const s of [
      'Since your last visit',
      'since 5h ago',
      '1 new trade (reaches 3h further back)',
      'chxnk got Darren Waller, Puka Nacua +1; Hustead got no players or picks on record',
      'Open in Sleeper',
      '8 injury changes on your rosters and players you follow',
      'Questionable → Out · 2 of your leagues',
      'IR → no designation · Following',
      'Results in 2 leagues',
      'went 1–0–1, now 3–1–1, up to #3 (was #5)',
      '14 unread alerts',
      '9 Chimmy alerts, 3 injury updates, 1 trade offers, 1 waiver results',
      'Open alerts',
      'Injury and standings changes appear from your next visit — this is the first time we have a picture to compare against.',
    ])
      expect(out).toContain(s)
  })
})

/* ── Latest league trades ────────────────────────────────────────────────────────────────────── */

const TR_NOW = new Date('2026-09-14T15:00:00Z')
const MOMENT = { frozenAt: '2026-09-14T16:00:00.000Z', frozenBasis: 'trade_date', pricedAsOf: null, tradeAt: '2026-09-14T12:00:00.000Z' }

function bandTrade(over: Partial<RecentTrade> = {}): RecentTrade {
  return {
    id: 't1',
    leagueId: 'league-1',
    leagueName: 'Dynasty Gridiron',
    leagueAvatarUrl: null,
    sport: 'NFL',
    platformLeagueId: 'p1',
    acceptedAt: new Date(TR_NOW.getTime() - 3 * 3_600_000).toISOString(),
    partial: false,
    gradedAt: '2026-09-14T12:00:00.000Z',
    gradedMoment: MOMENT,
    sides: [
      {
        rosterId: 1,
        managerName: 'chxnk',
        teamName: 'Ice Kings',
        avatarUrl: null,
        received: Array.from({ length: 5 }, (_, i) => ({ kind: 'player', name: `Player ${i}`, position: 'WR' })),
        grade: 'B',
        gradeBasis: 'League',
        gradeReason: 'Got 6,400 for 5,100 on this league’s values at the time of the trade (Sep 14). On today’s values: C.',
        gradeParts: { kind: 'league', got: 6400, gave: 5100, moment: MOMENT, nowLetter: 'C', realizedNet: null },
      },
      {
        rosterId: 2,
        managerName: 'Hustead',
        teamName: null,
        avatarUrl: null,
        received: [],
        grade: null,
        gradeBasis: null,
        gradeReason: 'League-specific grade is still being prepared.',
      },
    ],
    verdict: { verdict: 'Slightly favors A', fairness: 60, confidence: 72, favoursRosterId: 1 },
    ...over,
  } as unknown as RecentTrade
}

describe('Latest league trades (DashTradeBand)', () => {
  const ENGLISH =
    /\bTrades\b|last 24|\bago\b|just now|Received|\bGets\b|\bmore\b|FAAB only|League grade|Got [\d,]+|on this league|today’s values|still being prepared|favou?rs|even deal|One side|confidence|Why these grades|All .* trades|Accepted|Proposed|Awaiting|Completed/
  /* The "why" line is AF Pro's trade depth (2026-10-08); these tests read it as a plan holder. */
  const PRO = { unlocked: true, hasPlan: true, preLaunchFree: false, depth: 'trade_depth', startsAt: '2026-10-15T04:00:00.000Z', planName: 'AF Pro', label: 'The full trade breakdown', upgradePath: '/upgrade?plan=pro' } as const

  it('every card, status, grade line and verdict reads Spanish', () => {
    const trades = [
      bandTrade(),
      bandTrade({ id: 't2', status: 'processed', acceptedAt: new Date(TR_NOW.getTime() - 10_000).toISOString(), verdict: { verdict: 'Fair', fairness: 50, confidence: 0, favoursRosterId: null } } as never),
      bandTrade({ id: 't3', status: 'awaiting_votes', verdict: { verdict: 'Strongly favors B', fairness: 20, confidence: 50, favoursRosterId: 9 } } as never),
      bandTrade({
        id: 't4',
        status: 'pending',
        verdict: { verdict: 'Strongly favors A', fairness: 20, confidence: 50, favoursRosterId: 1 },
        sides: [
          { ...bandTrade().sides[0]!, gradeBasis: 'Realized', gradeReason: "Net 12.5 fantasy points under this league's scoring while the assets were held.", gradeParts: { kind: 'realized', net: 12.5 } },
          { ...bandTrade().sides[1]!, gradeBasis: 'League', grade: 'A', gradeReason: 'Got 5,100 for 6,400 on this league’s values at the time of the trade (Sep 14). Realized so far: net -3.0 fantasy points while the assets were held.', gradeParts: { kind: 'league', got: 5100, gave: 6400, moment: MOMENT, nowLetter: null, realizedNet: -3 } },
        ],
      } as never),
    ]
    const out = es(<DashTradeBand trades={trades} now={TR_NOW} depth={PRO} />)
    expectSpanish(out, ENGLISH, 'trades')
    expect(out).toContain('Intercambios')
    expect(out).toContain('4 en las últimas 24 h')
    expect(out).toContain('hace 3 h')
    expect(out).toContain('justo ahora')
    expect(out).toContain('Completado')
    expect(out).toContain('Esperando votos')
    expect(out).toContain('Propuesto')
    expect(out).toContain('Recibió')
    expect(out).toContain('Recibe')
    expect(out).toContain('+1 más')
    expect(out).toContain('Solo FAAB, o no se capturó')
    expect(out).toContain('Calificación de liga')
    expect(out).toContain('Recibió 6,400 por 5,100 con los valores de esta liga en la fecha del traspaso (14 sep). Con los valores de hoy: C.')
    expect(out).toContain('La calificación específica de la liga aún se está preparando.')
    expect(out).toContain('Real')
    expect(out).toContain('Neto de 12.5 puntos de fantasy con la puntuación de esta liga mientras tuvo los activos.')
    expect(out).toContain('Real hasta ahora: neto de -3.0 puntos de fantasy mientras tuvo los activos.')
    expect(out).toContain('Favorece ligeramente a Ice Kings')
    expect(out).toContain('Favorece claramente a Ice Kings')
    expect(out).toContain('Un intercambio equilibrado sobre el papel')
    expect(out).toContain('Un lado sale ganando')
    expect(out).toContain('con los valores de esta liga en la fecha del traspaso (14 sep) · 72% de confianza')
    expect(out).toContain('Todos los intercambios de Dynasty Gridiron')
  })

  it('a grade line without parts, and a withheld basis, stay whole English', () => {
    const t = bandTrade()
    const out = es(
      <DashTradeBand
        trades={[{ ...t, sides: [{ ...t.sides[0]!, gradeParts: undefined, gradeBasis: null, gradeReason: 'League grade withheld: Josh Allen has no price.' }, t.sides[1]!] } as never]}
        now={TR_NOW}
        depth={PRO}
      />,
    )
    expect(out).toContain('League grade withheld: Josh Allen has no price.')
    expect(out).toContain('Calificación contextual no disponible')
  })

  it('English is unchanged', () => {
    const out = en(<DashTradeBand trades={[bandTrade()]} now={TR_NOW} depth={PRO} />)
    for (const s of [
      'Trades',
      '1 in the last 24h',
      '3h ago',
      'Gets',
      '+1 more',
      'FAAB only, or not captured',
      'League grade',
      'Got 6,400 for 5,100 on this league’s values at the time of the trade (Sep 14). On today’s values: C.',
      'Slightly favours Ice Kings',
      ' · on this league’s values at the time of the trade (Sep 14) · 72% confidence',
      'All Dynasty Gridiron trades',
    ])
      expect(out).toContain(s)
  })

  it('without AF Pro the letters stay and the reasons never reach the page', () => {
    const out = en(<DashTradeBand trades={[bandTrade()]} now={TR_NOW} />)
    expect(out).toContain('Why these grades · AF Pro')
    expect(out).not.toContain('Got 6,400 for 5,100')
    expect(out).not.toContain('still being prepared')
  })

  it('shows only the last 24 hours, and a quiet row pointing at the last trade when none landed', () => {
    const old = bandTrade({ id: 'old', acceptedAt: new Date(TR_NOW.getTime() - 30 * 3_600_000).toISOString() } as never)
    const both = en(<DashTradeBand trades={[bandTrade(), old]} now={TR_NOW} depth={PRO} />)
    expect(both).toContain('1 in the last 24h')
    expect(both).not.toContain('1d ago')
    const quiet = en(<DashTradeBand trades={[old]} now={TR_NOW} depth={PRO} />)
    expect(quiet).toContain('No trades in the last 24 hours.')
    expect(quiet).toContain('Last one was in Dynasty Gridiron')
    expect(quiet).toContain('See trades')
    expect(quiet).not.toContain('Ice Kings')
  })
})

/* ── Your team (DashUserOs) ──────────────────────────────────────────────────────────────────── */

function snapshot(over: Record<string, unknown> = {}): UserOsSnapshot {
  return {
    available: true,
    generatedAt: '2026-10-04T17:05:00.000Z',
    teamHealth: { participationTier: 'active', isInactive: false, retentionRisk: 'low', retentionRiskReasons: [] },
    activitySummary: { tradeEventCount: 2, waiverEventCount: 3, lineupEventCount: 4, draftEventCount: 1 },
    leagueTrend: { available: true, direction: 'increasing' },
    ...over,
  } as unknown as UserOsSnapshot
}

describe('Your team (DashUserOs)', () => {
  const ENGLISH = /Your team|Your Team|intelligence|Open Decide|Active|Trades|Waiver claims|Lineup activity|Draft picks|Your activity|last 90 days|League activity trend|increasing|Updated|\bat\b/

  it('the header and the card read Spanish', () => {
    const out = es(<DashUserOs snapshot={snapshot()} leagueId="l1" leagueName="Ice Kings" />)
    expectSpanish(out, ENGLISH, 'user os')
    expect(out).toContain('Tu equipo · Ice Kings')
    expect(out).toContain('Inteligencia de tu equipo')
    expect(out).toContain('Abrir Decidir')
    expect(out).toContain('Activo')
    expect(out).toContain('Intercambios')
    expect(out).toContain('Tu actividad en AllFantasy (últimos 90 días)')
    expect(out).toContain('Tendencia de actividad de la liga')
    expect(out).toContain('en aumento')
    expect(out).toContain('Actualizado 4 oct a las')
    cleanup()
    const flat = es(<DashUserOs snapshot={snapshot({ leagueTrend: { available: false, reason: 'insufficient_history' } })} leagueId="l1" leagueName={null} />)
    expect(flat).toContain('Solo hay una captura hasta ahora: la tendencia necesita al menos dos para comparar.')
    expect(flat).not.toMatch(/snapshot|insufficient_history/)
  })

  it('English is unchanged', () => {
    const out = en(<DashUserOs snapshot={snapshot()} leagueId="l1" leagueName="Ice Kings" />)
    for (const s of ['Your team · Ice Kings', 'Your team intelligence', 'Open Decide', 'Your Team', 'Active', 'Waiver claims', 'Your activity in AllFantasy (last 90 days)', 'League activity trend', 'increasing', 'Updated Oct 4 at'])
      expect(out).toContain(s)
  })
})

/* ── HomeCards' own panels ───────────────────────────────────────────────────────────────────── */

const ORDER = { bands: [], main: [], side: [], stack: [] } as unknown as HomeCardOrder

function homeCards(scope: HomeScopeInfo) {
  return (
    <CoreHomeCards
      loads={emptyHomeLoads()}
      now={new Date('2026-10-04T15:00:00Z')}
      resetKey="|"
      planName={null}
      commissionerCount={0}
      syncLabel={null}
      scope={scope}
      leagueData={{ oldestAt: null, neverSynced: 0, syncable: 0 }}
      order={ORDER}
      prefetch={{ unreadNotifications: 0, gameDayActive: false }}
    />
  )
}

type AnyEl = React.ReactElement<Record<string, unknown>>
function findAll(node: unknown, pred: (el: AnyEl) => boolean, out: AnyEl[] = []): AnyEl[] {
  if (Array.isArray(node)) node.forEach((n) => findAll(n, pred, out))
  else if (React.isValidElement(node)) {
    const el = node as AnyEl
    if (pred(el)) out.push(el)
    findAll(el.props.children, pred, out)
  }
  return out
}

describe('HomeCards — the scope note, the empty scope and the read-failure panel', () => {
  const ENGLISH = /Showing|of \d+ leagues?|Everything below|Show all leagues|No leagues in this view|None of your leagues|star a league|Your leagues|could not read|read failure/

  it('a filtered home that matches nothing reads Spanish, favorites too', () => {
    const out = es(homeCards({ label: 'NFL leagues', key: 'sport:nfl', scoped: true, count: 0, total: 3 }))
    expectSpanish(out, ENGLISH, 'empty scope')
    expect(out).toContain('Mostrando Ligas de NFL: 0 de 3 ligas. Todo lo de abajo cubre solo estas.')
    expect(out).toContain('Mostrar todas las ligas')
    expect(out).toContain('No hay ligas en esta vista')
    expect(out).toContain('Ninguna de tus ligas coincide con «Ligas de NFL».')
    cleanup()
    const fav = es(homeCards({ label: 'Favorite leagues', key: 'fav', scoped: true, count: 0, total: 1 }))
    expect(fav).toContain('0 de 1 liga.')
    expect(fav).toContain('Ninguna de tus ligas coincide con «Ligas favoritas»: marca una liga con una estrella en el selector de ligas de arriba para añadirla aquí.')
  })

  it('the "could not read your leagues" panel reads Spanish', async () => {
    const tree = (CoreHomeCards as (p: unknown) => unknown)(homeCards({ label: 'All leagues', key: 'all', scoped: false, count: 2, total: 2 }).props)
    const boundary = findAll(tree, (el) => el.props.card === 'issues')[0]!
    const suspense = boundary.props.children as AnyEl
    const card = suspense.props.children as AnyEl
    const panel = (await (card.type as (p: unknown) => Promise<React.ReactElement>)(card.props)) as React.ReactElement
    const out = es(panel)
    expectSpanish(out, ENGLISH, 'read failure')
    expect(out).toContain('Tus ligas')
    expect(out).toContain('No pudimos leer tus ligas en este momento. Es un fallo de lectura de nuestra parte, no una señal de que no tengas ninguna.')
    cleanup()
    const english = en(panel)
    expect(english).toContain('Your leagues')
    expect(english).toContain('We could not read your leagues just now. This is a read failure on our side, not a sign that you have none.')
  })

  it('English is unchanged', () => {
    const out = en(homeCards({ label: 'Favorite leagues', key: 'fav', scoped: true, count: 0, total: 3 }))
    expect(out).toContain('Showing Favorite leagues — 0 of 3 leagues. Everything below covers only these.')
    expect(out).toContain('No leagues in this view')
    expect(out).toContain('None of your leagues match “Favorite leagues” — star a league in the league picker at the top to add it here. Show all leagues')
  })
})
