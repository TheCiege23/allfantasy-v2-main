import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Core audit's league-format scenarios, end to end: the real home loader (`getDash34Data`)
 * into the real queue builder (`mergeDash34Issues`), asserting the TEXT and the DESTINATION of what
 * reaches "Top decisions" — not only whether something is suppressed.
 *
 * The original report (handoff, 2026-09-27) was false urgent roster alerts for an eliminated
 * Guillotine team, Best Ball players a bench player already covers, and a league that had not
 * drafted. Two of these have live examples on the audited account (Dynasty BestBall League!: Dart on
 * IR at QB with a healthy QB benched; seven native leagues in setup) and read "Nothing is waiting on
 * you" in production on 2026-09-28. The other two had no live example that day, so they are pinned
 * here. A plain redraft league is the CONTROL: it must still alert, or every "no alert" below
 * would pass on a loader that alerts on nothing.
 */
const live = vi.hoisted(() => vi.fn())
const data = vi.hoisted(() => ({ formats: [] as Array<Record<string, unknown>> }))

vi.mock('@/lib/core-app/currentSleeperRoster', () => ({ currentSleeperRoster: live }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
vi.mock('@/lib/injuries/injurySyncState', () => ({ readInjurySyncFreshness: async () => null }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findMany: async () => data.formats },
  guillotineRosterState: { findMany: async () => [] },
  guillotineElimination: { findMany: async () => [] },
  leagueTeam: { findMany: async () => ['rd', 'gl', 'bb1', 'bb2', 'pd'].map((id) => ({ leagueId: id, platformUserId: 'owner', externalId: '1', teamName: `Team ${id}` })) },
  roster: { findMany: async () => [] },
  sportsGame: { findMany: async () => [] },
  sportsPlayer: { findMany: async () => [
    { sleeperId: 'qbOut', name: 'Out Quarterback', position: 'QB', team: 'NYG', sport: 'NFL', imageUrl: null },
    { sleeperId: 'qbOk', name: 'Healthy Quarterback', position: 'QB', team: 'BUF', sport: 'NFL', imageUrl: null },
    { sleeperId: 'wrOk', name: 'Healthy Receiver', position: 'WR', team: 'DAL', sport: 'NFL', imageUrl: null },
  ] },
  sportsInjury: { findMany: async () => [
    { playerName: 'Out Quarterback', position: 'QB', team: 'NYG', status: 'Out', description: 'Ankle', date: new Date('2026-09-26T12:00:00Z') },
  ] },
  playerValueSnapshot: { findMany: async () => [] },
} }))

import { getDash34Data } from '@/lib/core-app/dash34'
import { mergeDash34Issues } from '@/lib/core-app/mergeDash34Issues'

const NOW = new Date('2026-09-27T12:00:00Z')
const league = (id: string, name: string, status = 'in_season') =>
  ({ id, name, platform: 'sleeper', platformLeagueId: `sl-${id}`, sport: 'NFL', status })
const LEAGUES = [
  league('rd', 'Plain Redraft'),
  league('gl', 'Chopped Guillotine'),
  league('bb1', 'Best Ball Covered'),
  league('bb2', 'Best Ball Short'),
  league('pd', 'Not Drafted Yet', 'pre_draft'),
]

const verification = (slots: string[]) => ({ checkedAt: NOW.toISOString(), week: 3, source: 'Sleeper', slots })

