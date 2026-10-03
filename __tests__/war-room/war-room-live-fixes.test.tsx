/**
 * Fixes from the War Room's live check (step 5, 2026-10-03) — each one seen on the production page with
 * a real account, none caught by the tests written before it.
 *
 *   1. Scout's Competitive Edge never loaded: the page resolved the paywall for five screens, not this one.
 *   2. "Week 5 across your leagues" under Game Plan's "Week 4": the strip took the first row's week.
 *   3. A league on another week was ranked by the WRONG week's projections.
 *   4. "Lineups as of 101d ago": a finished league's roster dated a list it was not even in.
 *   5. "Outside the playoffs · on the playoff line": games-back wording that read as a contradiction.
 */

import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockTeamFindMany = vi.hoisted(() => vi.fn())
const mockLeagueFindMany = vi.hoisted(() => vi.fn())
const mockRosterFindMany = vi.hoisted(() => vi.fn())
const mockSportsPlayerFindMany = vi.hoisted(() => vi.fn())
const mockInjuryFindMany = vi.hoisted(() => vi.fn())
const mockGameFindMany = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: mockTeamFindMany },
    league: { findMany: mockLeagueFindMany },
    roster: { findMany: mockRosterFindMany },
    sportsPlayer: { findMany: mockSportsPlayerFindMany },
    sportsInjury: { findMany: mockInjuryFindMany },
    sportsGame: { findMany: mockGameFindMany },
    playerIdentityMap: { findMany: vi.fn(async () => []) },
    guillotineRosterState: { findMany: vi.fn(async () => []) },
    guillotineElimination: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/core-app/sportsWeek', () => ({
  resolveSportsWeek: vi.fn(async () => ({ season: 2026, week: 4, seasonType: 'regular' })),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown } & Record<string, unknown>) => {
    const { prefetch: _p, ...attrs } = rest as Record<string, unknown>
    return <a href={href} {...(attrs as Record<string, string>)}>{children as never}</a>
  },
}))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: 'en' }) }))

import { loadGameDayTriage } from '@/lib/core-app/gameDayTriageLoader'
import { GamePlan } from '@/components/core-app/screens/GamePlan'
import { WarRoomWeek } from '@/components/core-app/screens/WarRoomWeek'
import { Scout } from '@/components/core-app/screens/Scout'
import type { RailMatchup } from '@/lib/core-app/railMatchups'

const NOW = '2026-10-02T17:00:00.000Z'

describe('1 · the page resolves the paywall for the War Room', () => {
  it('includes war-room in the corePaywall read, which Scout’s Competitive Edge depends on', () => {
    const page = readFileSync('app/core/(shell)/[[...screen]]/page.tsx', 'utf8')
    const block = page.slice(page.indexOf('const corePaywallRead ='), page.indexOf('resolveCorePaywall(userId'))
    expect(block).toContain("activeKey === 'war-room'")
  })
})

/* ── 2 + 3 · the week strip ─────────────────────────────────────────────── */

const proj = (afEngine: number) => ({ projected: null, afProjected: null, afEngine, afEngineFrom: 9, pricedFrom: 9, starterCount: 9 }) as unknown as RailMatchup['yourProjection']
const m = (leagueId: string, week: number, over: Partial<RailMatchup> = {}): RailMatchup => ({
  leagueId, yourTeam: 'Me', yourAvatarUrl: null, yourScore: 0, yourProjection: null, opponentTeam: 'Them', opponentAvatarUrl: null,
  opponentScore: 0, opponentProjection: null, unpaired: false, standing: null, scored: false, freshAt: null, source: 'live_cache', season: 2026, week, ...over,
})
const strip = (byLeague: Record<string, RailMatchup>, names: string[]) =>
  renderToStaticMarkup(<WarRoomWeek lineups={{ byLeague, projectionWeek: { season: '2026', week: 4 } }} leagues={names.map((id) => ({ id, name: `League ${id}` }))} boardHref="/core/matchup" />)

describe('2 · the strip names the week most leagues are on', () => {
  const byLeague = {
    A: m('A', 4, { scored: true, yourScore: 50, opponentScore: 60 }),
    B: m('B', 4, { scored: true, yourScore: 70, opponentScore: 60 }),
    C: m('C', 5, { yourProjection: proj(90), opponentProjection: proj(140) }),
  }
  it('says Week 4, not the first row’s week', () => {
    expect(strip(byLeague, ['C', 'A', 'B'])).toContain('Week 4 across your leagues')
  })
  it('tags the league on another week, and counts it in the header', () => {
    const html = strip(byLeague, ['C', 'A', 'B'])
    expect(html).toContain('League C<span class="af-wrw-weektag af-num"> · week 5</span>')
    expect(html).toContain('1 on another week')
  })
})

