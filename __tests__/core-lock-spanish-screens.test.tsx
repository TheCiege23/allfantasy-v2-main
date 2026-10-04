/**
 * Lineup locks and kickoffs in Spanish on the screens #2029 left English (2026-10-04): Player Finder
 * (LockClock, GameDayBanner, GameDayTriage, PlayerNextGames, LeagueCalls, SwapCandidates), the home's
 * schedule band and decision queue, and Chimmy's moves.
 *
 * Every lock label here is `lockState`'s REAL English output, translated by the SAME `coreUiCopy`
 * patterns Game Plan uses (adc631a91) — no second lock builder. Every kickoff is the formatters' REAL
 * output, fed every weekday and every month, so a change to a formatter's English breaks this suite
 * rather than silently falling back to English.
 *
 * And `lockState`'s English is pinned byte for byte: other readers (Game Plan, gameDayTriage's sort,
 * swapLegality, chimmyMoves) and coreUiCopy's patterns all key on it.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/players',
  useSearchParams: () => new URLSearchParams(),
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import { kickoffClock, lockState } from '@/lib/core-app/lineupLock'
import { kickoffText } from '@/lib/core-app/kickoffText'
import { kickoffDayLabel } from '@/lib/core-app/kickoffLabel'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { reportedLabel } from '@/lib/core-app/injuryReport'
import { leagueCall } from '@/lib/core-app/leagueCall'
import { composeChimmyMoves, composeMyTeamMoves } from '@/lib/core-app/chimmyMoves'
import { mergeDash34Issues } from '@/lib/core-app/mergeDash34Issues'
import { deriveOutstandingIssues } from '@/lib/core-app/outstandingIssues'
import { issueText } from '@/lib/core-app/decisionQueueCopy'
import { LockClock } from '@/components/core-app/player-finder/LockClock'
import { GameDayBanner } from '@/components/core-app/player-finder/GameDayBanner'
import { GameDayTriage } from '@/components/core-app/player-finder/GameDayTriage'
import { PlayerNextGames } from '@/components/core-app/player-finder/PlayerNextGames'
import { LeagueCalls } from '@/components/core-app/player-finder/LeagueCalls'
import { SwapCandidates } from '@/components/core-app/player-finder/SwapCandidates'
import { ChimmyMovesCard } from '@/components/core-app/ChimmyMovesCard'
import { DashScheduleBand } from '@/components/core-app/screens/DashScheduleBand'
import { DecisionQueue } from '@/components/core-app/home/DecisionQueue'
import type { GameDayTriage as Triage, TriageRow } from '@/lib/core-app/gameDayTriage'
import type { LeagueImpact, ReplacementOption } from '@/lib/core-app/playerImpact'
import type { WeekBoard } from '@/lib/core-app/weekBoard'
import type { Dash34Data, Dash34League } from '@/components/core-app/screens/Dashboard34'
import type { LineupPlayer } from '@/lib/core-app/myTeam'

const EN_DAY = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/
const EN_MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/
const ES_DAY = /\b(dom|lun|mar|mié|jue|vie|sáb)\b/

/** Sunday 2026-10-04, 8:00a ET. */
const NOW = '2026-10-04T12:00:00.000Z'
/** One FUTURE kickoff per weekday, more than a day out ("locks Mon 1:00p ET"): Mon 10/5 … Sun 10/11. */
const AHEAD = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 9, 5 + i, 17)).toISOString())
/** One PAST kickoff per weekday ("locked · kicked off Sun 1:00p ET"): Sun 9/27 … Sat 10/3. */
const PAST = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 8, 27 + i, 17)).toISOString())
const IN_30 = new Date(Date.parse(NOW) + 30 * 60_000).toISOString()
const IN_3H = new Date(Date.parse(NOW) + 190 * 60_000).toISOString()
const IN_90 = new Date(Date.parse(NOW) + 90 * 60_000).toISOString()

const text = (el: HTMLElement) => {
  // Visible text plus every title and aria-label — the reader hears those too.
  const attrs = [...el.querySelectorAll('[title],[aria-label]')].flatMap((n) => [n.getAttribute('title') ?? '', n.getAttribute('aria-label') ?? ''])
  return [el.textContent ?? '', ...attrs].join(' | ')
}

