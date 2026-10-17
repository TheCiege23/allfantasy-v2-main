import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

/*
 * Scout and the War Room week strip in Spanish (2026-10-03 language audit). Both rendered on the server,
 * where the language switch (client state) cannot be read, so the whole room stayed English in Spanish
 * mode — and much of Scout is written by a loader (the standings basis, every "unavailable" reason, the
 * Competitive Edge reasons), which arrives in English whatever the reader chose.
 */

const lang = vi.hoisted(() => ({ value: 'es' as 'es' | 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.value }) }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>{children as never}</a>
  ),
}))

import { Scout } from '@/components/core-app/screens/Scout'
import { WarRoomWeek } from '@/components/core-app/screens/WarRoomWeek'
import { helpTopic } from '@/lib/core-app/helpTopics'
import type { RailMatchup } from '@/lib/core-app/railMatchups'

afterEach(() => {
  lang.value = 'es'
})

/** The page's text as `textContent` joins it — tags removed, not turned into spaces. */
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, ' ')

const standing = (over: Record<string, unknown> = {}) => ({
  seed: 7,
  record: { wins: 2, losses: 2, ties: 0 },
  pointsFor: 410.4,
  pointsAgainst: 400,
  form: ['W', 'L', 'W', 'L'],
  zone: 'bubble',
  gamesBack: 1,
  powerRank: 5,
  ...over,
})
const mgr = (id: string, over: Record<string, unknown> = {}) => ({
  managerId: id,
  teamName: `Team ${id}`,
  ownerName: null,
  avatarUrl: null,
  isYou: false,
  isNextOpponent: false,
  eliminated: null,
  picks: null,
  standing: standing(),
  ...over,
})

const H2H = {
  league: { id: 'lg1', name: 'Dynasty Dragons', sport: 'NFL' },
  you: { teamName: 'My Team', standing: standing({ seed: 3 }) },
  week: { seasonYear: 2026, week: 4 },
  opponent: { managerId: '2', teamName: 'Team 2', headToHead: { wins: 1, losses: 0, ties: 0 } },
  managers: {
    available: true,
    data: [
      mgr('1', { isYou: true }),
      mgr('2', { isNextOpponent: true, picks: { count: 3, early: 1 } }),
      mgr('3', { eliminated: { week: 2 } }),
    ],
  },
  basis: { available: true, data: { season: 2026, throughWeek: 3, seasonComplete: false, orderBasis: 'Order is winning percentage, then points for, then head-to-head — Sleeper\'s rule.' } },
  format: { kind: 'dynasty', elimination: false, bestBall: false, dynasty: true, picks: { state: 'missing', note: null } },
}
const EDGE = {
  available: true,
  data: {
    byManager: { '2': { trades: 3, lastTradeAt: '2026-09-21T15:00:00.000Z', waiverClaims: 7, faabRemaining: 64 } },
    trades: { available: true, data: { seasons: ['2025', '2026'], asOf: '2026-10-02T10:00:00.000Z', stale: false, gaps: [] } },
    waivers: { available: false, reason: 'the waiver history could not be read just now' },
  },
}

const scout = (data: unknown, extra: Record<string, unknown> = {}) =>
  text(
    renderToStaticMarkup(
      <Scout data={data as never} gamePlanHref="/p" matchupHref="/m" standingsHref="/s" tradesHref="/t" {...(extra as object)} />,
    ),
  )

const SCOUT_ENGLISH = [
  'Where every manager',
  "Every league's game plan",
  'This week',
  'You are 1-0 against them',
  'Projected score',
  'Build a trade',
  'Standings through week',
  'Order is winning percentage',
  'On the bubble',
  'back of a playoff spot',
  'Points for',
  'future picks',
  'OUT · WEEK',
  'THIS WEEK',
  'completed trades',
  'waiver claims won',
  'FAAB left',
  'could not be read just now',
  'Dynasty: future picks',
]

describe('Scout in Spanish', () => {
  it('translates the head, the opponent banner, the basis, every card and Competitive Edge — loader text included', () => {
    const t = scout(H2H, { edge: EDGE })
    for (const english of SCOUT_ENGLISH) expect(t, english).not.toContain(english)
    expect(t).toContain('Dónde está cada mánager')
    expect(t).toContain('Vas 1-0 contra ellos esta temporada.')
    expect(t).toContain('Clasificación hasta la semana 3 de 2026.')
    expect(t).toContain('El orden es porcentaje de victorias, luego puntos a favor y luego enfrentamientos directos: la regla de Sleeper.')
    expect(t).toContain('En el límite')
    expect(t).toContain('a 1 juego de un puesto de playoffs')
    expect(t).toContain('FUERA · SEMANA 2')
    expect(t).toContain('3 selecciones futuras · 1 en rondas 1–2')
    expect(t).toContain('3 intercambios')
    expect(t).toContain('le quedan $64 de FAAB')
    expect(t).toContain('agentes libres: no pudimos leer el historial de agentes libres')
  })

  it('CONTROL: the same screen in English carries every one of those phrases', () => {
    lang.value = 'en'
    const t = scout(H2H, { edge: EDGE })
    for (const english of SCOUT_ENGLISH) expect(t, english).toContain(english)
  })

  it('the elimination banner, projected and chopped', () => {
    const elim = {
      ...H2H,
      opponent: null,
      format: { kind: 'guillotine', elimination: true, bestBall: false, dynasty: false, picks: null },
      basis: { available: false, reason: 'no weekly results have been synced for this league yet — the board is built from scored weeks, and there are none on file' },
    }
    const t = scout(elim, { eliminationStanding: { rank: 15, outOf: 15, overCut: null, basis: 'projected', placesAboveCut: 0, cutLine: 85.8, elimination: true } })
    expect(t).toContain('Semana de eliminación · semana 4')
    expect(t).toContain('Vas #15 de 15: en la línea de corte.')
    expect(t).toContain('Proyectado: la mayoría de los equipos todavía no jugó.')
    expect(t).toContain('Todos los equipos frente al corte')
    expect(t).toContain('todavía no se sincronizaron resultados semanales de esta liga')
    expect(t).not.toMatch(/Elimination week|at the cut line|most teams have not played/)

    const chopped = { ...elim, managers: { available: true, data: [mgr('1', { isYou: true, eliminated: { week: 3 } })] } }
    expect(scout(chopped)).toContain('Te eliminaron en la semana 3.')
  })

  it('nobody to scout: the loader’s reason, in Spanish', () => {
    const t = scout({ ...H2H, managers: { available: false, reason: 'no teams have been imported for this league, so there is nobody to scout' } })
    expect(t).toContain('no se importó ningún equipo de esta liga, así que no hay a quién analizar')
  })
})