describe('3 · a league is never ranked by another week’s projections', () => {
  it('a week-5 league with week-4 projections gets no margin, and sorts after the scored rows', () => {
    const html = strip(
      {
        A: m('A', 4, { scored: true, yourScore: 50, opponentScore: 60 }),
        C: m('C', 5, { yourProjection: proj(90), opponentProjection: proj(140) }), // -50, but for the wrong week
      },
      ['A', 'C'],
    )
    const order = [...html.matchAll(/class="af-wrw-league">League (\w)/g)].map((x) => x[1])
    expect(order).toEqual(['A', 'C'])
  })
})

/* ── 4 · the lineup stamp ───────────────────────────────────────────────── */

function wire(leagues: Array<{ id: string; status: string; updatedAt: string; starters?: string[] }>) {
  mockTeamFindMany.mockImplementation(async () => leagues.map((l) => ({ id: `t-${l.id}`, leagueId: l.id, platformUserId: `pu-${l.id}`, externalId: '1' })))
  mockLeagueFindMany.mockImplementation(async () =>
    leagues.map((l) => ({ id: l.id, name: `League ${l.id}`, platform: 'sleeper', platformLeagueId: `p-${l.id}`, season: 2026, status: l.status, lifecycleState: null, bestBallMode: false, leagueVariant: null, guillotineMode: false, leagueType: 'redraft', settings: {}, sport: 'NFL' })),
  )
  mockRosterFindMany.mockImplementation(async () =>
    leagues.map((l) => ({ id: `r-${l.id}`, leagueId: l.id, platformUserId: `pu-${l.id}`, playerData: { starters: l.starters ?? ['1'], players: l.starters ?? ['1'] }, updatedAt: new Date(l.updatedAt) })),
  )
  mockSportsPlayerFindMany.mockResolvedValue([])
  mockInjuryFindMany.mockResolvedValue([])
  mockGameFindMany.mockResolvedValue([])
}

describe('4 · "Lineups as of" describes the lineups read', () => {
  beforeEach(() => vi.clearAllMocks())

  it('a completed league’s old roster does not date the list', async () => {
    wire([
      { id: 'OLD', status: 'complete', updatedAt: '2026-06-23T12:00:00.000Z' },
      { id: 'NOW', status: 'in_season', updatedAt: '2026-10-02T16:15:00.000Z' },
    ])
    const out = await loadGameDayTriage('me', ['OLD', 'NOW'], NOW)
    if (!out.available) throw new Error(out.reason)
    expect(out.data.rostersAsOf).toBe('2026-10-02T16:15:00.000Z')
    expect(out.data.rosterAges?.map((a) => a.leagueId)).toEqual(['NOW'])
  })

  it('a league READ but long unsynced is named, and the stamp describes the rest', () => {
    const html = renderToStaticMarkup(
      <GamePlan
        data={{
          rows: [], week: { season: 2026, week: 4 }, leaguesRead: 2, startersRead: 18,
          rostersAsOf: '2026-06-23T12:00:00.000Z',
          rosterAges: [
            { leagueId: 'S', leagueName: 'Stale League', asOf: '2026-06-23T12:00:00.000Z' },
            { leagueId: 'F', leagueName: 'Fresh League', asOf: '2026-10-02T16:15:00.000Z' },
          ],
        }}
        nowIso={NOW}
        weekHref="/w"
        waiversHref="/wv"
        showHead={false}
      />,
    )
    expect(html).toContain('Lineups as of 12:15p ET · 45 min ago')
    expect(html).toContain('Not synced in over 3 days')
    expect(html).toContain('href="/core/sync?league=S"')
    expect(html).toContain('(101d ago)')
    expect(html).not.toContain('Fresh League</a>')
  })
})

/* ── 5 · games back ─────────────────────────────────────────────────────── */

describe('5 · games-back says what the number is', () => {
  const card = (gamesBack: number, zone: 'out' | 'playoff') =>
    renderToStaticMarkup(
      <Scout
        data={{
          league: { id: 'lg', name: 'L', sport: 'NFL' }, you: null, week: null, opponent: null,
          basis: { available: false, reason: 'x' },
          format: { kind: 'redraft', elimination: false, bestBall: false, dynasty: false, picks: null },
          managers: { available: true, data: [{ managerId: '2', teamName: 'T', ownerName: 'O', avatarUrl: null, isYou: false, isNextOpponent: false, eliminated: null, picks: null,
            standing: { seed: 9, record: { wins: 1, losses: 2, ties: 0 }, pointsFor: 300, pointsAgainst: 300, form: [], zone, gamesBack, powerRank: 9 } }] },
        } as never}
        gamePlanHref="/p" matchupHref="/m" tradesHref="/t"
      />,
    )
  it('tied on record, whichever side of the tiebreak', () => {
    const html = card(0, 'out')
    expect(html).toContain('tied on record with the last playoff spot')
    expect(html).not.toContain('on the playoff line')
  })
  it('behind and ahead, in games', () => {
    expect(card(1, 'out')).toContain('1 game back of a playoff spot')
    expect(card(-2, 'playoff')).toContain('2 games clear of the cut')
  })
})