function expectSpanish(out: string, english: RegExp, label: string) {
  expect(out, label).not.toMatch(EN_DAY)
  expect(out, label).not.toMatch(EN_MONTH)
  expect(out, label).not.toMatch(english)
}

afterEach(() => {
  cleanup()
  lang.language = 'en'
})

describe('lockState — the English every reader keys on, pinned byte for byte', () => {
  it('every kind of label, unchanged', () => {
    expect(lockState(AHEAD[6]!, NOW)).toEqual({ state: 'open', minutes: 10_380, label: 'locks Sun 1:00p ET', clock: 'Sun 1:00p ET' })
    expect(lockState(IN_3H, NOW)).toEqual({ state: 'open', minutes: 190, label: 'locks in 3h 10m', clock: 'Sun 11:10a ET' })
    expect(lockState(IN_90, NOW)).toEqual({ state: 'soon', minutes: 90, label: 'locks in 1h 30m', clock: 'Sun 9:30a ET' })
    expect(lockState(IN_30, NOW)).toEqual({ state: 'soon', minutes: 30, label: 'locks in 30 min', clock: 'Sun 8:30a ET' })
    expect(lockState(PAST[0]!, NOW)).toEqual({ state: 'locked', minutes: -9_780, label: 'locked · kicked off Sun 1:00p ET', clock: 'Sun 1:00p ET' })
    expect(lockState('not a date', NOW)).toEqual({ state: 'open', minutes: 0, label: 'lock time unknown', clock: '' })
  })

  it('every kind reads Spanish through coreUiCopy — the one lock translator — on every weekday', () => {
    const labels = [
      ...AHEAD.map((k) => lockState(k, NOW).label),
      ...PAST.map((k) => lockState(k, NOW).label),
      lockState(IN_3H, NOW).label,
      lockState(IN_30, NOW).label,
      lockState('not a date', NOW).label,
    ]
    for (const english of labels) {
      const es = coreUiCopy(english, 'es')
      expect(es, english).not.toBe(english)
      expectSpanish(es, /\b(locks?|locked|kicked off|unknown)\b/, english)
    }
    expect(coreUiCopy('locks Sun 1:00p ET', 'es')).toBe('se bloquea dom 1:00p ET')
    expect(coreUiCopy('locked · kicked off Sat 1:00p ET', 'es')).toBe('bloqueado · empezó sáb 1:00p ET')
  })
})

describe('Player Finder — LockClock', () => {
  it('every weekday, open and locked, chip and banner sizes', () => {
    lang.language = 'es'
    for (const k of [...AHEAD, ...PAST, IN_30, IN_3H]) {
      for (const big of [false, true]) {
        const { container, unmount } = render(<LockClock kickoffIso={k} nowIso={NOW} big={big} />)
        const out = text(container)
        expectSpanish(out, /\b(locks?|locked|kicked off|Lineup)\b/, `${k} big=${big}`)
        expect(out, k).toMatch(/se bloquea|bloqueado|Bloqueado/)
        if (!k.startsWith('2026-10-04')) expect(out, k).toContain(kickoffText(kickoffClock(k), 'es'))
        unmount()
      }
    }
  })

  it('English is unchanged', () => {
    const { container } = render(<LockClock kickoffIso={PAST[0]!} nowIso={NOW} />)
    expect(container.textContent).toBe('locked')
    expect(container.querySelector('[title]')?.getAttribute('title')).toBe('Locked · kicked off Sun 1:00p ET')
  })
})

