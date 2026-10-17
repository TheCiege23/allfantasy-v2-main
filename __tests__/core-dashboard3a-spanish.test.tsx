/**
 * The /core home's cards (components/core-app/screens/Dashboard3A.tsx and the card components it
 * renders) in Spanish (2026-10-04): the routine, matchups, Chimmy, career, rivals, portfolio chart,
 * exposure, following, receipts and leagues cards. Dashboard3A was English-only.
 *
 * Wherever a loader builds the words on the server, the card is fed that loader's REAL output —
 * `buildWeeklyRoutine`, `getCrossLeagueExposure`, `getRivalRecords`, `getFollowingCard`, dash34's
 * format label, `platformCountsOf` — over a mocked database, so every English sentence is the one
 * the screen receives and every Spanish one is rebuilt from the parts that loader carries. The
 * receipts card composes every line itself from numbers, so it is fed the loader's data shape.
 *
 * Each card is asserted three ways: the Spanish it says, that no English phrase, weekday or month is
 * left anywhere in it (titles and aria-labels included), and that English mode is unchanged. The
 * loaders' English is pinned byte for byte where a reader keys on it.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch() {}, push() {}, replace() {}, refresh() {} }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/geo/useGeoRestriction', () => ({ useGeoRestriction: () => ({ loading: true, isPaidBlocked: false }) }))
vi.mock('@/components/values/ValuesPageLink', () => ({ ValuesPageLink: () => null }))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))
vi.mock('@/components/decide/shareCard', () => ({ shareCardImage: vi.fn(async () => 'downloaded') }))

/* The database the three panel loaders read, set per test. */
const db = vi.hoisted(() => ({
  teams: [] as unknown[],
  rosters: [] as unknown[],
  players: [] as unknown[],
  leagues: [] as unknown[],
  matchups: [] as unknown[],
  games: [] as unknown[],
  follows: [] as unknown[] | null,
  facts: null as unknown,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: vi.fn(async () => db.teams) },
    roster: { findMany: vi.fn(async () => db.rosters) },
    sportsPlayer: { findMany: vi.fn(async () => db.players) },
    league: { findMany: vi.fn(async () => db.leagues) },
    weeklyMatchup: { findMany: vi.fn(async () => db.matchups) },
    sportsGame: { findMany: vi.fn(async () => db.games) },
    leaguePlayerWeeklyScore: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/core-app/leagueWeekMetadata', () => ({ readLeagueWeekMetadata: vi.fn(async () => []) }))
vi.mock('@/lib/follows/playerFollows', () => ({ listPlayerFollows: vi.fn(async () => db.follows) }))
vi.mock('@/lib/injuries/injuryReadPort', () => ({ resolveInjuryFacts: vi.fn(async () => db.facts) }))
vi.mock('@/lib/core-app/weekAll', () => ({ getWeekAll: vi.fn(async () => null) }))
vi.mock('@/lib/league-history/sleeperH2HService', () => ({ readCachedLeagueH2H: vi.fn(async () => new Map()) }))
vi.mock('@/lib/share/weeklyUpset', async (orig) => ({
  ...(await orig<typeof import('@/lib/share/weeklyUpset')>()),
  getWeeklyUpsetsForUser: vi.fn(async () => []),
}))

import {
  Dash3ACareer,
  Dash3AChimmy,
  Dash3AExposure,
  Dash3AFollowing,
  Dash3ALeagues,
  Dash3AMatchups,
  Dash3APortfolioChart,
  Dash3AReceipts,
  Dash3ARivals,
  Dash3ARoutine,
} from '@/components/core-app/screens/Dashboard3A'
import { platformCountsOf } from '@/components/core-app/screens/dash3aPortfolio'
import type { Dash34League } from '@/components/core-app/screens/Dashboard34'
import { buildWeeklyRoutine, type AwardMoment } from '@/lib/core-app/weeklyRoutine'
import type { WeekAllData } from '@/lib/core-app/weekAll'
import { getCrossLeagueExposure, getRivalRecords } from '@/lib/core-app/dash3aPanels'
import { getFollowingCard } from '@/lib/core-app/followingCard'
import type { DecisionReceiptsData } from '@/lib/core-app/decisionReceipts'
import type { CareerData } from '@/lib/core-app/career'
import type { PlayerLeagueImpact } from '@/lib/core-app/playerLeagueImpact'
import { getLevelFromXp } from '@/lib/rank/levels'
import { AWARD_LABEL } from '@/lib/share/weeklyAwardCard'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'
import { panelReasonText, impactReasonText } from '@/lib/core-app/dashboard3aCopy'

const EN_DAY = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/
const EN_MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/
/*
 * English that must not survive. Product and platform names that read the same in Spanish (Chimmy,
 * AutoCoach, Sleeper, AllFantasy, Core, FAAB, IR, XP, pts, vs) are deliberately absent, as are the
 * fixtures' own names.
 */
const EN =
  /\b(the|of|and|you|your|you’re|week|weeks|league|leagues|matchups?|scores?|scored|won|lost|tied|win|wins|Rankings|Portfolio|TITLES?|SEASONS?|CAREER|LEVEL|LVL|Rank|Show all|Imported|Untitled|FOLLOWING|Free agent|more|follow|RECEIPTS|Trades?|Gave|got|since|ahead|behind|even|Waiver|adds?|added|starts?|gone|still|Lineups?|Perfect|bench|benches|Best|said|over|confident|right|wrong|calls?|record|Done|Results|review|Lineup check|Game day|Recap|Biggest|Closest|Top|scorer|awards|upsets|pre-game|chance|Share|If he sits|Hide|Pricing|starting|effect|can’t|Open|Head-to-head|meetings?|last|beat|tie|ASK|day|Nothing|things|needs?|Connect|EXPOSURE|MY LEAGUES|RIVALRY|portfolio|Every|connected|Leagues|in Core|Unmatched|Unknown|feed|statuses|hidden|player|card|roster|rosters|imported|claimed|platform|results|stored|read|yet|now|none|not|on|in|is|are|have|at|for|by|to|it|he|him|his|one|whole|moves|Sunday|pre)\b/

const text = (el: HTMLElement) => {
  const attrs = [...el.querySelectorAll('[title],[aria-label]')].flatMap((n) => [
    n.getAttribute('title') ?? '',
    n.getAttribute('aria-label') ?? '',
  ])
  return [el.textContent ?? '', ...attrs].join(' | ')
}

/* Each card's TopicTip "?" is included: it is bilingual already (helpTopic(…, language)), so it must read Spanish too. */
const cardText = text

function expectSpanish(out: string, label: string) {
  // The matched word, not just "it matched", so a failure names what was left in English.
  expect(out.match(EN_DAY)?.[0] ?? null, `${label}: ${out}`).toBeNull()
  expect(out.match(EN_MONTH)?.[0] ?? null, `${label}: ${out}`).toBeNull()
  expect(out.match(EN)?.[0] ?? null, `${label}: ${out}`).toBeNull()
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  lang.language = 'en'
})

beforeEach(() => {
  db.teams = []
  db.rosters = []
  db.players = []
  db.leagues = []
  db.matchups = []
  db.games = []
  db.follows = []
  db.facts = null
})

/* ── Your week ─────────────────────────────────────────────────────────────────────────────────── */

const LAST_WEEK: WeekAllData = {
  rows: [
    { leagueId: 'af-ice', leagueName: 'Ice Kings', platform: 'sleeper', season: 2026, week: 3, pointsFor: 120, pointsAgainst: 96.5, won: true, completed: true },
    { leagueId: 'af-dyn', leagueName: 'Gridiron Gang', platform: 'sleeper', season: 2026, week: 3, pointsFor: 101, pointsAgainst: 103.2, won: false, completed: true },
    { leagueId: 'af-mnf', leagueName: 'Oficina FC', platform: 'sleeper', season: 2026, week: 3, pointsFor: 80, pointsAgainst: 70, won: true, completed: false },
  ],
  season: 2026,
  week: 3,
  withoutHistory: 0,
  unscored: 0,
  record: { wins: 1, losses: 1 },
}
const sched = (coin: number, lean: number) =>
  ({ coinFlips: Array(coin).fill({}), leaning: Array(lean).fill({}), unprojected: [] }) as never
const AWARDS: AwardMoment[] = (Object.keys(AWARD_LABEL) as Array<keyof typeof AWARD_LABEL>).map((kind, i) => ({
  leagueId: `L${i}`,
  leagueName: 'Ice Kings',
  season: 2026,
  week: 3,
  kind,
  label: AWARD_LABEL[kind],
  value: 140.2,
  unit: kind === 'narrowEscape' || kind === 'biggestBlowout' ? 'margin' : 'pts',
}))
const UPSET = { leagueId: 'af-ice', leagueName: 'Ice Kings', season: 2026, week: 3, pointsFor: 120, pointsAgainst: 96.5, winChance: '31%' } as never

/** One routine per weekday the highlight can land on, and per summary shape. */
function routines() {
  const out = []
  // Sun 9/20 … Sat 9/26, 15:00 UTC (US Eastern morning), each with a different mix of facts.
  for (let d = 0; d < 7; d++) {
    const now = new Date(Date.UTC(2026, 8, 20 + d, 15))
    out.push(
      buildWeeklyRoutine({
        now,
        lastWeek: d % 2 ? LAST_WEEK : null,
        topScorer: d % 3 ? { name: 'Jahmyr Gibbs', points: 28.4, leagueName: 'Ice Kings' } : null,
        addsThisWeek: [null, 0, 1, 3][d % 4]!,
        startersInDoubt: [null, 0, 1, 2][(d + 1) % 4]!,
        schedule: d % 2 ? sched(1, 2) : sched(0, 1),
        awards: d === 1 ? AWARDS : [],
        upsets: d === 1 ? [UPSET] : [],
      }),
    )
  }
  return out
}

describe('Your week — buildWeeklyRoutine’s real output', () => {
  it('the English every reader keys on is unchanged, byte for byte', () => {
    const r = buildWeeklyRoutine({
      now: new Date('2026-09-21T15:00:00Z'), // a Monday in the East
      lastWeek: LAST_WEEK,
      topScorer: { name: 'Jahmyr Gibbs', points: 28.4, leagueName: 'Ice Kings' },
      addsThisWeek: 2,
      startersInDoubt: 1,
      schedule: sched(1, 2),
    })
    expect(r.todayLabel).toBe('Monday')
    expect(r.steps.map((s) => [s.title, s.summary])).toEqual([
      ['Results review', '2026 week 3: 1-1 across 2 leagues'],
      ['Waivers', 'You made 2 adds this week.'],
      ['Lineup check', '1 starter may not play.'],
      ['Game day', '3 matchups this week · 1 coin flip.'],
      ['Recap', '1-1 in week 3 · top scorer Jahmyr Gibbs 28.4'],
    ])
  })

  it('every step, every summary, the recap, awards and upsets read Spanish, on every weekday', () => {
    lang.language = 'es'
    for (const data of routines()) {
      const { container, unmount } = render(<Dash3ARoutine routine={data} />)
      expectSpanish(cardText(container), data.todayLabel)
      expect(container.textContent).toContain('Tu semana')
      unmount()
    }
    const monday = routines()[1]!
    const { container } = render(<Dash3ARoutine routine={monday} />)
    const steps = [...container.querySelectorAll('.af3a-routine-step')].map((li) => li.textContent)
    expect(steps).toEqual([
      'marRepaso de resultados✓2026 semana 3: 1-1 en 2 ligas',
      'miéAgentes libresNo tienes incorporaciones registradas esta semana.',
      'jueRevisión de alineación1 titular podría no jugar.',
      'domDía de partido3 enfrentamientos esta semana · 1 partido ajustado.',
      'lunResumen1-1 en la semana 3 · máximo anotador Jahmyr Gibbs 28.4',
    ])
    expect(container.querySelector('.af3a-sechead .af3a-note')?.textContent).toBe('Lunes · Resumen')
    expect(container.querySelector('.af3a-routine-recap')?.textContent).toBe(
      'Resumen de la semana 3 de 2026: 1-1Mayor victoria: Ice Kings por 23.5Derrota más ajustada: Gridiron Gang por 2.2' +
        'Máximo anotador: Jahmyr Gibbs 28.4 (Ice Kings)Los partidos del lunes por la noche aún pueden cambiar esto.',
    )
    const awards = [...container.querySelectorAll('[data-award]')].map((li) => li.querySelector('span')?.textContent)
    expect(awards).toEqual([
      'Puntuación más alta · Ice Kings · 140.2 pts',
      'Puntuación más baja · Ice Kings · 140.2 pts',
      'Victoria por la mínima · Ice Kings · 140.2 pts de diferencia',
      'Mayor paliza · Ice Kings · 140.2 pts de diferencia',
    ])
    expect(container.querySelector('[data-upset] span')?.textContent).toBe(
      'Ice Kings · ganaste 120.0–96.5 · probabilidad de ganar antes del partido 31%',
    )
  })

  it('the share button speaks Spanish through every state', async () => {
    lang.language = 'es'
    const { container } = render(<Dash3ARoutine routine={routines()[1]!} />)
    const btn = container.querySelector('.af3a-share-btn') as HTMLButtonElement
    expect(btn.textContent).toBe('Compartir')
    await act(async () => {
      fireEvent.click(btn)
    })
    await waitFor(() => expect(btn.textContent).toBe('Tarjeta guardada ✓'))
  })

  it('a step without parts (a payload from before them) stays whole English', () => {
    lang.language = 'es'
    const data = routines()[1]!
    const { summaryParts: _p, ...bare } = data.steps[0]!
    const { container } = render(<Dash3ARoutine routine={{ ...data, steps: [bare, ...data.steps.slice(1)] }} />)
    expect(container.querySelector('.af3a-routine-summary')?.textContent).toBe('2026 week 3: 1-1 across 2 leagues')
  })

  it('English is unchanged', () => {
    const { container } = render(<Dash3ARoutine routine={routines()[1]!} />)
    expect(container.querySelector('h2')?.textContent).toBe('Your week')
    expect(container.querySelector('.af3a-sechead .af3a-note')?.textContent).toBe('Monday · Recap')
    expect(container.querySelector('.af3a-routine-recap b')?.textContent).toBe('2026 week 3 recap: 1-1')
    expect(container.querySelector('[data-award="narrowEscape"] span')?.textContent).toBe('Narrow escape · Ice Kings · 140.2 pt margin')
    expect(container.querySelector('[data-upset] span')?.textContent).toBe('Ice Kings · won 120.0–96.5 · pre-game win chance 31%')
    expect(container.querySelector('.af3a-share-btn')?.textContent).toBe('Share')
    expect(container.querySelector('[aria-label="Done"]')).not.toBeNull()
  })
})

/* ── League matchups ───────────────────────────────────────────────────────────────────────────── */

const LIVE: Dash34League = { id: 'L-live', name: 'Ice Kings', platform: 'sleeper', href: '/core', score: { you: 88.4, opponent: 71.2, opponentName: 'Rodrigo' } }
const WEEK: WeekAllData = {
  rows: [
    { leagueId: 'L-a', leagueName: 'Gridiron Gang', platform: 'espn', season: 2026, week: 4, pointsFor: 110, pointsAgainst: 90, won: true, completed: true },
    { leagueId: 'L-b', leagueName: 'Oficina FC', platform: 'yahoo', season: 2026, week: 4, pointsFor: 90, pointsAgainst: 110, won: false, completed: true },
    { leagueId: 'L-c', leagueName: 'Dynasty Dragons', platform: 'sleeper', season: 2026, week: 4, pointsFor: 100, pointsAgainst: 100, won: false, completed: true },
    { leagueId: 'L-d', leagueName: 'End Zone Elites', platform: 'sleeper', season: 2026, week: 4, pointsFor: 40, pointsAgainst: 52, won: false, completed: false },
  ],
  season: 2026,
  week: 4,
  withoutHistory: 0,
  unscored: 0,
  record: null,
}

describe('League matchups', () => {
  it('every result, the period and the win chance read Spanish; the empty card too', () => {
    lang.language = 'es'
    const cases = [
      { leagues: [LIVE], week: WEEK },
      { leagues: [], week: WEEK },
      { leagues: [], week: null },
    ]
    for (const c of cases) {
      const { container, unmount } = render(
        <Dash3AMatchups leagues={c.leagues} week={c.week} winProb={{ 'L-live': 0.62, 'L-d': 0.31 }} weekLabel={null} />,
      )
      expectSpanish(cardText(container), JSON.stringify(c.leagues))
      unmount()
    }
    const { container } = render(<Dash3AMatchups leagues={[]} week={WEEK} winProb={{ 'L-d': 0.31 }} weekLabel={null} />)
    expect([...container.querySelectorAll('.af3a-match-body p')].map((p) => p.textContent)).toEqual([
      'Semana 4 · ganaste',
      'Semana 4 · perdiste',
      'Semana 4 · empataste',
      'Semana 4 · marcador parcial · 31% de ganar',
    ])
    expect(container.querySelector('.af3a-note')?.textContent).toBe('2026 · Semana 4')
  })

  it('English is unchanged', () => {
    const { container } = render(<Dash3AMatchups leagues={[LIVE]} week={WEEK} winProb={{ 'L-live': 0.62 }} weekLabel={null} />)
    expect([...container.querySelectorAll('.af3a-match-body p')].map((p) => p.textContent)).toEqual([
      'vs Rodrigo · 62% win',
      'Week 4 · you won',
      'Week 4 · you lost',
      'Week 4 · you tied',
    ])
    expect(container.querySelector('h2')?.textContent).toBe('League matchups')
    expect(container.querySelector('.af3a-note')?.textContent).toBe('League periods')
  })
})

/* ── Ask Chimmy, career ────────────────────────────────────────────────────────────────────────── */

describe('Ask Chimmy and Your career', () => {
  const xp = 43_500
  const lvl = getLevelFromXp(xp)
  const career = {
    handle: 'guap',
    avatarUrl: null,
    level: lvl.level,
    levelName: lvl.name,
    nextLevelName: lvl.nextLevel?.name ?? null,
    xp: { total: xp, nextThreshold: 55_000, toNext: 11_500, progressPct: 12 },
    championships: 2,
    seasonsPlayed: 1,
  } as unknown as CareerData

  it('every state reads Spanish', () => {
    lang.language = 'es'
    for (const [open, count] of [[0, 0], [0, 4], [1, 4], [5, 4], [3, null]] as const) {
      const { container, unmount } = render(<Dash3AChimmy openCount={open} leagueCount={count} />)
      expectSpanish(cardText(container), `${open}/${count}`)
      unmount()
    }
    const { container: five } = render(<Dash3AChimmy openCount={5} leagueCount={4} />)
    expect(five.querySelector('h3')?.textContent).toBe('Hoy hay 5 cosas que requieren tu atención; primero, la más urgente.')
    cleanup()
    for (const c of [career, { ...career, championships: 1, seasonsPlayed: 3 } as CareerData, null]) {
      const { container, unmount } = render(<Dash3ACareer career={c} />)
      // The level NAME is the rank's proper name, shown as written on every /core surface.
      expectSpanish(cardText(container).replace(lvl.name, '').replace(lvl.nextLevel?.name ?? '', ''), String(c?.championships))
      unmount()
    }
    const { container } = render(<Dash3ACareer career={career} />)
    expect(container.querySelector('.af3a-label')?.textContent).toBe('TU CARRERA')
    expect(container.querySelector('.af3a-xp-note')?.textContent).toBe(`${(11_500).toLocaleString()} XP para ${lvl.nextLevel!.name}`)
    expect(container.textContent).toContain('TÍTULOS')
  })

  it('English is unchanged', () => {
    const { container } = render(<Dash3ACareer career={career} />)
    expect(container.querySelector('.af3a-xp-top span')?.textContent).toBe(`Rank XP · ${lvl.name}`)
    expect(container.querySelector('.af3a-xp-note')?.textContent).toBe(`${(11_500).toLocaleString()} XP to ${lvl.nextLevel!.name}`)
    expect(container.querySelector('.af3a-lvl')?.textContent).toBe(`LVL ${lvl.level}CAREER LEVEL`)
    const { container: chimmy } = render(<Dash3AChimmy openCount={1} leagueCount={4} />)
    expect(chimmy.querySelector('h3')?.textContent).toBe('One thing needs you today.')
  })
})

/* ── Rivalry radar — getRivalRecords' real output ──────────────────────────────────────────────── */

function rivalDb(meetings: Array<[week: number, opp: string, mine: number, theirs: number]>) {
  db.leagues = [{ id: 'L', platformLeagueId: 'P' }]
  db.teams = [
    { leagueId: 'L', externalId: '1', claimedByUserId: 'U', ownerName: 'Me' },
    { leagueId: 'L', externalId: '2', ownerName: 'Rodrigo' },
    { leagueId: 'L', externalId: '3', ownerName: 'Beatriz' },
    { leagueId: 'L', externalId: '4', ownerName: 'Camila' },
  ]
  db.matchups = meetings.flatMap(([week, opp, mine, theirs]) => [
    { leagueId: 'P', seasonYear: 2025, week, rosterId: '1', matchupId: 1, pointsFor: mine },
    { leagueId: 'P', seasonYear: 2025, week, rosterId: opp, matchupId: 1, pointsFor: theirs },
  ])
}
const MEETINGS: Array<[number, string, number, number]> = [
  [1, '2', 100, 90.25],
  [2, '3', 100, 112.4],
  [3, '4', 100, 100],
  [4, '3', 90, 100.2],
]

describe('Rivalry radar — getRivalRecords’ real output', () => {
  it('the English last meeting is unchanged, byte for byte', async () => {
    rivalDb(MEETINGS)
    const r = await getRivalRecords('U', ['L'])
    if (!r.available) throw new Error(r.reason)
    expect(r.data.rows.map((x) => [x.name, x.lastResult])).toEqual([
      ['Beatriz', 'beat you by 10.2'],
      ['Rodrigo', 'you won by 9.8'],
      ['Camila', 'a tie'],
    ])
  })

  it('every row and every reason reads Spanish', async () => {
    lang.language = 'es'
    rivalDb(MEETINGS)
    const real = await getRivalRecords('U', ['L'])
    const { container } = render(<Dash3ARivals rivals={real} />)
    expectSpanish(cardText(container), 'rows')
    expect([...container.querySelectorAll('.af3a-rival-body em')].map((e) => e.textContent)).toEqual([
      '2 encuentros · último: te ganó por 10.2',
      '1 encuentro · último: ganaste por 9.8',
      '1 encuentro · último: empate',
    ])
    expect(container.querySelector('.af3a-label')?.textContent).toBe('RIVALES')
    cleanup()

    // Every reason the loader can give: no leagues, no platform id, no results, nothing scored.
    const reasons = []
    reasons.push(await getRivalRecords('U', []))
    db.leagues = []
    reasons.push(await getRivalRecords('U', ['L']))
    rivalDb([])
    reasons.push(await getRivalRecords('U', ['L']))
    rivalDb([[1, '2', 0, 0]])
    reasons.push(await getRivalRecords('U', ['L']))
    expect(reasons.every((r) => !r.available)).toBe(true)
    for (const state of [...reasons, null]) {
      const { container: c, unmount } = render(<Dash3ARivals rivals={state} />)
      const out = cardText(c)
      expectSpanish(out, JSON.stringify(state))
      if (state && !state.available) expect(panelReasonText(state.reason, 'es')).not.toBe(state.reason)
      unmount()
    }
  })

  it('English is unchanged', async () => {
    rivalDb(MEETINGS)
    const { container } = render(<Dash3ARivals rivals={await getRivalRecords('U', ['L'])} />)
    expect(container.querySelector('.af3a-rival-body em')?.textContent).toBe('2 meetings · last: beat you by 10.2')
    expect(container.querySelector('.af3a-label')?.textContent).toBe('RIVALRY RADAR')
    cleanup()
    const { container: none } = render(<Dash3ARivals rivals={await getRivalRecords('U', [])} />)
    expect(none.querySelector('.af3a-reason')?.textContent).toBe('No leagues imported yet.')
  })
})

/* ── Portfolio chart ───────────────────────────────────────────────────────────────────────────── */

describe('League portfolio chart', () => {
  const counts = platformCountsOf([{ platform: 'Sleeper' }, { platform: 'Sleeper' }, { platform: 'ESPN' }, { platform: null }])

  it('title, subtitle (default and a filtered home’s) and value label read Spanish', () => {
    lang.language = 'es'
    for (const subtitle of [undefined, 'Sleeper leagues in Core', 'Favorite leagues in Core', 'NFL leagues in Core']) {
      const { container, unmount } = render(<Dash3APortfolioChart platformCounts={counts} subtitle={subtitle} />)
      expectSpanish(cardText(container), String(subtitle))
      unmount()
    }
    const { container } = render(<Dash3APortfolioChart platformCounts={counts} subtitle="Sleeper leagues in Core" />)
    expect(container.querySelector('figcaption')?.textContent).toBe('Cartera de ligas por plataformaLigas de Sleeper en CoreLigas')
  })

  it('English is unchanged', () => {
    const { container } = render(<Dash3APortfolioChart platformCounts={counts} />)
    expect(container.querySelector('figcaption')?.textContent).toBe('League portfolio by platformEvery connected league in CoreLeagues')
  })
})

/* ── Portfolio & exposure — getCrossLeagueExposure's real output ───────────────────────────────── */

function exposureDb(platform: string, rosters: Array<{ players: string[]; starters: string[] }>, players = PLAYERS) {
  db.teams = rosters.map((_, i) => ({ leagueId: `L${i}`, platformUserId: 'me', externalId: String(i) }))
  db.rosters = rosters.map((r, i) => ({ leagueId: `L${i}`, playerData: r, league: { platform } }))
  db.players = players
}
const PLAYERS = [
  { sleeperId: '4866', name: 'Saquon Barkley', position: 'RB', team: 'PHI' },
  { sleeperId: '6794', name: 'Justin Jefferson', position: 'WR', team: 'MIN' },
]

describe('Portfolio & exposure — getCrossLeagueExposure’s real output', () => {
  it('the English note is unchanged, byte for byte', async () => {
    exposureDb('sleeper', [
      { players: ['4866', '6794'], starters: ['4866'] },
      { players: ['4866'], starters: ['4866'] },
    ])
    const every = await getCrossLeagueExposure('u1', ['L0', 'L1'])
    if (!every.available) throw new Error(every.reason)
    expect(every.data.note).toBe('Saquon Barkley is on every roster you own — one hamstring and your whole Sunday moves.')
    exposureDb('sleeper', [
      { players: ['4866'], starters: [] },
      { players: ['4866'], starters: [] },
      { players: ['6794'], starters: [] },
    ])
    const some = await getCrossLeagueExposure('u1', ['L0', 'L1', 'L2'])
    if (!some.available) throw new Error(some.reason)
    expect(some.data.note).toBe('Saquon Barkley is on 2 of your 3 rosters.')
  })

  it('rows, the note, every reason and the "if he sits" breakdown read Spanish', async () => {
    lang.language = 'es'
    const states = []
    exposureDb('sleeper', [
      { players: ['4866', '6794'], starters: ['4866'] },
      { players: ['4866'], starters: ['4866'] },
    ])
    states.push(await getCrossLeagueExposure('u1', ['L0', 'L1']))
    exposureDb('sleeper', [
      { players: ['4866', '999999'], starters: [] },
      { players: ['999999'], starters: [] },
      { players: ['6794'], starters: [] },
    ])
    states.push(await getCrossLeagueExposure('u1', ['L0', 'L1', 'L2'])) // an unmatched id leads
    states.push(await getCrossLeagueExposure('u1', [])) // no leagues
    exposureDb('sleeper', [])
    states.push(await getCrossLeagueExposure('u1', ['L0'])) // no claimed team
    exposureDb('sleeper', [{ players: [], starters: [] }])
    db.rosters = []
    states.push(await getCrossLeagueExposure('u1', ['L0'])) // claimed, no rosters
    exposureDb('fleaflicker', [{ players: ['6038'], starters: [] }])
    states.push(await getCrossLeagueExposure('u1', ['L0'])) // one foreign league
    exposureDb('fleaflicker', [{ players: ['6038'], starters: [] }, { players: ['6039'], starters: [] }])
    states.push(await getCrossLeagueExposure('u1', ['L0', 'L1'])) // several
    exposureDb('sleeper', [{ players: ['name:Lamar Jackson:QB:BAL'], starters: [] }])
    states.push(await getCrossLeagueExposure('u1', ['L0'])) // no resolvable ids
    expect(states.filter((s) => !s.available)).toHaveLength(6)
    for (const state of [...states, null]) {
      const { container, unmount } = render(<Dash3AExposure exposure={state} />)
      expectSpanish(cardText(container), JSON.stringify(state).slice(0, 120))
      if (state && !state.available) expect(panelReasonText(state.reason, 'es')).not.toBe(state.reason)
      unmount()
    }
    const { container } = render(<Dash3AExposure exposure={states[0]!} />)
    expect(container.querySelector('.af3a-exp-note')?.textContent).toBe(
      'Saquon Barkley está en todas tus plantillas: una lesión y se te mueve todo el domingo.',
    )
    expect(container.querySelector('.af3a-exp-count')?.textContent).toBe('2 de 2')
    expect(container.querySelector('.af3a-label')?.textContent).toBe('CARTERA Y EXPOSICIÓN')
    cleanup()
    const { container: unmatched } = render(<Dash3AExposure exposure={states[1]!} />)
    expect(unmatched.querySelector('.af3a-exp-note')?.textContent).toBe('Jugador sin identificar está en 2 de tus 3 plantillas.')
  })

  it('the "if he sits" breakdown: every line and every reason the route can send', async () => {
    lang.language = 'es'
    exposureDb('sleeper', [
      { players: ['4866'], starters: ['4866'] },
      { players: ['4866'], starters: ['4866'] },
    ])
    const state = await getCrossLeagueExposure('u1', ['L0', 'L1'])
    const reasons = [
      'this league has no platform id, so its weekly results cannot be located',
      'we cannot tell which team in this league is yours',
      'no weekly results stored for this league',
      'your team has no result stored for week 4',
      'no opponent is paired with your team in week 4',
      'we could not match both sides of this matchup to an imported roster',
      'this league’s matchup could not be read just now',
      'no starters on file for one side of this matchup',
      '1 starter still to play have no projection — treating them as zero would tilt the result toward the other side',
      '2 starters still to play have no projection — treating them as zero would tilt the result toward the other side',
    ]
    const impact: PlayerLeagueImpact = {
      rows: [
        { leagueId: 'A', leagueName: 'Ice Kings', platform: 'sleeper', slot: 'starter', impact: { kind: 'priced', now: 0.62, without: 0.41 } },
        { leagueId: 'B', leagueName: 'Oficina FC', platform: 'sleeper', slot: 'bench', impact: { kind: 'not_starting' } },
        ...reasons.map((reason, i) => ({
          leagueId: `R${i}`,
          leagueName: 'Gridiron Gang',
          platform: 'sleeper',
          slot: (['starter', 'ir', 'taxi'] as const)[i % 3],
          impact: { kind: i % 2 ? ('no_matchup' as const) : ('unpriced' as const), reason },
        })),
      ],
      notPriced: 2,
    } as unknown as PlayerLeagueImpact
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ impact }), { status: 200 }))
    const { container } = render(<Dash3AExposure exposure={state} />)
    await act(async () => {
      fireEvent.click(container.querySelector('.af3a-exp-more')!)
    })
    await waitFor(() => expect(container.querySelector('.af3a-impact-list')).not.toBeNull())
    expectSpanish(cardText(container), 'breakdown')
    for (const reason of reasons) expect(impactReasonText(reason, 'es'), reason).not.toBe(reason)
    expect(container.querySelector('.af3a-exp-more')?.textContent).toBe('Ocultar')
    expect([...container.querySelectorAll('.af3a-impact-slot')].slice(0, 2).map((s) => s.textContent)).toEqual(['titular', 'banca'])
  })

  it('English is unchanged', async () => {
    exposureDb('sleeper', [
      { players: ['4866'], starters: ['4866'] },
      { players: ['4866'], starters: ['4866'] },
    ])
    const { container } = render(<Dash3AExposure exposure={await getCrossLeagueExposure('u1', ['L0', 'L1'])} />)
    expect(container.querySelector('.af3a-exp-count')?.textContent).toBe('2 of 2')
    expect(container.querySelector('.af3a-exp-more')?.textContent).toBe('If he sits')
    expect(container.querySelector('.af3a-cardlink')?.textContent).toBe('Open Portfolio →')
    cleanup()
    const { container: none } = render(<Dash3AExposure exposure={await getCrossLeagueExposure('u1', [])} />)
    expect(none.querySelector('.af3a-reason')?.textContent).toBe('No leagues imported yet.')
  })
})