beforeEach(() => {
  data.formats = [
    { id: 'rd', bestBallMode: false, guillotineMode: false, leagueVariant: null, settings: {} },
    { id: 'gl', bestBallMode: false, guillotineMode: true, leagueVariant: 'guillotine', settings: {} },
    { id: 'bb1', bestBallMode: true, guillotineMode: false, leagueVariant: 'best_ball', settings: {} },
    { id: 'bb2', bestBallMode: true, guillotineMode: false, leagueVariant: 'best_ball', settings: {} },
    { id: 'pd', bestBallMode: false, guillotineMode: false, leagueVariant: null, settings: {} },
  ]
  live.mockReset()
  live.mockImplementation(async (sourceId: string) => {
    switch (sourceId) {
      // CONTROL — an Out starter in a managed lineup must alert.
      case 'sl-rd':
        return { players: ['qbOut', 'qbOk'], starters: ['qbOut'], reserve: [], taxi: [], verification: verification(['QB']) }
      // Chopped: an Out starter AND an empty slot, and still nothing to do.
      case 'sl-gl':
        return { players: ['qbOut'], starters: ['qbOut', '0'], reserve: [], taxi: [], eliminated: true, verification: verification(['QB', 'WR']) }
      // Best Ball: the Out QB is covered by a healthy QB on the bench.
      case 'sl-bb1':
        return { players: ['qbOut', 'qbOk', 'wrOk'], starters: ['qbOut', 'wrOk'], reserve: [], taxi: [], bestBall: true, waiversEnabled: true, verification: verification(['QB', 'WR']) }
      // Best Ball: nobody eligible can cover QB, and the league allows adds.
      case 'sl-bb2':
        return { players: ['qbOut', 'wrOk'], starters: ['qbOut', 'wrOk'], reserve: [], taxi: [], bestBall: true, waiversEnabled: true, verification: verification(['QB', 'WR']) }
      // Not drafted: every slot empty.
      case 'sl-pd':
        return { players: [], starters: ['0', '0'], reserve: [], taxi: [], leagueStatus: 'pre_draft', verification: verification(['QB', 'WR']) }
      default:
        return null
    }
  })
})

async function queue() {
  const dash = await getDash34Data('user', LEAGUES, NOW)
  return mergeDash34Issues([], dash)
}

describe('league-format scenarios reach Top decisions with the right text and destination', () => {
  it('CONTROL: a plain redraft Out starter is an urgent lineup row pointing at that player', async () => {
    const row = (await queue()).find((i) => i.leagueId === 'rd')
    expect(row).toMatchObject({
      id: 'rd:starter-out',
      severity: 'bad',
      title: 'Out Quarterback · QB · Out — Plain Redraft',
      action: { label: 'Review Out Quarterback', href: '/core/my-team?league=rd#lineup-player-qbOut', external: false },
    })
    expect(row?.meta).toContain('Listed Out in your starting lineup')
  })

  it('an eliminated Guillotine team raises nothing — no starter-out, no empty slot', async () => {
    expect((await queue()).filter((i) => i.leagueId === 'gl')).toEqual([])
  })

  it('Best Ball with an eligible bench replacement raises nothing: the lineup is chosen automatically', async () => {
    expect((await queue()).filter((i) => i.leagueId === 'bb1')).toEqual([])
  })

  it('Best Ball with no eligible replacement is a waiver prompt, not a lineup alarm', async () => {
    const rows = (await queue()).filter((i) => i.leagueId === 'bb2')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'bb2:best-ball-coverage',
      severity: 'warn',
      title: 'Best Ball roster coverage — Best Ball Short',
      action: { label: 'Review waivers', href: '/core/waivers?league=bb2', external: false },
      deadline: null,
    })
    expect(rows[0].meta).toBe('Eligible roster cannot cover QB. Review waiver replacements; your lineup is selected automatically.')
    // Never the manual-lineup wording: Best Ball has no lineup to set.
    expect(rows[0].title).not.toMatch(/starter|cannot play/i)
  })

  it('Best Ball with no replacement but no adds allowed raises nothing — there is nothing to do', async () => {
    const base = live.getMockImplementation()!
    live.mockImplementation(async (sourceId: string, team: unknown) =>
      sourceId === 'sl-bb2' ? { ...(await base(sourceId, team)), waiversEnabled: false } : base(sourceId, team),
    )
    expect((await queue()).filter((i) => i.leagueId === 'bb2')).toEqual([])
  })

  it('a league that has not drafted raises no empty-slot or lineup row', async () => {
    expect((await queue()).filter((i) => i.leagueId === 'pd')).toEqual([])
  })
})