describe('Player Finder — GameDayBanner', () => {
  const base = { playerName: 'Dalton Kincaid', detail: null, nowIso: NOW, starting: [], benched: 0, elsewhere: 0 }
  it('his game on every weekday, ahead and kicked off, with the feed report time and the inactive line', () => {
    lang.language = 'es'
    for (const k of [...AHEAD, ...PAST]) {
      const reportedAt = new Date(Date.parse(k) - 26 * 3_600_000).toISOString()
      const { container, unmount } = render(
        <GameDayBanner
          {...base}
          status={{ label: 'Questionable', tone: 'warn' }}
          reportedAt={reportedAt}
          inactive={{ announcedAt: k, minutesBeforeKickoff: 88, clock: '11:32a ET' }}
          game={{ kickoff: k, opponent: 'MIA', home: true, week: 5, season: 2026, preseason: false }}
          starting={[{ leagueId: 'L1', leagueName: 'KBFL', platform: 'sleeper', link: null }]}
        />,
      )
      const out = text(container)
      expectSpanish(out, /\b(locks?|locked|kicked off|Questionable|reported|Declared|Starting in|league|Game day)\b/, k)
      expect(out, k).toContain(kickoffText(kickoffClock(k), 'es'))
      expect(out, k).toContain(coreUiCopy(reportedLabel(reportedAt, NOW)!, 'es'))
      unmount()
    }
  })

  it('the bye chip', () => {
    lang.language = 'es'
    const { container } = render(
      <GameDayBanner {...base} status={null} game={null} bye={{ label: 'Bye · wk 9', tone: 'bad', kind: 'bye' }} benched={2} />,
    )
    expect(container.textContent).toContain('Descanso · sem. 9')
    expectSpanish(text(container), /\b(Bye|bench|league)\b/, 'bye')
  })
})

describe('Player Finder — GameDayTriage', () => {
  const row = (kickoff: string | null, over: Partial<TriageRow> = {}): TriageRow => ({
    player: { sport: 'NFL', externalId: kickoff ?? 'x', sleeperId: kickoff ?? 'x', name: 'Dalton Kincaid', position: 'TE', team: 'BUF', imageUrl: null },
    status: { label: 'Out', tone: 'bad' },
    description: null,
    reportedAt: kickoff ? new Date(Date.parse(kickoff) - 30 * 3_600_000).toISOString() : null,
    leagues: [{ leagueId: 'L1', leagueName: 'KBFL', platform: 'sleeper', platformLeagueId: '123' }],
    kickoff,
    noGame: false,
    inactive: null,
    bye: false,
    ...over,
  })
  it('every weekday, ahead and kicked off, plus a bye row', () => {
    lang.language = 'es'
    const rows = [...AHEAD, ...PAST].map((k) => row(k))
    rows.push(row(null, { noGame: true, bye: true, status: null }))
    const data: Triage = { rows, week: { season: 2026, week: 5 }, leaguesRead: 3, startersRead: 30, rostersAsOf: NOW }
    const { container } = render(<GameDayTriage state={{ available: true, data }} nowIso={NOW} leagueCount={3} />)
    const out = text(container)
    expectSpanish(out, /\b(locks?|locked|kicked off|reported|Game day|starting in|lineups? read|Bye|Flagged means|bench him)\b/, 'triage')
    for (const k of AHEAD) expect(out, k).toContain(coreUiCopy(lockState(k, NOW).label, 'es'))
    expect(out).toContain('Descanso · sem. 5')
  })
})

describe('Player Finder — PlayerNextGames', () => {
  it('the next kickoff on every weekday', () => {
    lang.language = 'es'
    for (const k of AHEAD) {
      const { container, unmount } = render(
        <PlayerNextGames
          next={{ available: true, data: { opponent: 'MIA', home: false, kickoff: k, market: { impliedTeamTotal: 24.5, spread: -3, gameTotal: 47.5, winProbability: 0.6, isStale: true } } }}
          upcoming={{ available: true, data: { season: 2026, weeks: [{ week: 6, bye: true }, { week: 7, bye: false, home: true, opponent: 'NYJ' }] as never } }}
        />,
      )
      const out = text(container)
      expectSpanish(out, /\b(Next game|implied|favored|to win|game total|out of date|Upcoming|BYE|Wk)\b/, k)
      expect(out, k).toContain(kickoffText(kickoffClock(k), 'es'))
      unmount()
    }
  })
})