/* ── Following — getFollowingCard's real output ────────────────────────────────────────────────── */

const NOW = new Date('2026-09-16T12:00:00Z') // a Wednesday
const follow = (name: string, team: string | null) => ({
  sport: 'NFL',
  playerKey: name,
  externalId: null,
  sleeperId: name,
  name,
  position: 'RB',
  team,
  createdAt: NOW,
})
function facts(entries: Array<[string, string]>, over: Record<string, unknown> = {}) {
  return {
    byPlayer: new Map(entries.map(([n, status]) => [normalizeMatchName(n), { stale: false, status }])),
    ambiguous: [],
    newestFetchedAt: NOW,
    feedStale: false,
    coverage: { sourceAvailable: true, reason: null },
    ...over,
  }
}

async function followingCards() {
  db.follows = [
    follow('Jahmyr Gibbs', 'DET'),
    follow('Josh Allen', 'BUF'),
    follow('Bijan Robinson', 'ATL'),
    follow('Puka Nacua', 'LAR'),
    follow('Nico Collins', 'HOU'),
    follow('Breece Hall', 'MIA'),
    follow('Kyren Williams', 'LAR'),
  ]
  db.facts = facts([
    ['Jahmyr Gibbs', 'questionable'],
    ['Josh Allen', 'OUT'],
    ['Bijan Robinson', 'doubtful'],
    ['Puka Nacua', 'IR'],
  ])
  db.games = [
    { homeTeam: 'DET', awayTeam: 'KC', startTime: new Date('2026-09-20T17:00:00Z'), seasonType: 'regular', venue: null },
    { homeTeam: 'NYJ', awayTeam: 'BUF', startTime: new Date('2026-09-22T00:15:00Z'), seasonType: 'regular', venue: null },
    { homeTeam: 'ATL', awayTeam: 'TB', startTime: new Date('2026-09-18T00:15:00Z'), seasonType: 'regular', venue: null },
    { homeTeam: 'SEA', awayTeam: 'LAR', startTime: new Date('2026-09-19T23:00:00Z'), seasonType: 'pre', venue: null },
  ]
  const real = (await getFollowingCard('u1', NOW))!
  // The waiver nudge, one league and several, on the loader's own rows.
  real.rows[0]!.freeAgentIn = [{ leagueId: 'L1', leagueName: 'Ice Kings', href: '/core/waivers?league=L1' }]
  real.rows[1]!.freeAgentIn = [
    { leagueId: 'L1', leagueName: 'Ice Kings', href: '/core/waivers?league=L1' },
    { leagueId: 'L2', leagueName: 'Oficina FC', href: '/core/waivers?league=L2' },
  ]
  db.facts = facts([], { feedStale: true })
  const stale = (await getFollowingCard('u1', NOW))!
  db.follows = []
  const empty = (await getFollowingCard('u1', NOW))!
  return { real, stale, empty }
}

