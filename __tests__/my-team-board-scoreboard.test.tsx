import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

import type { RailMatchup } from '@/lib/core-app/railMatchups'
import type { WeekLineups } from '@/lib/core-app/weekLineups'
import { rowScoreOf, summariseWeekScores } from '@/lib/core-app/myTeamScoreboard'

const NOW = Date.parse('2026-10-04T19:00:00Z')
const db = vi.hoisted(() => ({
  guillotineElimination: { findMany: vi.fn(async () => []) },
  leagueTeam: { findMany: vi.fn(async () => [0, 1, 2, 3].map((i) => ({ leagueId: `L${i}`, externalId: '4', platformUserId: 'su', teamName: 'Mine', league: { id: `L${i}`, name: `League ${i}`, sport: 'NFL', platform: 'sleeper', platformLeagueId: `${1000 + i}`, userId: 'user', season: 2026, updatedAt: new Date() } }))) },
  roster: { findMany: vi.fn(async () => [0, 1, 2, 3].map((i) => ({ leagueId: `L${i}`, platformUserId: 'su', playerData: { players: ['healthy'], starters: ['healthy'] } }))) },
  sportsPlayer: { findMany: vi.fn(async () => [{ sleeperId: 'healthy', name: 'Healthy Player', team: 'ATL' }]) },
  sportsInjury: { findMany: vi.fn(async () => []) },
  sportsGame: { findMany: vi.fn(async () => [{ homeTeam: 'ATL', awayTeam: 'GB', startTime: new Date('2026-10-05T00:20:00Z') }]) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/core-app/sportsWeek', () => ({ resolveSportsWeek: vi.fn(async () => ({ season: 2026, week: 5, seasonType: 'regular' })) }))
vi.mock('@/lib/core-app/byeWeeks', () => ({ getByeWeeks: vi.fn(async () => ({ byWeek: new Map([[5, []]]) })) }))
vi.mock('@/lib/core-app/leagueHome', () => ({ leagueDisplayName: (name: string) => name }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))

import { getMyTeamPulse } from '@/lib/core-app/myTeamPulse'
import { MyTeamBoard } from '@/components/core-app/MyTeamBoard'

function m(leagueId: string, over: Partial<RailMatchup> = {}): RailMatchup {
  return {
    leagueId, yourTeam: 'Mine', yourAvatarUrl: null, yourScore: 0, yourProjection: null,
    opponentTeam: 'Them', opponentAvatarUrl: null, opponentScore: 0, opponentProjection: null,
    unpaired: false, standing: null, scored: true, freshAt: null, source: 'live_cache', season: 2026, week: 5,
    ...over,
  }
}
const cut = (overCut: number | null, basis: 'points' | 'projected' = 'points') =>
  ({ rank: overCut == null ? 12 : 4, outOf: 12, overCut, basis, placesAboveCut: 8, cutLine: 61.2, elimination: true })
const lineups = (...ms: RailMatchup[]): WeekLineups => ({ byLeague: Object.fromEntries(ms.map((x) => [x.leagueId, x])), projectionWeek: null })

beforeEach(() => vi.clearAllMocks())

describe('rowScoreOf', () => {
  it('reads a head-to-head as ahead / behind / level', () => {
    expect(rowScoreOf(m('a', { yourScore: 88.4, opponentScore: 71.2 }))).toEqual({ kind: 'h2h', you: 88.4, them: 71.2, lead: 'ahead' })
    expect(rowScoreOf(m('a', { yourScore: 60, opponentScore: 71.2 }))?.lead).toBe('behind')
    expect(rowScoreOf(m('a', { yourScore: 70.02, opponentScore: 70 }))?.lead).toBe('level')
  })

  it('draws nothing for last week’s fallback row or a fixture with no points', () => {
    expect(rowScoreOf(m('a', { yourScore: 99, source: 'history_fallback' }))).toBeNull()
    expect(rowScoreOf(m('a', { scored: false }))).toBeNull()
  })

  it('reads an elimination week as the distance to the cut, and only once real points rank it', () => {
    expect(rowScoreOf(m('a', { unpaired: true, standing: cut(12.3) }))).toEqual({ kind: 'cut', overCut: 12.3, rank: 4, outOf: 12 })
    expect(rowScoreOf(m('a', { unpaired: true, standing: cut(null) }))).toMatchObject({ kind: 'cut', overCut: null })
    expect(rowScoreOf(m('a', { unpaired: true, standing: cut(12.3, 'projected') }))).toBeNull()
    expect(rowScoreOf(m('a', { unpaired: true, standing: { ...cut(12.3), elimination: false } }))).toBeNull()
  })
})

describe('summariseWeekScores', () => {
  it('counts only the board’s leagues and only this week’s live rows', () => {
    const s = summariseWeekScores(
      lineups(
        m('a', { yourScore: 90, opponentScore: 80 }),
        m('b', { yourScore: 70, opponentScore: 80 }),
        m('c', { scored: false }),
        m('d', { unpaired: true, standing: cut(null) }),
        m('e', { yourScore: 99, opponentScore: 1, source: 'history_fallback' }),
        m('paused', { yourScore: 99, opponentScore: 1 }),
      ),
      ['a', 'b', 'c', 'd', 'e'],
    )
    expect(s).toEqual({ ahead: 1, behind: 1, level: 0, aboveCut: 0, onCut: 1, noPointsYet: 1 })
  })

  it('is null before anyone has scored — "0–0" is not a record', () => {
    expect(summariseWeekScores(lineups(m('a', { scored: false })), ['a'])).toBeNull()
    expect(summariseWeekScores(null, ['a'])).toBeNull()
  })
})

describe('the board', () => {
  it('stamps each row with its score and states the weekend record above the rows', async () => {
    const pulse = await getMyTeamPulse('user', new Date(NOW))
    const { container } = render(
      <MyTeamBoard
        pulse={pulse}
        now={NOW}
        allHref="/core/my-team?all=1"
        lineups={lineups(
          m('L0', { yourScore: 88.4, opponentScore: 71.2 }),
          m('L1', { yourScore: 60, opponentScore: 71.25 }),
          m('L2', { unpaired: true, standing: cut(12.3) }),
          m('L3', { scored: false }),
        )}
      />,
    )
    const scores = [...container.querySelectorAll('.af-bd-score')].map((s) => [s.textContent?.trim(), s.getAttribute('data-lead')])
    expect(scores).toEqual(expect.arrayContaining([
      ['· ahead 88.4–71.2', 'ahead'],
      ['· behind 60.0–71.3', 'behind'],
      ['· 12.3 over the cut (4 of 12)', 'ahead'],
    ]))
    expect(scores).toHaveLength(3)
    const record = container.querySelector('.af-bd-note--record')!
    expect(record.textContent).toBe('This week so far: ahead in 1, behind in 1 · above the cut in 1 · no points yet in 1.')
    // Above the rows.
    expect(record.compareDocumentPosition(container.querySelector('.af-bd-rows')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('draws no scores and no record without the rail', async () => {
    const pulse = await getMyTeamPulse('user', new Date(NOW))
    const { container } = render(<MyTeamBoard pulse={pulse} now={NOW} allHref="/core/my-team?all=1" />)
    expect(container.querySelector('.af-bd-score')).toBeNull()
    expect(container.querySelector('.af-bd-note--record')).toBeNull()
  })
})