const m = (leagueId: string, over: Partial<RailMatchup>): RailMatchup => ({
  leagueId,
  yourTeam: 'My Team',
  yourAvatarUrl: null,
  yourScore: 0,
  yourProjection: null,
  opponentTeam: 'Their Team',
  opponentAvatarUrl: null,
  opponentScore: 0,
  opponentProjection: null,
  unpaired: false,
  standing: null,
  scored: false,
  freshAt: null,
  source: 'live_cache',
  season: 2026,
  week: 4,
  ...over,
})

const week = () =>
  text(
    renderToStaticMarkup(
      <WarRoomWeek
        lineups={{
          byLeague: {
            A: m('A', { scored: true, yourScore: 88.4, opponentScore: 80.1, source: 'history_fallback' }),
            B: m('B', { scored: true, yourScore: 70, opponentScore: 95.5 }),
            C: m('C', {}),
            D: m('D', { unpaired: true, standing: { rank: 4, outOf: 15, overCut: 38.6, basis: 'projected', placesAboveCut: 11, cutLine: 50, elimination: true } }),
            E: m('E', { unpaired: true, eliminated: true }),
          },
          projectionWeek: { season: '2026', week: 4 },
        }}
        leagues={['A', 'B', 'C', 'D', 'E'].map((id) => ({ id, name: `League ${id}` }))}
        boardHref="/core/matchup"
      />,
    ),
  )

const WEEK_ENGLISH = ['across your leagues', 'matchups', 'ahead in', 'behind by', 'ahead by', 'last import', 'Not started', 'Elimination week', 'over the cut', '(projected)', 'You were chopped', 'Every matchup']

describe('The War Room week strip in Spanish', () => {
  it('translates the header, every status, the cut and the link', () => {
    const t = week()
    for (const english of WEEK_ENGLISH) expect(t, english).not.toContain(english)
    expect(t).toContain('Semana 4 en tus ligas')
    expect(t).toContain('ganando en 1, perdiendo en 1')
    expect(t).toContain('perdiendo por 25.5')
    expect(t).toContain('ganando por 8.3 · última importación')
    expect(t).toContain('Sin empezar')
    expect(t).toContain('Semana de eliminación · #4 de 15 · 38.6 por encima del corte (proyectado)')
    expect(t).toContain('Te eliminaron')
  })

  it('CONTROL: the same strip in English carries every one of those phrases', () => {
    lang.value = 'en'
    const t = week()
    for (const english of WEEK_ENGLISH) expect(t, english).toContain(english)
  })
})

/*
 * The language hook is client-only, and these tests mock it — so they cannot notice if either file stops
 * being a client component, which is the one thing that made the room English. Pinned at the source.
 */
describe('both are client components — the language cannot be read on the server', () => {
  it.each(['components/core-app/screens/Scout.tsx', 'components/core-app/screens/WarRoomWeek.tsx'])('%s', async (file) => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    expect(readFileSync(resolve(process.cwd(), file), 'utf8').replace(/^﻿/, '')).toMatch(/^'use client'\r?\n/)
  })
})

/*
 * The "?" explanations quote on-screen labels. Their Spanish bodies were written while these screens
 * were English-only, so they quoted «ahead in X…», «Over the cut», «(projected)»; they now quote the
 * labels as Spanish actually renders them.
 */
describe('the "?" topics quote the Spanish labels as they render', () => {
  it.each([
    ['warRoomWeekMargins', ['«ganando en X, perdiendo en Y»', '«Última importación»']],
    ['eliminationCutLine', ['«Por encima del corte»', '«en el corte»', '«(proyectado)»']],
    ['scoutEliminationStanding', ['«por encima del corte»']],
    ['scoutCardLegend', ['«Posición»', '«Poder»', '«En el límite»', '«Eliminado»']],
  ] as const)('%s', (topic, quotes) => {
    const body = helpTopic(topic as never, 'es').body
    for (const q of quotes) expect(body).toContain(q)
    expect(body).not.toMatch(/ahead in X|Last import|Over the cut|at the cut|\(projected\)|En la burbuja|sobre el corte/)
  })
})