describe('Following — getFollowingCard’s real output', () => {
  it('the English next game is unchanged, byte for byte', async () => {
    const { real } = await followingCards()
    expect(real.rows.map((r) => r.next)).toEqual(['vs KC · Sun', '@ NYJ · Mon', 'vs TB · Thu', '@ SEA · Sat (pre)', null, null])
    expect(real.rows.map((r) => r.status)).toEqual(['QUESTIONABLE', 'OUT', 'DOUBTFUL', 'IR', null, null])
  })

  it('every row, status, next game, nudge and note reads Spanish', async () => {
    const { real, stale, empty } = await followingCards()
    lang.language = 'es'
    for (const data of [real, stale, empty]) {
      const { container, unmount } = render(<Dash3AFollowing following={data} />)
      expectSpanish(cardText(container).replace(/\b(KC|NYJ|TB|SEA|DET|BUF|ATL|LAR|HOU)\b/g, ''), JSON.stringify(data.rows.length))
      unmount()
    }
    const { container } = render(<Dash3AFollowing following={real} />)
    expect([...container.querySelectorAll('.af3a-follow-next')].map((n) => n.textContent)).toEqual([
      'vs KC · dom',
      '@ NYJ · lun',
      'vs TB · jue',
      '@ SEA · sáb (pretemp.)',
    ])
    expect([...container.querySelectorAll('.af3a-follow-status')].map((n) => n.textContent)).toEqual(['DUDOSO', 'FUERA', 'POCO PROBABLE', 'IR'])
    expect([...container.querySelectorAll('.af3a-follow-fa')].map((n) => n.textContent)).toEqual([
      'Agente libre en Ice Kings →',
      'Agente libre en 2 de tus ligas →',
    ])
    expect(container.textContent).toContain('+1 más que sigues.')
  })

  it('English is unchanged', async () => {
    const { real } = await followingCards()
    const { container } = render(<Dash3AFollowing following={real} />)
    expect(container.querySelector('.af3a-follow-next')?.textContent).toBe('vs KC · Sun')
    expect(container.querySelector('.af3a-follow-status')?.textContent).toBe('QUESTIONABLE')
    expect(container.querySelector('.af3a-follow-fa')?.textContent).toBe('Free agent in Ice Kings →')
    expect(container.textContent).toContain('+1 more you follow.')
  })
})

