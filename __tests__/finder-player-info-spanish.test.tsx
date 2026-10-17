/**
 * Player Finder's player-info cards in Spanish (2026-10-05) — the live game badge, the injury
 * timeline chip, "Next man up", "Who'd start him", "This season" and "News"
 * (components/core-app/player-finder/), worded in lib/core-app/finderPlayerInfoCopy.ts.
 *
 * Every value is REAL output of the pure half of each loader: `reconcileGame` for the badge,
 * `buildInjuryTimeline` for the chip, `presenceCells` for the depth chart's leagues,
 * `rankWhoStartsHim` for the sell side, `summarizeSeason` for the season card and `mergeNewsItems`
 * for the news list. The reasons and notes the DB-bound loaders write (playerDepth.ts, playerCard.ts,
 * whoStartsHimLoader.ts) are held to their source files verbatim instead — a reworded reason fails
 * here rather than silently going English.
 *
 * ⚠ PROVIDER TEXT STAYS AS WRITTEN. A news headline is the feed's — the English one in the fixture
 * must come through untouched — so headlines are cut out of the scan and asserted verbatim.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import { LiveGameBadge } from '@/components/core-app/player-finder/LiveGameBadge'
import { InjuryTimelineChip } from '@/components/core-app/player-finder/InjuryTimelineChip'
import { DepthChartBackups } from '@/components/core-app/player-finder/DepthChartBackups'
import { WhoStartsHim } from '@/components/core-app/player-finder/WhoStartsHim'
import { PlayerSeasonCard } from '@/components/core-app/player-finder/PlayerSeasonCard'
import { PlayerNews } from '@/components/core-app/player-finder/PlayerNews'
import { reconcileGame, type GameRow, type LiveGameBadge as LiveGameBadgeData } from '@/lib/core-app/liveGameBadge'
import { buildInjuryTimeline, type TimelineRow } from '@/lib/core-app/injuryTimeline'
import { presenceCells, type DepthChartView } from '@/lib/core-app/depthChart'
import { rankWhoStartsHim, type SellLeague, type SellRoster, type WhoStartsHim as WhoStartsHimData } from '@/lib/core-app/whoStartsHim'
import { summarizeSeason, type SeasonWeek } from '@/lib/core-app/playerSeason'
import { mergeNewsItems, type PlayerCardNews } from '@/lib/core-app/playerCard'
import { INFO_REASON_KEYS, infoReasonText } from '@/lib/core-app/finderPlayerInfoCopy'

const EN_DAY = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/
const EN_MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/
/**
 * These cards' own English, word by word. Fixture names avoid every one. Not here: "Final" / "final"
 * (the same word in Spanish), PPR, IR, taxi, flex, and the club codes.
 */
