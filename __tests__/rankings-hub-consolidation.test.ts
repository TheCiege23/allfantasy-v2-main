import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The rankings hub consolidation (2026-10-01): `/rankings` retires into
 * `/core/rankings?scope=league`, `/dashboard/rankings` lands on `/core/rankings`,
 * and the One-league tab shows the power score the old page showed — from stored
 * data, never a live provider call.
 */

const redirectMock = vi.hoisted(() => vi.fn((url: string) => {
  throw Object.assign(new Error('NEXT_REDIRECT'), { url })
}))
vi.mock('next/navigation', () => ({ redirect: redirectMock }))

const snaps = vi.hoisted(() => ({ rows: [] as unknown[] }))
vi.mock('@/lib/power-rankings-dashboard/getPowerRankingSnapshotsForLeague', () => ({
  getPowerRankingSnapshotsForLeague: vi.fn(async () => snaps.rows),
}))
const teams = vi.hoisted(() => ({ rows: [] as unknown[] }))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueTeam: { findMany: vi.fn(async () => teams.rows) } } }))

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')

describe('/rankings is retired into the hub', () => {
  it('redirects to the One-league tab', async () => {
    const { default: Page } = await import('@/app/rankings/page')
    expect(() => Page()).toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith('/core/rankings?scope=league')
  })

  it('no longer reads leagues on the page — the signed-out leak cannot come back through it', () => {
    const src = read('app/rankings/page.tsx')
    expect(src).not.toMatch(/prisma/)
    expect(fs.existsSync(path.resolve(process.cwd(), 'app/rankings/RankingsClient.tsx'))).toBe(false)
  })

  it('/dashboard/rankings goes to /core/rankings, every other /dashboard path to /core', () => {
    const src = read('middleware.ts')
    expect(src).toMatch(
      /url\.pathname = pathname === "\/dashboard\/rankings" \|\| pathname\.startsWith\("\/dashboard\/rankings\/"\) \? "\/core\/rankings" : "\/core"/,
    )
  })

  it('the coach link uses the params /core/rankings reads (scope, league), not leagueId', async () => {
    const { getRankingsToolHref } = await import('@/lib/fantasy-coach/CoachToolResolver')
    const href = getRankingsToolHref('L-123')
    const u = new URL(href, 'https://x.test')
    expect(u.pathname).toBe('/core/rankings')
    expect(u.searchParams.get('scope')).toBe('league')
    expect(u.searchParams.get('league')).toBe('L-123')
    expect(u.searchParams.has('leagueId')).toBe(false)
    // …and /core reads `league` for the selected league (positive control on the consumer).
    expect(read('app/core/(shell)/[[...screen]]/page.tsx')).toMatch(/const selectedLeagueId\s*=\s*typeof sp\.league === ['"]string['"]/)
  })
})

describe('league power on the One-league tab', () => {
  beforeEach(() => {
    snaps.rows = []
    teams.rows = []
  })

  it('is null when no power ranking has been stored', async () => {
    const { getLeaguePower } = await import('@/lib/core-app/rankingsLeaguePower')
    expect(await getLeaguePower('L1', 'me')).toBeNull()
  })

  it('reads the latest snapshot, recomputes "you" for the viewer, and carries stored notes', async () => {
    snaps.rows = [
      {
        id: 's',
        leagueId: 'L1',
        season: 2026,
        week: 5,
        rankingMode: 'current_power',
        engine: 'x',
        computedAt: new Date('2026-09-30T12:00:00Z'),
        teams: [
          // The runner who wrote this snapshot was "Bravo" — isCurrentUser must not leak to the viewer.
          { rank: 2, teamName: 'Alpha', externalId: '0001', powerScore: 71.2, rankDelta: 1, prevRank: 3, tierLabel: 'Contender', record: { wins: 3, losses: 1, ties: 0 } },
          { rank: 1, teamName: 'Bravo', externalId: '2', powerScore: 80.4, rankDelta: null, prevRank: null, isCurrentUser: true },
          { junk: true },
        ],
      },
    ]
    teams.rows = [
      { externalId: '1', teamName: 'Alpha', claimedByUserId: 'me', strengthNotes: 'Deep at WR', riskNotes: '' },
      { externalId: '2', teamName: 'Bravo', claimedByUserId: 'them', strengthNotes: null, riskNotes: null },
    ]
    const { getLeaguePower } = await import('@/lib/core-app/rankingsLeaguePower')
    const power = (await getLeaguePower('L1', 'me'))!
    expect(power.rows.map((r) => [r.rank, r.name, r.isYou])).toEqual([
      [1, 'Bravo', false],
      [2, 'Alpha', true],
    ])
    expect(power.rows[1]).toMatchObject({ move: 1, tier: 'Contender', record: '3-1' })
    expect(power.yours).toEqual({ name: 'Alpha', strengths: 'Deep at WR', risks: null })
    expect(power.week).toBe(5)
  })
})