/* ── Receipts ──────────────────────────────────────────────────────────────────────────────────── */

const call = (id: string, c: 'right' | 'wrong' | 'same', followed: 'yes' | 'no' | 'unclear') => ({
  id,
  leagueId: 'L1',
  leagueName: 'Ice Kings',
  season: 2026,
  week: 2,
  slot: 'FLEX',
  recommended: { name: 'Jaylen Warren', points: 14.2 },
  instead: { name: 'Zack Moss', points: 9.1 },
  followed,
  call: c,
  href: '/core/my-team',
})

function receipts(n: 1 | 3): DecisionReceiptsData {
  return {
    trades: [
      {
        id: 't1', leagueId: 'L1', leagueName: 'Ice Kings', season: '2026', week: 2, createdIso: '2026-09-10T00:00:00Z',
        counterparty: 'Rodrigo', got: ['Puka Nacua'], gave: ['Josh Jacobs', 'Rashee Rice', 'Tank Dell'],
        gotPoints: 40, gavePoints: 30, netPoints: 10, outcome: 'ahead', ongoing: true, unsettledPicks: n, href: '/core/trades',
      },
      {
        id: 't2', leagueId: 'L1', leagueName: 'Ice Kings', season: '2026', week: 3, createdIso: '2026-09-17T00:00:00Z',
        counterparty: null, got: [], gave: ['Tank Dell'], gotPoints: 0, gavePoints: 3, netPoints: -3, outcome: 'behind',
        ongoing: false, unsettledPicks: 0, href: '/core/trades',
      },
      {
        id: 't3', leagueId: 'L1', leagueName: 'Ice Kings', season: '2026', week: 3, createdIso: '2026-09-17T00:00:00Z',
        counterparty: null, got: ['Zay Flowers', 'Tee Higgins'], gave: ['Tank Dell'], gotPoints: 3, gavePoints: 3, netPoints: 0, outcome: 'even',
        ongoing: false, unsettledPicks: 0, href: '/core/trades',
      },
    ],
    tooEarly: n,
    uncoveredLeagues: 2,
    waivers: [
      { id: 'w1', leagueId: 'L1', leagueName: 'Ice Kings', season: 2026, week: 1, playerId: '1', playerName: 'Tank Bigsby', position: 'RB', via: 'waiver', faab: 12, points: 33.4, starts: n, weeksScored: 3, leftWeek: null, href: '/core/waivers' },
      { id: 'w2', leagueId: 'L1', leagueName: 'Ice Kings', season: 2026, week: 1, playerId: '2', playerName: 'Wan’Dale Robinson', position: null, via: 'free_agent', faab: null, points: 4, starts: 0, weeksScored: 2, leftWeek: 3, href: '/core/waivers' },
    ],
    waiversTooEarly: n,
    waiversUnscored: n,
    lineups: [
      { id: 'l1', leagueId: 'L1', leagueName: 'Ice Kings', season: 2026, week: 2, pointsLeft: 0, perfect: true, benched: null, started: null, href: '/core/my-team' },
      {
        id: 'l2', leagueId: 'L1', leagueName: 'Ice Kings', season: 2026, week: 3, pointsLeft: 12.5, perfect: false,
        benched: { name: 'Zack Moss', points: 15 }, started: { name: 'Tank Dell', points: 2.5 },
        lineupChanges: { in: [{ name: 'Zack Moss', points: 15 }], out: [{ name: 'Tank Dell', points: 2.5 }] }, href: '/core/my-team',
      },
      {
        id: 'l3', leagueId: 'L1', leagueName: 'Ice Kings', season: 2026, week: 1, pointsLeft: 4, perfect: false,
        benched: { name: 'Zack Moss', points: 8 }, started: null, href: '/core/my-team',
      },
    ],
    lineupsUnscored: n,
    lineupsUnreadable: n,
    autocoach: [call('a1', 'right', 'yes'), call('a2', 'wrong', 'no'), call('a3', 'same', 'unclear')],
    autocoachPending: n,
    autocoachUnscored: n,
    autocoachUnreadable: n,
    chimmyRecord: { right: n, wrong: 1, same: n, ratePct: n === 3 ? 75 : null },
    chimmy: [{ ...call('c1', 'right', 'yes'), confidencePct: 70 }],
    chimmyPending: n,
    chimmyUnscored: n,
    chimmyUnreadable: n,
    chimmyAdds: [
      { id: 'd1', leagueId: 'L1', leagueName: 'Ice Kings', season: 2026, week: 1, playerName: 'Tank Bigsby', confidencePct: 60, added: { week: 1, points: 20, starts: n, leftWeek: n === 3 ? 4 : null }, href: '/core/waivers' },
      { id: 'd2', leagueId: 'L1', leagueName: 'Ice Kings', season: 2026, week: 2, playerName: 'Zay Flowers', confidencePct: null, added: null, href: '/core/waivers' },
    ],
    chimmyAddsTooEarly: n,
    chimmyAddsUnscored: n,
    chimmyAddsUnknown: n,
  }
}