describe('Player Finder — LeagueCalls (leagueCall.ts templates, every kind)', () => {
  const KICKOFFS = { BUF: AHEAD[6]!, MIA: AHEAD[6]!, DAL: PAST[4]! }
  const HIM = { sleeperId: '10236', name: 'Dalton Kincaid', team: 'BUF' }
  const opt = (o: Partial<ReplacementOption>): ReplacementOption =>
    ({ playerId: 'x', name: 'Tucker Kraft', position: 'TE', team: 'MIA', afPoints: 9, delta: 1, injuryStatus: null, from: 'BENCH', ...o }) as ReplacementOption
  const impact = (o: Partial<LeagueImpact>): LeagueImpact =>
    ({ leagueId: 'L1', leagueName: 'KBFL', platform: 'sleeper', isStarting: true, replacements: { available: true, data: [] }, startOver: null, ...o }) as unknown as LeagueImpact
  const so = { playerId: 's', name: 'Sam LaPorta', position: 'TE', team: 'MIA', slot: 'TE', afPoints: 7, delta: 3.1 }
  const call = (im: Partial<LeagueImpact>, tone: 'bad' | 'warn' | null, player = HIM) =>
    leagueCall({ impact: impact(im), player, readinessTone: tone, kickoffs: KICKOFFS, nowIso: NOW })

  it('locked, sit, start-instead, keep-with-backup, keep-no-backup, start-over, partner-locked, bench-is-right', () => {
    const calls = [
      call({}, 'bad', { ...HIM, team: 'DAL' }),
      call({ replacements: { available: true, data: [opt({ afPoints: 8.2 })] } }, 'bad'),
      call({ replacements: { available: true, data: [opt({})] } }, 'bad'),
      call({}, 'bad'),
      call({ replacements: { available: true, data: [opt({ delta: 2.4 })] } }, 'warn'),
      call({ replacements: { available: true, data: [opt({ delta: -1 })] } }, 'warn'),
      call({}, 'warn'),
      call({}, null),
      call({ isStarting: false, startOver: so }, null),
      call({ isStarting: false, startOver: { ...so, team: 'DAL' } }, null),
      call({ isStarting: false, startOver: { ...so, delta: -0.5 } }, null),
      call({ isStarting: false, startOver: null }, 'bad'),
    ].map((c, i) => ({ ...c, leagueId: `L${i}` }))
    lang.language = 'es'
    const { container } = render(<LeagueCalls calls={calls} playerName={HIM.name} />)
    const out = text(container)
    for (const c of calls) {
      expect(coreUiCopy(c.headline, 'es'), c.headline).not.toBe(c.headline)
      expect(coreUiCopy(c.why, 'es'), c.why).not.toBe(c.why)
    }
    expectSpanish(
      out,
      /\b(Sit him|Keep him|Start|Locked|Bench is right|He is|projects|kicked off|Inactives|Your call|Ask Chimmy|Fix lineup|nothing can move)\b/,
      'calls',
    )
    expect(out).toContain(`empezó ${kickoffText(kickoffClock(PAST[4]!), 'es')}`)
  })
})

describe('Player Finder — SwapCandidates', () => {
  it('a locked candidate on every weekday', () => {
    lang.language = 'es'
    for (const k of PAST) {
      const im = {
        leagueId: 'L1', leagueName: 'KBFL', platform: 'sleeper', isStarting: true, startOver: null,
        replacements: { available: true, data: [{ playerId: 'x', name: 'Tucker Kraft', position: 'TE', team: 'GB', afPoints: 9, delta: 1, injuryStatus: 'Questionable', from: 'BENCH' }] },
      } as unknown as LeagueImpact
      const { container, unmount } = render(<SwapCandidates impact={[im]} kickoffs={{ GB: k }} nowIso={NOW} />)
      const out = text(container)
      expectSpanish(out, /\b(locked|kicked off|Swap candidates|BENCH|Questionable|Points are)\b/, k)
      expect(out, k).toContain(`bloqueado · empezó ${kickoffText(kickoffClock(k), 'es')}`)
      unmount()
    }
  })
})

