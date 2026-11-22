/**
 * A renewed Best Ball tournament league must not end its new season on the first scoring tick. Renewal
 * never replaced `League.bbContestId`, so year two pointed at year one's completed contest:
 *   - the new season's tick read "complete" and finalized the new season;
 *   - last season, still in score-sync's batch, re-finalized every tick and moved the in-season league
 *     to completed.
 * runNativeTournamentWeek now rolls a fresh contest for a season none of whose rosters are entered in
 * the completed one, and returns `superseded` for a completed season with a newer one behind it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  seasons: new Map<string, Record<string, unknown>>(),
  contests: new Map<string, Record<string, unknown>>(),
  entries: [] as Array<{ id: string; contestId: string }>,
  rosters: new Map<string, string[]>(),
  league: { id: 'L1', bbContestId: 'c1' as string | null },
  finalize: vi.fn(async () => undefined),
  created: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/prisma', () => {
  const db = {
    redraftSeason: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => ({
        ...m.seasons.get(where.id),
        league: {
          id: 'L1', bbContestId: m.league.bbContestId, bestBallMode: true, bbTiebreaker: 'max_week',
          settings: { best_ball_settings: { contestStructure: 'tournament', regularSeasonLength: 14, tournamentAdvancementRounds: 1 } },
        },
      }),
      findFirst: async ({ where }: { where: { leagueId: string; id: { not: string }; createdAt: { gt: Date } } }) =>
        [...m.seasons.values()].find((s) => s.id !== where.id.not && (s.createdAt as Date) > where.createdAt.gt) ?? null,
    },
    league: {
      findUniqueOrThrow: async () => ({ bbContestId: m.league.bbContestId }),
      update: async ({ data }: { data: { bbContestId: string } }) => { m.league.bbContestId = data.bbContestId },
    },
    bestBallContest: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => m.contests.get(where.id)!,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `c${m.contests.size + 1}`, status: 'open', ...data }
        m.contests.set(row.id as string, row)
        m.created.push(row)
        return row
      },
    },
    bestBallEntry: {
      count: async ({ where }: { where: { contestId: string; id?: { in: string[] } } }) =>
        m.entries.filter((e) => e.contestId === where.contestId && (!where.id || where.id.in.includes(e.id))).length,
    },
    redraftRoster: {
      findMany: async ({ where }: { where: { seasonId: string } }) => (m.rosters.get(where.seasonId) ?? []).map((id) => ({ id })),
    },
    draftSession: { findFirst: async () => ({ status: 'pre_draft' }) },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  }
  return { prisma: db }
})
vi.mock('@/lib/bestball/finalizeNativeTournamentSeason', () => ({ finalizeNativeTournamentSeason: m.finalize }))
vi.mock('@/lib/bestball/contestEngine', () => ({ assignEntriesToPods: vi.fn(), advancePodWinners: vi.fn() }))

import { runNativeTournamentWeek } from '@/lib/bestball/nativeTournament'

const CONTEST = { name: 'BB Cup', sport: 'NFL', variant: 'tournament', podSize: 12, rosterSize: 18, rounds: 2, advancersPerPod: 1,
  draftType: 'snake', draftSpeed: 'slow', entryType: 'single', maxEntriesPerUser: null, scoringPeriod: 'weekly',
  cumulativeScoring: true, resetBetweenRounds: false }

beforeEach(() => {
  vi.clearAllMocks()
  m.created = []
  m.league.bbContestId = 'c1'
  m.contests = new Map([['c1', { id: 'c1', status: 'complete', ...CONTEST }]])
  m.seasons = new Map([
    ['s2026', { id: 's2026', leagueId: 'L1', status: 'complete', createdAt: new Date('2026-06-01') }],
    ['s2027', { id: 's2027', leagueId: 'L1', status: 'in_season', createdAt: new Date('2027-06-01') }],
  ])
  m.rosters = new Map([['s2026', ['r26a', 'r26b']], ['s2027', ['r27a', 'r27b']]])
  m.entries = [{ id: 'c1:r26a', contestId: 'c1' }, { id: 'c1:r26b', contestId: 'c1' }]
})

describe('a renewed tournament league', () => {
  it('rolls a fresh contest for the new season instead of finalizing it', async () => {
    const outcome = await runNativeTournamentWeek('s2027', 1)
    expect(m.finalize).not.toHaveBeenCalled()
    expect(outcome).toBe('waiting_for_draft')
    expect(m.created).toHaveLength(1)
    expect(m.created[0]).toMatchObject({ status: 'open', name: 'BB Cup', rounds: 2, podSize: 12, rosterSize: 18 })
    expect(m.league.bbContestId).toBe(m.created[0]!.id)
  })

  it('leaves last season alone once a newer season exists — it was archived before the renewal', async () => {
    expect(await runNativeTournamentWeek('s2026', 1)).toBe('superseded')
    expect(m.finalize).not.toHaveBeenCalled()
    expect(m.created).toHaveLength(0)
  })

  it('still finalizes a season whose own contest completed', async () => {
    m.seasons.delete('s2027')
    expect(await runNativeTournamentWeek('s2026', 1)).toBe('complete')
    expect(m.finalize).toHaveBeenCalledWith('s2026')
    expect(m.created).toHaveLength(0)
  })

  it('rolls only once: a second tick uses the contest the first one created', async () => {
    await runNativeTournamentWeek('s2027', 1)
    await runNativeTournamentWeek('s2027', 1)
    expect(m.created).toHaveLength(1)
  })
})