describe('Receipts', () => {
  it('every receipt and every count, singular and plural, reads Spanish', () => {
    lang.language = 'es'
    for (const n of [1, 3] as const) {
      const { container, unmount } = render(<Dash3AReceipts receipts={receipts(n)} />)
      // Player and league names are the fixture's own.
      const out = cardText(container).replace(/Tank Dell|Tank Bigsby|Zack Moss|Jaylen Warren|Wan’Dale Robinson|Josh Jacobs|Rashee Rice|Puka Nacua|Zay Flowers|Tee Higgins/g, '')
      expectSpanish(out, String(n))
      expect(out).toContain('RESULTADOS DE TUS DECISIONES')
      unmount()
    }
    const { container } = render(<Dash3AReceipts receipts={receipts(3)} />)
    const results = [...container.querySelectorAll('.af3a-receipt-result')].map((n) => n.textContent)
    expect(results[0]).toBe('+10.0 pts desde entonces: vas ganando (sigue contando)')
    expect(container.querySelector('[data-kind="chimmy-record"]')?.textContent).toBe(
      'Historial de Chimmy en tus decisiones de titular o banca: 3 aciertos, 1 fallo (75%) · 3 casos demasiado parejos para juzgar',
    )
    expect(container.querySelector('[data-kind="autocoach"] .af3a-receipt-title')?.textContent).toBe(
      'AutoCoach dijo que alinearas a Jaylen Warren en lugar de Zack Moss',
    )
  })

  it('English is unchanged', () => {
    const { container } = render(<Dash3AReceipts receipts={receipts(3)} />)
    const results = [...container.querySelectorAll('.af3a-receipt-result')].map((n) => n.textContent)
    expect(results[0]).toBe('+10.0 pts since — you’re ahead (still counting)')
    expect(results[3]).toBe('33.4 pts for you · 3 starts (still yours)')
    expect(container.querySelector('[data-kind="chimmy-record"]')?.textContent).toBe(
      'Chimmy’s record on your start/sit calls: 3 right, 1 wrong (75%) · 3 too close to call',
    )
    expect(container.querySelector('.af3a-receipt-swap')?.textContent).toBe('Gave Josh Jacobs, Rashee Rice +1 · got Puka Nacua')
    expect(container.textContent).toContain('3 picks not drafted yet — not counted')
    expect(container.textContent).toContain('3 weeks couldn’t be checked — a starter’s position or the league’s lineup slots aren’t on file.')
  })
})