describe("Chimmy's moves — chimmyMoves.ts parts, rebuilt at render", () => {
  const row = (kickoff: string | null, over: Partial<TriageRow>): TriageRow => ({
    player: { sport: 'NFL', externalId: over.player?.sleeperId ?? 'p', sleeperId: 'p', name: 'Dalton Kincaid', position: 'TE', team: 'BUF', imageUrl: null },
    status: { label: 'Out', tone: 'bad' },
    description: null, reportedAt: null, inactive: null, noGame: false, bye: false,
    leagues: [{ leagueId: 'L1', leagueName: 'KBFL', platform: 'sleeper' }],
    kickoff,
    ...over,
  })

  it('every weekday, every reason — and the English fields are unchanged', () => {
    for (const k of AHEAD) {
      const triage: Triage = {
        rows: [
          row(k, { player: { sport: 'NFL', externalId: 'a', sleeperId: 'a', name: 'Alpha Guy', position: 'WR', team: 'BUF', imageUrl: null } }),
          row(k, { player: { sport: 'NFL', externalId: 'b', sleeperId: 'b', name: 'Beta Guy', position: 'RB', team: 'MIA', imageUrl: null }, status: { label: 'Questionable', tone: 'warn' } }),
          row(k, { player: { sport: 'NFL', externalId: 'c', sleeperId: 'c', name: 'Gamma Guy', position: 'TE', team: 'KC', imageUrl: null }, status: null, noGame: true, bye: true }),
        ],
        week: null, leaguesRead: 1, startersRead: 9,
      }
      const data = composeChimmyMoves({ triage, leagueId: 'L1', leagueName: 'KBFL', nowIso: NOW })
      expect(data.moves[0]!.title).toBe('Bench Alpha Guy')
      expect(data.moves[0]!.detail).toBe(`Out — WR · BUF — ${lockState(k, NOW).label}`)
      lang.language = 'es'
      const { container, unmount } = render(<ChimmyMovesCard data={data} leagueName="KBFL" />)
      const out = text(container)
      expectSpanish(out, /\b(Bench|Check|Out|Questionable|locks?|Fix lineup|Review|Ask Chimmy|moves|on bye)\b/, k)
      expect(out, k).toContain(`Fuera — WR · BUF — ${coreUiCopy(lockState(k, NOW).label, 'es')}`)
      unmount()
      lang.language = 'en'
    }
  })

  it('the empty-slot move and the empty state', () => {
    const data = composeMyTeamMoves({ leagueId: 'L1', leagueName: 'KBFL', starters: [] as LineupPlayer[], nowIso: NOW, emptySlots: [{ index: 3, slotLabel: 'FLEX' }] })
    lang.language = 'es'
    const a = render(<ChimmyMovesCard data={data} leagueName="KBFL" />)
    expect(a.container.textContent).toContain('Completa tu puesto libre de FLEX')
    expectSpanish(text(a.container), /\b(Fill|Empty|scores zero|Fix lineup)\b/, 'empty slot')
    a.unmount()
    const b = render(<ChimmyMovesCard data={{ ...data, moves: [] }} leagueName="KBFL" />)
    expectSpanish(text(b.container), /\b(No remaining|Start\/sit|Chimmy can)\b/, 'empty state')
  })
})

describe('Home — DashScheduleBand (server band, client words)', () => {
  /** One FUTURE kickoff per month — 17:00Z on the 15th, so the Eastern day is the UTC one. */
  const MONTHS = Array.from({ length: 12 }, (_, mo) => new Date(Date.UTC(2099, mo, 15, 17)).toISOString())
  const board = (firstKickoffAt: string) =>
    ({
      season: 2099, week: 3, coinFlips: [], leaning: [], eliminationWeeks: [], model: { basis: '', sampleSize: 0 }, withoutSchedule: 4, firstKickoffAt,
      unprojected: Array.from({ length: 8 }, (_, i) => ({
        leagueId: `l${i}`, leagueName: `League ${i}`, platform: 'sleeper', season: 2099, week: 3,
        opponent: { rosterId: 7, name: i === 0 ? null : 'DynastyDan' }, elimination: i === 1, projection: null, yourSampleWeeks: 0, href: `/core/matchup?league=l${i}`,
      })),
    }) as unknown as WeekBoard

  it('every month', () => {
    lang.language = 'es'
    for (const iso of MONTHS) {
      const { container, unmount } = render(<DashScheduleBand board={board(iso)} syncLabel="4m ago" />)
      const out = text(container)
      expectSpanish(out, /\b(Week|who you play|matchups|next kickoff|more|no schedule|Open your week|ago|Team 7)\b/, iso)
      expect(out, iso).toContain(`próximo inicio ${kickoffText(kickoffDayLabel(iso)!, 'es')}`)
      expect(out, iso).toContain('Semana 3 · contra quién juegas')
      expect(out, iso).toContain('hace 4 min')
      expect(out, iso).toContain('Equipo 7')
      unmount()
    }
  })

  it('English is unchanged', () => {
    const { container } = render(<DashScheduleBand board={board(MONTHS[9]!)} syncLabel="4m ago" />)
    expect(container.textContent).toContain('Week 3 · who you play')
    expect(container.textContent).toContain('8 matchups · next kickoff Oct 15')
    expect(container.textContent).toContain('+2 more · no schedule yet for your other 4 leagues · 4m ago')
  })
})