const OWN_EN =
  /\b(Live|Week|week|starting|bench|updated|ago|just now|No league score|refresh|from|Improved|Worse|Was|reported|est\. return|estimates|Next man up|spot|Yours|Free|Taken|leagues?|Can't read|Claim|Depth|this player|Who plays|misses|number|as of|injury status|chart|Who'd start|Which teams|no team|would start|teams?|more|Open|Trade Center|Ranked|market value|It's|This season|scoring|Points|Per game|Games|Best|wk|scored|projected|nothing on file|Met or beat|off by|Wk|Opp|Proj|Scored|no stats|News|could not|No recent|No weekly|Another|other|lineup|modelled|couldn’t|can’t|too few|he has|is not on file|are on file|just now)\b/

/** Visible text plus every title, aria-label and placeholder — the reader hears those too. Headlines are the feed's. */
function ownText(container: HTMLElement): string {
  const root = container.cloneNode(true) as HTMLElement
  root.querySelectorAll('.af-pf-news-title').forEach((n) => n.remove())
  const attrs = [...root.querySelectorAll('[title],[aria-label],[placeholder]')].flatMap((n) => [
    n.getAttribute('title') ?? '',
    n.getAttribute('aria-label') ?? '',
    n.getAttribute('placeholder') ?? '',
  ])
  return [root.textContent ?? '', ...attrs].join(' | ')
}

/** Everything a reader gets, English included — the pin for English mode. */
function allText(container: HTMLElement): string {
  const attrs = [...container.querySelectorAll('[title],[aria-label],[placeholder]')].flatMap((n) =>
    ['title', 'aria-label', 'placeholder'].map((a) => n.getAttribute(a)).filter((v): v is string => v != null),
  )
  return [container.textContent ?? '', ...attrs].join(' | ')
}

function expectSpanish(out: string, label: string) {
  expect(out.length, label).toBeGreaterThan(0)
  expect(out, label).not.toMatch(EN_DAY)
  expect(out, label).not.toMatch(EN_MONTH)
  const hit = out.match(OWN_EN)
  expect(hit?.[0] ?? null, `${label}: …${hit ? out.slice(Math.max(0, hit.index! - 60), hit.index! + 60) : ''}…`).toBeNull()
}

afterEach(() => {
  cleanup()
  lang.language = 'en'
})

/* ── Fixtures: real output of each loader's pure half ─────────────────────────────────────────── */

/** The Monday-night game (player-finder-live-badge.test.tsx). */
const KICK = '2026-09-29T00:15:00.000Z'
const at = (h: number) => new Date(Date.parse(KICK) + h * 3_600_000)
const gameRow = (status: string, home: number | null, away: number | null): GameRow => ({
  homeTeam: 'PHI', awayTeam: 'DAL', homeScore: home, awayScore: away, status, startTime: KICK, seasonType: null, week: 3, updatedAt: KICK,
})
const fold = (t: string) => t

function liveBadges(): Array<[string, LiveGameBadgeData, string]> {
  const live = reconcileGame({ club: 'PHI', rows: [gameRow('in_progress', 14, 10)], now: at(1.5), fold })!
  const final = reconcileGame({ club: 'DAL', rows: [gameRow('final', 27, 20)], now: at(7), fold })!
  const noScore = { ...live, homeScore: null, awayScore: null }
  const leagues = [
    { leagueId: 'L1', leagueName: 'Liga Norte', points: 12.4, isStarter: true, updatedAt: at(1.5 - 4 / 60).toISOString(), finalized: false },
    { leagueId: 'L2', leagueName: 'Oficina FC', points: 3.1, isStarter: false, updatedAt: at(1.5).toISOString(), finalized: false },
    { leagueId: 'L3', leagueName: 'Dinastía', points: 7.0, isStarter: true, updatedAt: at(-1).toISOString(), finalized: false },
  ]
  return [
    ['live, three leagues', { game: live, leagues }, at(1.5).toISOString()],
    ['final, finalized', { game: final, leagues: [{ ...leagues[0]!, finalized: true }] }, at(7).toISOString()],
    ['no league score, no score line', { game: noScore, leagues: [] }, at(1.5).toISOString()],
  ]
}

const TL_NOW = new Date('2026-09-28T12:00:00Z')
const tlRow = (status: string, date: string, returnDate: string | null = null, source = 'espn'): TimelineRow => ({
  status, date: new Date(`${date}T15:00:00Z`), fetchedAt: new Date(`${date}T15:00:00Z`), source, returnDate,
})
function timelines() {
  const up = buildInjuryTimeline({
    rows: [tlRow('Out', '2026-09-18'), tlRow('Questionable', '2026-09-26', '2026-10-05')],
    current: { status: 'Questionable', reportedAt: new Date('2026-09-25T15:00:00Z') },
    now: TL_NOW,
  })!
  const down = buildInjuryTimeline({
    rows: [tlRow('Active', '2026-09-20'), tlRow('Out', '2026-09-27')],
    current: { status: 'Out', reportedAt: new Date('2026-09-26T15:00:00Z') },
    now: TL_NOW,
  })!
  const fromIr = buildInjuryTimeline({
    rows: [tlRow('Injured Reserve', '2026-09-12'), tlRow('Doubtful', '2026-09-27', '2026-10-12')],
    current: { status: 'Doubtful', reportedAt: new Date('2026-09-26T15:00:00Z') },
    now: TL_NOW,
  })!
  return { up, down, fromIr }
}

const LEAGUES = [
  { id: 'L1', name: 'Liga Norte' },
  { id: 'L2', name: 'Oficina FC' },
  { id: 'L3', name: 'Dinastía' },
  { id: 'L4', name: 'Barrio' },
  { id: 'L5', name: 'Primos' },
]
const claim = (leagueId: string) => ({ href: `https://sleeper.com/leagues/${leagueId}/players`, label: 'Open in Sleeper', platformLabel: 'Sleeper', screen: 'Players', external: true })
const slot = (leagueId: string, s: string, isYours: boolean, owner: string | null = null) =>
  ({ leagueId, slot: s, isYours, owner: owner ? { teamName: owner } : null }) as never

function depthView(over: Partial<DepthChartView> = {}): DepthChartView {
  return {
    team: 'BUF',
    slot: 'RB',
    asOfIso: '2026-09-23T10:00:00.000Z',
    hisDepth: 1,
    entries: [
      { depth: 1, name: 'James Cook', sleeperId: 'S1', ref: 'NFL:E1', isHim: true },
      { depth: 2, name: 'Ray Davis', sleeperId: 'S2', ref: 'NFL:E2', isHim: false },
      { depth: 3, name: 'Ty Johnson', sleeperId: 'S3', ref: null, isHim: false },
    ],
    presence: {
      S2: presenceCells(LEAGUES, [slot('L1', 'STARTER', true), slot('L2', 'BENCH', true), slot('L3', 'NOT YOURS', false, 'Los Toros')], [{ leagueId: 'L5' }], claim),
      S3: presenceCells(LEAGUES, [slot('L1', 'IR SLOT', true), slot('L2', 'TAXI', true), slot('L3', 'NOT YOURS', false, 'Los Toros'), slot('L4', 'NOT YOURS', false, null)], [], claim),
    },
    ...over,
  }
}

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN']
const P = (id: string, position: string, value: number | null, name = `P${id}`) => ({ id, name, position, value })
const roster = (key: string, rb: [number, number, number], teamName = `Equipo ${key}`): SellRoster => ({
  key,
  teamName,
  players: [
    P(`${key}qb`, 'QB', 60),
    P(`${key}rb1`, 'RB', rb[0], `Rojas ${key}1`),
    P(`${key}rb2`, 'RB', rb[1], `Rojas ${key}2`),
    P(`${key}rb3`, 'RB', rb[2], `Rojas ${key}3`),
    P(`${key}wr1`, 'WR', 50),
    P(`${key}wr2`, 'WR', 50),
    P(`${key}wr3`, 'WR', 45),
    P(`${key}te`, 'TE', 30),
  ],
})

function whoStarts(): WhoStartsHimData {
  const others = [roster('A', [10, 5, 2]), roster('B', [20, 15, 12]), roster('C', [30, 25, 22], 'Another team'), roster('D', [35, 30, 28]), roster('E', [90, 80, 70])]
  const { teams } = rankWhoStartsHim({ him: { id: 'him', position: 'RB', value: 40 }, others, slots: SLOTS })
  // A team with an empty slot he would fill outright.
  const hole = rankWhoStartsHim({ him: { id: 'him', position: 'RB', value: 40 }, others: [{ key: 'F', teamName: 'Equipo F', players: [P('Fqb', 'QB', 60)] }], slots: ['QB', 'RB'] })
  const ranked: SellLeague = { leagueId: 'L1', leagueName: 'Liga Norte', state: 'ranked', note: null, teams, otherTeams: others.length }
  const filler: SellLeague = { leagueId: 'L2', leagueName: 'Oficina FC', state: 'ranked', note: null, teams: hole.teams, otherTeams: 1 }
  const none: SellLeague = { leagueId: 'L3', leagueName: 'Dinastía', state: 'ranked', note: null, teams: [], otherTeams: 9 }
  // Every note whoStartsHimLoader.ts writes, plus both forms of the templated one.
  const notes = [...INFO_REASON_KEYS.filter((k) => WHO_STARTS_SRC.includes(`'${k}'`)), 'lineup slot IDP_FLEX isn’t modelled', 'lineup slots DL, LB aren’t modelled']
  const unmeasured: SellLeague[] = notes.map((note, i) => ({ leagueId: `N${i}`, leagueName: `Liga ${i}`, state: 'unmeasured', note, teams: [], otherTeams: 0 }))
  return { leagues: [ranked, filler, none, ...unmeasured], locked: false }
}

const WEEKS: SeasonWeek[] = [
  { week: 1, opponent: 'ARI', projected: 18.2, actual: 31.3, played: true },
  { week: 2, opponent: 'NYJ', projected: 17.0, actual: 11.1, played: true },
  { week: 3, opponent: 'MIA', projected: 16.5, actual: null, played: false },
  { week: 4, opponent: null, projected: null, actual: 9.4, played: true },
]

const NEWS_NOW = '2026-09-27T16:10:00.000Z'
const HEADLINE = 'Cook limited at practice with ankle injury'
function newsItems(): PlayerCardNews[] {
  const news: PlayerCardNews[] = [
    { title: HEADLINE, source: 'espn', url: 'https://x/1', publishedAt: '2026-09-27T16:10:00.000Z' },
    { title: 'Bills backfield outlook', source: 'newsapi_sports', url: 'https://x/2', publishedAt: '2026-09-27T15:58:00.000Z' },
    { title: 'Cook questionable for Sunday', source: 'rolling_insights', url: null, publishedAt: '2026-09-27T12:00:00.000Z' },
  ]
  const blurbs: PlayerCardNews[] = [{ title: 'Cook returned to a full practice', source: 'sleeper_live', url: null, publishedAt: '2026-09-19T14:00:00.000Z' }]
  return mergeNewsItems(news, blurbs, null)
}

const SRC = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const PLAYER_DEPTH_SRC = SRC('lib/core-app/playerDepth.ts')
const PLAYER_CARD_SRC = SRC('lib/core-app/playerCard.ts')
const WHO_STARTS_SRC = SRC('lib/core-app/whoStartsHimLoader.ts')

/** Every case each component is rendered in, in both languages. */
function cases(): Array<[string, () => React.ReactElement]> {
  const tl = timelines()
  const out: Array<[string, () => React.ReactElement]> = []
  for (const [name, data, nowIso] of liveBadges()) out.push([`LiveGameBadge — ${name}`, () => <LiveGameBadge data={data} nowIso={nowIso} />])
  out.push(['InjuryTimelineChip — up from Out, ESPN return', () => <InjuryTimelineChip timeline={tl.up} />])
  out.push(['InjuryTimelineChip — down from Active', () => <InjuryTimelineChip timeline={tl.down} />])
  out.push(['InjuryTimelineChip — up from Injured Reserve, ESPN return', () => <InjuryTimelineChip timeline={tl.fromIr} />])
  const href = (ref: string, n: string) => `/core/players?q=${encodeURIComponent(n)}&player=${ref}`
  out.push(['DepthChartBackups — he is the starter', () => <DepthChartBackups data={depthView()} playerName="James Cook" hrefFor={href} />])
  out.push([
    'DepthChartBackups — he is number 2 at a split receiver spot',
    () => (
      <DepthChartBackups
        data={depthView({ slot: 'WR2', hisDepth: 2, entries: [{ ...depthView().entries[1]!, depth: 1 }, { ...depthView().entries[0]!, depth: 2 }, depthView().entries[2]!] })}
        playerName="James Cook"
        hrefFor={href}
      />
    ),
  ])
  out.push(['WhoStartsHim — ranked, a filled hole, nobody, and every note', () => <WhoStartsHim data={whoStarts()} playerName="James Cook" access={null} />])
  out.push([
    'PlayerSeasonCard — PPR',
    () => <PlayerSeasonCard name="James Cook" state={{ available: true, data: { season: 2026, scoring: { kind: 'ppr' }, weeks: WEEKS, summary: summarizeSeason(WEEKS) } }} />,
  ])
  out.push([
    'PlayerSeasonCard — league scoring, one compared week',
    () => {
      const w = WEEKS.slice(0, 1)
      return <PlayerSeasonCard name="James Cook" state={{ available: true, data: { season: 2026, scoring: { kind: 'league', leagueName: 'Liga Norte' }, weeks: w, summary: summarizeSeason(w) } }} />
    },
  ])
  out.push([
    'PlayerSeasonCard — unavailable',
    () => <PlayerSeasonCard name="James Cook" state={{ available: false, reason: 'No weekly projections or stat lines on file for this player.' }} />,
  ])
  out.push(['PlayerNews — every age, every source', () => <PlayerNews nowIso={NEWS_NOW} state={{ available: true, data: newsItems() }} />])
  out.push(['PlayerNews — could not read', () => <PlayerNews nowIso={NEWS_NOW} state={{ available: false, reason: 'News could not be read.' }} />])
  out.push(['PlayerNews — nothing recent', () => <PlayerNews nowIso={NEWS_NOW} state={{ available: false, reason: 'No recent item mentions this player.' }} />])
  return out
}

/* ── Spanish ─────────────────────────────────────────────────────────────────────────────────── */

describe('Player Finder player-info cards in Spanish', () => {
  it('no English word of their own, weekday or month — text, titles, aria-labels', () => {
    lang.language = 'es'
    for (const [label, el] of cases()) {
      const { container, unmount } = render(el())
      expectSpanish(ownText(container), label)
      unmount()
    }
  })

  it('the live badge: En vivo, the week, titular / en tu banca, the age through ageText', () => {
    lang.language = 'es'
    const [[, live, now], [, final, finalNow], [, none, noneNow]] = liveBadges()
    const a = render(<LiveGameBadge data={live} nowIso={now} />).container
    expect(a.querySelector('.af-pf-live-tag')!.textContent).toBe('En vivo')
    expect(a.querySelector('.af-pf-live-score')!.textContent).toBe('PHI 14 – 10 DAL')
    expect(a.querySelector('.af-pf-live-week')!.textContent).toBe('Semana 3')
    const metas = [...a.querySelectorAll('.af-pf-live-meta')].map((n) => n.textContent)
    expect(metas).toEqual(['titular · actualizado hace 4 min', 'en tu banca · actualizado justo ahora', 'titular · actualizado hace 3 h'])
    cleanup()
    const b = render(<LiveGameBadge data={final} nowIso={finalNow} />).container
    expect(b.querySelector('.af-pf-live-tag')!.textContent).toBe('Final')
    expect(b.querySelector('.af-pf-live-meta')!.textContent).toBe('titular · final')
    cleanup()
    const c = render(<LiveGameBadge data={none} nowIso={noneNow} />).container
    expect(c.querySelector('.af-pf-live-score')!.textContent).toBe('vs DAL')
    expect(c.querySelector('.af-pf-live-none')!.textContent).toMatch(/^No hay puntos de liga registrados para él esta semana/)
  })

  it('the injury chip: the designation singular through designationText, the date day-first', () => {
    lang.language = 'es'
    const tl = timelines()
    const chip = render(<InjuryTimelineChip timeline={tl.up} />).container.querySelector('.af-pf-injtl')!
    expect(chip.querySelector('[aria-hidden]')!.textContent).toBe('↑ desde Fuera · regreso est. ESPN 5 oct')
    expect(chip.getAttribute('title')).toBe('Mejoró respecto a Fuera, reportado por última vez el 18 sep. ESPN estima su regreso para el 5 oct.')
    cleanup()
    const down = render(<InjuryTimelineChip timeline={tl.down} />).container.querySelector('.af-pf-injtl')!
    expect(down.querySelector('[aria-hidden]')!.textContent).toBe('↓ desde Activo')
    expect(down.getAttribute('title')).toBe('Peor que Activo, reportado por última vez el 20 sep.')
    cleanup()
    const ir = render(<InjuryTimelineChip timeline={tl.fromIr} />).container.querySelector('.af-pf-injtl')!
    expect(ir.querySelector('[aria-hidden]')!.textContent).toBe('↑ desde Lista de lesionados · regreso est. ESPN 12 oct')
  })

  it('the depth chart: the heading, every presence state, the claim link, the footnote', () => {
    lang.language = 'es'
    const href = (ref: string, n: string) => `/core/players?q=${n}&player=${ref}`
    const c = render(<DepthChartBackups data={depthView()} playerName="James Cook" hrefFor={href} />).container
    expect(c.querySelector('#af-pf-dc-h')!.textContent).toBe('El relevo · BUF RB')
    const davis = [...c.querySelectorAll('.af-pf-dc-row')][1]!
    expect([...davis.querySelectorAll('.af-pf-dc-cell')].map((n) => n.textContent)).toEqual([
      'Tuyo Liga Norte · titular',
      'Tuyo Oficina FC · banca',
      'Libre BarrioReclamar a Davis en Sleeper',
      'Ocupado en 1 liga: Dinastía (Los Toros)',
      'No se puede leer Primos',
    ])
    const johnson = [...c.querySelectorAll('.af-pf-dc-row')][2]!
    expect([...johnson.querySelectorAll('.af-pf-dc-cell')].map((n) => n.textContent)).toEqual([
      'Tuyo Liga Norte · IR',
      'Tuyo Oficina FC · taxi',
      'Libre PrimosReclamar a Johnson en Sleeper',
      'Ocupado en 2 ligas: Barrio, Dinastía (Los Toros)',
    ])
    expect(c.querySelector('.af-pf-dc-you')!.textContent).toBe('este jugador')
    expect(c.querySelector('.af-pf-dc-depth')!.getAttribute('aria-label')).toBe('Número 1 en la rotación')
    expect(c.querySelector('.af-pf-dc-foot')!.textContent).toBe(
      'Quién juega si Cook se pierde partidos, en orden. Rotación al 23 sep; el estado de lesión está en la ficha de arriba, no sale de esta tabla.',
    )
    cleanup()
    const [, [, wr]] = cases().filter(([l]) => l.startsWith('DepthChartBackups'))
    const w = render(wr()).container
    expect(w.querySelector('#af-pf-dc-h')!.textContent).toBe('El relevo · BUF WR puesto 2')
    expect(w.querySelector('.af-pf-dc-foot')!.textContent).toMatch(/^Cook es el número 2 aquí\. /)
  })

  it("who'd start him: the heading, the counts, the slot lines, every loader note, the Trade Center link", () => {
    lang.language = 'es'
    const data = whoStarts()
    const c = render(<WhoStartsHim data={data} playerName="James Cook" access={null} />).container
    expect(c.querySelector('#af-pf-ws-h')!.textContent).toBe('Quién pondría de titular a Cook')
    const rows = [...c.querySelectorAll('.af-pf-ws-row')]
    expect(rows[0]!.querySelector('.af-pf-ws-count')!.textContent).toBe(`sería titular en ${data.leagues[0]!.teams.length} de 5 equipos`)
    expect(rows[0]!.querySelector('.af-pf-ws-why')!.textContent).toMatch(/^en (RB|flex), en lugar de Rojas A\d$/)
    expect(rows[0]!.textContent).toContain('Otro equipo')
    expect(rows[0]!.querySelector('.af-pf-ws-more')!.textContent).toBe('+1 más')
    expect(rows[0]!.querySelector('.af-pf-ws-go')!.textContent).toBe('Abrir Centro de intercambios')
    expect(rows[1]!.querySelector('.af-pf-ws-count')!.textContent).toBe('sería titular en 1 de 1 equipo')
    expect(rows[1]!.querySelector('.af-pf-ws-why')!.textContent).toBe('en RB: un puesto que no pueden cubrir')
    expect(rows[2]!.querySelector('.af-pf-ws-count')!.textContent).toBe('ningún equipo lo pondría de titular por delante de lo que tiene')
    const notes = rows.slice(3).map((r) => r.querySelector('.af-pf-ws-note')!.textContent)
    expect(notes).toContain('no encontramos tu equipo en esta liga')
    expect(notes).toContain('el puesto de alineación IDP_FLEX no está modelado')
    expect(notes).toContain('los puestos de alineación DL, LB no están modelados')
    expect(c.querySelector('.af-pf-ws-foot')!.textContent).toMatch(/^Ordenado por cuánto sumaría/)
  })

  it('the season card: the stats, the chart label, the headline from the summary, the table', () => {
    lang.language = 'es'
    const c = render(
      <PlayerSeasonCard name="James Cook" state={{ available: true, data: { season: 2026, scoring: { kind: 'ppr' }, weeks: WEEKS, summary: summarizeSeason(WEEKS) } }} />,
    ).container
    expect(c.querySelector('#af-pf-season-h')!.textContent).toBe('Esta temporada · 2026')
    expect([...c.querySelectorAll('dt')].map((n) => n.textContent)).toEqual(['Puntos', 'Por partido', 'Partidos', 'Mejor'])
    expect(c.querySelectorAll('dd')[3]!.textContent).toBe('31.3 · sem. 1')
    expect(c.querySelector('svg')!.getAttribute('aria-label')).toBe(
      'James Cook, semana a semana: semana 1: anotó 31.3, proyectado 18.2; semana 2: anotó 11.1, proyectado 17.0; semana 3: nada registrado, proyectado 16.5; semana 4: anotó 9.4',
    )
    expect(c.querySelector('.af-pf-season-headline')!.textContent).toBe(' · Igualó o superó su proyección en 1 de 2 semanas · con un desvío medio de 9.5 por semana')
    expect([...c.querySelectorAll('th')].map((n) => n.textContent)).toEqual(['Sem.', 'Rival', 'Proy.', 'Anotó'])
    expect(c.querySelectorAll('tbody tr')[2]!.textContent).toBe('3MIA16.5sin estadísticas')
    cleanup()
    const [, [, league], [, gone]] = cases().filter(([l]) => l.startsWith('PlayerSeasonCard'))
    const l = render(league()).container
    expect(l.querySelector('.af-pf-season-scoring')!.textContent).toBe('Puntuación de Liga Norte')
    expect(l.querySelector('.af-pf-season-headline')!.textContent).toBe(' · Igualó o superó su proyección en 1 de 1 semana · con un desvío medio de 13.1 por semana')
    cleanup()
    expect(render(gone()).container.querySelector('.af-pf-unavailable')!.textContent).toBe(
      'No hay proyecciones semanales ni estadísticas registradas para este jugador.',
    )
  })

  it('news: the heading, every age and the dated item day-first, the feed label — and the headline as the feed wrote it', () => {
    lang.language = 'es'
    const c = render(<PlayerNews nowIso={NEWS_NOW} state={{ available: true, data: newsItems() }} />).container
    expect(c.querySelector('#af-pf-news-h')!.textContent).toBe('Noticias')
    expect([...c.querySelectorAll('.af-pf-news-title')].map((n) => n.textContent)).toEqual([
      HEADLINE,
      'Bills backfield outlook',
      'Cook questionable for Sunday',
      'Cook returned to a full practice',
    ])
    expect([...c.querySelectorAll('.af-pf-news-meta')].map((n) => n.textContent)).toEqual([
      'ESPN · justo ahora',
      'Noticias · hace 12 min',
      'Rolling Insights · hace 4 h',
      'Sleeper · sáb 19/9',
    ])
    cleanup()
    expect(render(<PlayerNews nowIso={NEWS_NOW} state={{ available: false, reason: 'News could not be read.' }} />).container.textContent).toBe(
      'NoticiasNo se pudieron leer las noticias.',
    )
  })

  it('every reason key is a sentence its loader writes today, verbatim', () => {
    for (const key of INFO_REASON_KEYS) {
      const quoted = `'${key}'`
      expect(PLAYER_DEPTH_SRC.includes(quoted) || PLAYER_CARD_SRC.includes(quoted) || WHO_STARTS_SRC.includes(quoted), key).toBe(true)
    }
    // The templated note: whoStartsHimLoader.ts builds "lineup slot(s) <slots> isn’t / aren’t modelled".
    expect(WHO_STARTS_SRC).toContain("`lineup slot${unknownSlots.length === 1 ? '' : 's'} ${unknownSlots.join(', ')} ${unknownSlots.length === 1 ? 'isn’t' : 'aren’t'} modelled`")
    // Every note the loader writes as a literal is a key.
    const literals = [...WHO_STARTS_SRC.matchAll(/(?:unread|unmeasured)\(l, '([^']+)'/g)].map((m) => m[1]!)
    expect(literals.length).toBeGreaterThanOrEqual(6)
    for (const lit of literals) expect(INFO_REASON_KEYS, lit).toContain(lit)
    // An unknown reason stays whole English.
    expect(infoReasonText('something new the loader says', 'es')).toBe('something new the loader says')
  })
})

/* ── English is unchanged ────────────────────────────────────────────────────────────────────── */

describe('Player Finder player-info cards in English', () => {
  it('render exactly as before', () => {
    const got = Object.fromEntries(
      cases().map(([label, el]) => {
        const { container, unmount } = render(el())
        const t = allText(container)
        unmount()
        return [label, t]
      }),
    )
    expect(got).toMatchInlineSnapshot(`
      {
        "DepthChartBackups — he is number 2 at a split receiver spot": "Next man up · BUF WR spot 21Ray DavisYours Liga Norte · startingYours Oficina FC · benchFree BarrioClaim Davis in SleeperTaken in 1 league: Dinastía (Los Toros)Can't read Primos2James Cookthis player3Ty JohnsonYours Liga Norte · IRYours Oficina FC · taxiFree PrimosClaim Johnson in SleeperTaken in 2 leagues: Barrio, Dinastía (Los Toros)Cook is number 2 here. Depth chart as of Sep 23; injury status is on the card above, not from this chart. | Depth 1 | Depth 2 | Depth 3",
        "DepthChartBackups — he is the starter": "Next man up · BUF RB1James Cookthis player2Ray DavisYours Liga Norte · startingYours Oficina FC · benchFree BarrioClaim Davis in SleeperTaken in 1 league: Dinastía (Los Toros)Can't read Primos3Ty JohnsonYours Liga Norte · IRYours Oficina FC · taxiFree PrimosClaim Johnson in SleeperTaken in 2 leagues: Barrio, Dinastía (Los Toros)Who plays if Cook misses time, in order. Depth chart as of Sep 23; injury status is on the card above, not from this chart. | Depth 1 | Depth 2 | Depth 3",
        "InjuryTimelineChip — down from Active": "↓ from ActiveWorse than Active, last reported Sep 20. | Worse than Active, last reported Sep 20.",
        "InjuryTimelineChip — up from Injured Reserve, ESPN return": "↑ from Injured Reserve · ESPN est. return Oct 12Improved from Injured Reserve, last reported Sep 12. ESPN estimates a return on Oct 12. | Improved from Injured Reserve, last reported Sep 12. ESPN estimates a return on Oct 12.",
        "InjuryTimelineChip — up from Out, ESPN return": "↑ from Out · ESPN est. return Oct 5Improved from Out, last reported Sep 18. ESPN estimates a return on Oct 5. | Improved from Out, last reported Sep 18. ESPN estimates a return on Oct 5.",
        "LiveGameBadge — final, finalized": "FinalDAL 20 – 27 PHIWeek 3Liga Norte12.4starting · final",
        "LiveGameBadge — live, three leagues": "LivePHI 14 – 10 DALWeek 3Liga Norte12.4starting · updated 4 min agoOficina FC3.1on your bench · updated just nowDinastía7.0starting · updated 3 h ago",
        "LiveGameBadge — no league score, no score line": "Livevs DALWeek 3No league score on file for him this week — points refresh live for Sleeper leagues.",
        "PlayerNews — could not read": "NewsNews could not be read.",
        "PlayerNews — every age, every source": "NewsCook limited at practice with ankle injuryESPN · just nowBills backfield outlookNews · 12 min agoCook questionable for SundayRolling Insights · 4h agoCook returned to a full practiceSleeper · Sat, 9/19",
        "PlayerNews — nothing recent": "NewsNo recent item mentions this player.",
        "PlayerSeasonCard — PPR": "This season · 2026PPRPoints51.8Per game17.3Games3Best31.3 · wk 11234 scored projected · Met or beat his projection in 1 of 2 weeks · off by 9.5 a week on averageWkOppProjScored1ARI18.231.32NYJ17.011.13MIA16.5no stats4——9.4 | James Cook, week by week: week 1 scored 31.3, projected 18.2; week 2 scored 11.1, projected 17.0; week 3 scored nothing on file, projected 16.5; week 4 scored 9.4",
        "PlayerSeasonCard — league scoring, one compared week": "This season · 2026Liga Norte scoringPoints31.3Per game31.3Games1Best31.3 · wk 11 scored projected · Met or beat his projection in 1 of 1 week · off by 13.1 a week on averageWkOppProjScored1ARI18.231.3 | James Cook, week by week: week 1 scored 31.3, projected 18.2",
        "PlayerSeasonCard — unavailable": "This seasonNo weekly projections or stat lines on file for this player.",
        "WhoStartsHim — ranked, a filled hole, nobody, and every note": "Who'd start CookLiga Nortewould start for 4 of 5 teamsEquipo A at RB, over Rojas A2Equipo B at RB, over Rojas B2Another team at RB, over Rojas C2+1 moreOpen Trade CenterOficina FCwould start for 1 of 1 teamEquipo F at RB — a slot they can’t fillOpen Trade CenterDinastíano team would start him over what they haveLiga 0this league could not be read just nowLiga 1other teams’ rosters in this league use the platform’s own player ids, so we can’t read them yetLiga 2we couldn’t find your team in this leagueLiga 3no other teams are on fileLiga 4this league’s lineup is not on fileLiga 5he has no market value in this league’s formatLiga 6too few players on the other rosters have a market value to compareLiga 7lineup slot IDP_FLEX isn’t modelledLiga 8lineup slots DL, LB aren’t modelledRanked by how much he'd add to each team's best lineup, using market value in that league's format as the measure. It's who has room for him — not who will say yes.",
      }
    `)
  })
})