/* ── My leagues ────────────────────────────────────────────────────────────────────────────────── */

const LEAGUES: Dash34League[] = [
  { id: 'a', name: 'Ice Kings', platform: 'sleeper', href: '/core', formatLabel: '2026 · 12-team · Dynasty · PPR Superflex', isCommissioner: true },
  { id: 'b', name: 'Oficina FC', platform: 'espn', href: '/core', formatLabel: '2026 · 10-team · Guillotine · Half PPR' },
  { id: 'c', name: null as unknown as string, platform: 'yahoo', href: '/core', formatLabel: null },
]

describe('My leagues', () => {
  it('the card, its format labels and every state read Spanish', () => {
    lang.language = 'es'
    for (const [leagues, total] of [[LEAGUES, 3], [LEAGUES, 63], [[], 0]] as const) {
      const { container, unmount } = render(<Dash3ALeagues leagues={[...leagues]} totalLeagues={total} />)
      expectSpanish(cardText(container).replace(/Half PPR|PPR Superflex/g, ''), String(total))
      unmount()
    }
    const { container } = render(<Dash3ALeagues leagues={LEAGUES} totalLeagues={63} />)
    expect([...container.querySelectorAll('.af3a-league-body em')].map((e) => e.textContent)).toEqual([
      '2026 · 12 equipos · Dynasty · PPR Superflex',
      '2026 · 10 equipos · Guillotina · Half PPR',
      'Liga importada',
    ])
    expect(container.querySelector('.af3a-note')?.textContent).toBe('3 de 63')
    expect(container.querySelector('.af3a-cardlink')?.textContent).toBe('Ver las 63 →')
  })

  it('English is unchanged', () => {
    const { container } = render(<Dash3ALeagues leagues={LEAGUES} totalLeagues={3} />)
    expect(container.querySelector('.af3a-note')?.textContent).toBe('3 total')
    expect([...container.querySelectorAll('.af3a-league-body em')].map((e) => e.textContent)).toEqual([
      '2026 · 12-team · Dynasty · PPR Superflex',
      '2026 · 10-team · Guillotine · Half PPR',
      'Imported league',
    ])
    expect(container.textContent).toContain('Untitled league')
  })
})