describe('Home — DecisionQueue (mergeDash34Issues parts, rebuilt at render)', () => {
  const league = (over: Partial<Dash34League> & { id: string }): Dash34League =>
    ({ name: `League ${over.id}`, platform: 'sleeper', href: `/core?league=${over.id}`, ...over }) as Dash34League
  const data = (leagues: Dash34League[]) => ({ leagues, allLeagues: leagues, totalLeagues: leagues.length }) as unknown as Dash34Data

  it('a starter-out row kicking off on every weekday, plus empty slot, best ball and a live draft', () => {
    const leagues = [
      ...AHEAD.map((k, i) =>
        league({
          id: `s${i}`, priority: 'urgent', hurtStarters: i % 2 ? 2 : 1, hurtStarterKickoffAt: k,
          flaggedStarters: [
            { playerId: 'p1', name: 'Caleb Williams', status: i % 3 ? 'Out' : 'Doubtful', slot: 'QB', index: 0 },
            { playerId: 'p2', name: 'Other', status: 'Out', slot: 'RB', index: 1 },
          ].slice(0, i % 2 ? 2 : 1),
          lineupVerification: { checkedAt: NOW, week: 5, source: 'Sleeper', slots: [] },
        }),
      ),
      league({ id: 'e', priority: 'urgent', emptyStarters: 2 }),
      league({ id: 'b', needsWaivers: true, bestBallMissing: ['TE'] }),
      league({ id: 'd', priority: 'draft' }),
    ]
    const issues = mergeDash34Issues([], data(leagues))
    expect(issues.find((i) => i.id === 's0:starter-out')!.meta).toContain(`kicks off ${kickoffClock(AHEAD[0]!)}`)
    lang.language = 'es'
    // Every row in the TOP five and the rest, so open the rest too.
    const { container } = render(<DecisionQueue issues={issues} scopeLabel="All leagues" scopeKey="all" nowIso={NOW} />)
    const out = text(container)
    expectSpanish(
      out,
      /\b(kicks off|starters? who cannot play|Listed|Review|Lineup|Week|Checked|Fill the slot|empty starting|Draft is live|on the clock|Best Ball roster|Top decisions|OPEN|Most urgent|Show \d+ more|IN \d|Across your leagues)\b/,
      'queue',
    )
    for (const k of AHEAD.slice(0, 2)) expect(out, k).toContain(`empieza ${kickoffText(kickoffClock(k), 'es')}`)
  })
})

describe('Home — DecisionQueue, deriveOutstandingIssues rows', () => {
  it('an upcoming draft in every month, and a stale league', () => {
    const now = new Date('2098-12-01T12:00:00Z')
    const leagues = Array.from({ length: 12 }, (_, mo) => ({
      id: `d${mo}`, name: `Draft ${mo}`, platform: 'sleeper', platformLeagueId: `${100 + mo}`, season: 2099,
      draftDate: new Date(Date.UTC(2099, mo, 15, 23)).toISOString(),
    }))
    const { issues } = deriveOutstandingIssues({ leagues: leagues as never, now, lastSyncByLeague: Object.fromEntries(leagues.map((l) => [l.id, new Date('2098-11-01T00:00:00Z')])) })
    expect(issues.filter((i) => i.id.endsWith(':draft'))).toHaveLength(12)
    lang.language = 'es'
    for (const issue of issues) {
      const es = issueText(issue, 'es')
      expect(es.title, issue.title).not.toBe(issue.title)
      expectSpanish(`${es.title} | ${es.meta} | ${es.actionLabel}`, /\b(Draft (today|coming up)|stale|last read|never read|Open in|leagues have)\b/, issue.title)
    }
    const { container } = render(<DecisionQueue issues={issues} scopeLabel="NFL leagues" scopeKey="nfl" nowIso={now.toISOString()} />)
    expectSpanish(text(container), /\b(Draft (today|coming up)|Open in|Most urgent|Show \d+ more)\b/, 'queue')
    expect(container.textContent).toContain('Ligas de NFL')
  })
})
