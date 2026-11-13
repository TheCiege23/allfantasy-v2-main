/**
 * A best ball league whose draft is still open when its first scoring week starts.
 *
 * Nothing used to say so: no native season exists until the draft finishes, so the weeks being played
 * score nothing, and the Best Ball tab told members "Lineups appear here once the first games are
 * played". Now the season-week roll writes ONE commissioner-only league-log row per league per season
 * (no manager notification), and the tab says scores begin after the draft finishes.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  redraftSeason: { findFirst: vi.fn(async () => null) },
  draftSession: { findFirst: vi.fn() },
  teamWeekResult: { findMany: vi.fn(async () => []) },
  weeklyScore: { findMany: vi.fn(async () => []) },
  fantasyStanding: { findMany: vi.fn(async () => []) },
  sportsPlayer: { findMany: vi.fn(async () => []) },
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'U1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async () => ({ isMember: true })) }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/league/structuralSettingsLock', () => ({ structuralSettingsLockReason: vi.fn(async () => null) }))

import {
  BEST_BALL_DRAFT_UNFINISHED_ACTION,
  firstScoringWeekStarted,
  recordBestBallDraftsUnfinishedAtSeasonStart,
} from '@/lib/bestball/draftUnfinishedAtSeasonStart'
import { describeLogEntry, LOG_ACTIONS, MEMBER_LOG_ACTION_TYPES } from '@/lib/league-log/leagueLog'
import { draftPendingNotice } from '@/lib/bestball/nativeBestBallTab'
import { GET as bestBallGET } from '@/app/api/leagues/[leagueId]/bestball/handler'
import { BestBallTab } from '@/app/league/[leagueId]/tabs/BestBallTab'
import type { SportWeekResolution } from '@/lib/season-week/types'

const slate = { week: 1, seasonType: 'regular' as const, gameCount: 16, firstKickoffAt: new Date(), lastKickoffAt: new Date(), liveCount: 0, finalCount: 0, allFinal: false }
const week = (over: Partial<Extract<SportWeekResolution, { ok: true }>> = {}): SportWeekResolution => ({
  ok: true, sportWeek: 1, seasonType: 'regular', state: 'live', slate, nextSportWeek: 2, source: 'schedule', ...over,
})

describe('has the first scoring week started', () => {
  it('only once regular-season week 1 has kicked off, or a later week is current', () => {
    expect(firstScoringWeekStarted(week({ state: 'upcoming' }))).toBe(false)
    expect(firstScoringWeekStarted(week({ state: 'live' }))).toBe(true)
    expect(firstScoringWeekStarted(week({ state: 'played' }))).toBe(true)
    expect(firstScoringWeekStarted(week({ sportWeek: 3, state: 'upcoming' }))).toBe(true)
    expect(firstScoringWeekStarted(week({ seasonType: 'pre', state: 'live' }))).toBe(false)
    expect(firstScoringWeekStarted({ ok: false, reason: 'NO_SCHEDULE_ROWS' })).toBe(false)
  })
})

/** An in-memory slice of the tables the sweep reads and writes. */
function sweepDb(opts: {
  sessions: Array<{ id: string; leagueId: string; status: string; league: { sport: string; season: number; platform: string | null } }>
  seasons?: Array<{ leagueId: string; season: number }>
}) {
  const audit: Array<{ leagueId: string; actionType: string; entityId: string; metadata: unknown }> = []
  // Every read and write yields to the event loop, as a real query does, so two runs started together
  // genuinely interleave — without that, a missing lock could never show up as a second row.
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
  // pg_advisory_xact_lock, in memory: held per key until the transaction that took it ends.
  const locks = new Map<string, Promise<void>>()
  const lockKeys: string[] = []
  const leagueAuditLog = {
    findFirst: vi.fn(async ({ where }: { where: { leagueId: string; actionType: string; entityId: string } }) => {
      await tick()
      return audit.find((r) => r.leagueId === where.leagueId && r.actionType === where.actionType && r.entityId === where.entityId) ?? null
    }),
    create: vi.fn(async ({ data }: { data: (typeof audit)[number] }) => {
      await tick()
      audit.push(data)
      return data
    }),
  }
  const fake = {
    draftSession: { findMany: vi.fn(async () => opts.sessions) },
    redraftSeason: { findMany: vi.fn(async () => opts.seasons ?? []) },
    leagueAuditLog,
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const mine: Array<{ key: string; release: () => void }> = []
      const tx = {
        leagueAuditLog,
        $executeRaw: async (_sql: TemplateStringsArray, ...values: unknown[]) => {
          const key = String(values[0])
          lockKeys.push(key)
          while (locks.has(key)) await locks.get(key)
          let release!: () => void
          locks.set(key, new Promise<void>((resolve) => (release = resolve)))
          mine.push({ key, release })
          return 0
        },
      }
      try {
        return await fn(tx)
      } finally {
        for (const m of mine) {
          locks.delete(m.key)
          m.release()
        }
      }
    }),
  }
  return { fake, audit, lockKeys }
}

const NATIVE = { id: 'D1', leagueId: 'L1', status: 'in_progress', league: { sport: 'NFL', season: 2026, platform: 'manual' } }

describe('the season-start sweep', () => {
  it('records one commissioner-only row for a hosted best ball league whose draft is still open at kickoff', async () => {
    const { fake, audit } = sweepDb({ sessions: [NATIVE] })
    const resolveWeek = vi.fn(async () => week())
    const out = await recordBestBallDraftsUnfinishedAtSeasonStart({ db: fake as never, resolveWeek })
    expect(out).toMatchObject({ scanned: 1, started: 1, recorded: 1, alreadyRecorded: 0 })
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ leagueId: 'L1', actionType: BEST_BALL_DRAFT_UNFINISHED_ACTION, entityId: '2026' })
  })

  it('writes once per league per season: the next hourly run finds the row and writes nothing', async () => {
    const { fake, audit } = sweepDb({ sessions: [NATIVE] })
    const resolveWeek = vi.fn(async () => week({ sportWeek: 2, state: 'played' }))
    await recordBestBallDraftsUnfinishedAtSeasonStart({ db: fake as never, resolveWeek })
    const second = await recordBestBallDraftsUnfinishedAtSeasonStart({ db: fake as never, resolveWeek })
    expect(second).toMatchObject({ recorded: 0, alreadyRecorded: 1 })
    expect(audit).toHaveLength(1)
    expect(fake.leagueAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it('two overlapping runs still write one row: the second waits on the lock, then finds the first one\'s row', async () => {
    const { fake, audit, lockKeys } = sweepDb({ sessions: [NATIVE, { ...NATIVE, id: 'D2', leagueId: 'L2' }] })
    const resolveWeek = vi.fn(async () => week())
    const [a, b] = await Promise.all([
      recordBestBallDraftsUnfinishedAtSeasonStart({ db: fake as never, resolveWeek }),
      recordBestBallDraftsUnfinishedAtSeasonStart({ db: fake as never, resolveWeek }),
    ])
    expect(audit.filter((r) => r.leagueId === 'L1')).toHaveLength(1)
    expect(audit.filter((r) => r.leagueId === 'L2')).toHaveLength(1)
    expect(a.recorded + b.recorded).toBe(2)
    expect(a.alreadyRecorded + b.alreadyRecorded).toBe(2)
    expect(a.errors).toEqual([])
    expect(b.errors).toEqual([])
    // One lock per league and season — not one global lock, and not per run.
    expect(new Set(lockKeys)).toEqual(
      new Set([
        JSON.stringify([BEST_BALL_DRAFT_UNFINISHED_ACTION, 'L1', '2026']),
        JSON.stringify([BEST_BALL_DRAFT_UNFINISHED_ACTION, 'L2', '2026']),
      ]),
    )
  })

  it('writes nothing before kickoff, for an imported league, or for a season that already exists', async () => {
    const upcoming = sweepDb({ sessions: [NATIVE] })
    await recordBestBallDraftsUnfinishedAtSeasonStart({ db: upcoming.fake as never, resolveWeek: async () => week({ state: 'upcoming' }) })
    expect(upcoming.audit).toHaveLength(0)

    const imported = sweepDb({ sessions: [{ ...NATIVE, league: { ...NATIVE.league, platform: 'sleeper' } }] })
    const importedOut = await recordBestBallDraftsUnfinishedAtSeasonStart({ db: imported.fake as never, resolveWeek: async () => week() })
    expect(importedOut.scanned).toBe(0)
    expect(imported.audit).toHaveLength(0)

    const hasSeason = sweepDb({ sessions: [NATIVE], seasons: [{ leagueId: 'L1', season: 2026 }] })
    await recordBestBallDraftsUnfinishedAtSeasonStart({ db: hasSeason.fake as never, resolveWeek: async () => week() })
    expect(hasSeason.audit).toHaveLength(0)
  })

  it('a dry run reports without writing, and the week is resolved once per sport and season', async () => {
    const { fake, audit } = sweepDb({ sessions: [NATIVE, { ...NATIVE, id: 'D2', leagueId: 'L2' }] })
    const resolveWeek = vi.fn(async () => week())
    const out = await recordBestBallDraftsUnfinishedAtSeasonStart({ db: fake as never, resolveWeek, dryRun: true })
    expect(out).toMatchObject({ started: 2, recorded: 0 })
    expect(audit).toHaveLength(0)
    expect(resolveWeek).toHaveBeenCalledTimes(1)
  })

  it('an unresolvable schedule is reported, not guessed', async () => {
    const { fake, audit } = sweepDb({ sessions: [NATIVE] })
    const out = await recordBestBallDraftsUnfinishedAtSeasonStart({ db: fake as never, resolveWeek: async () => ({ ok: false, reason: 'NO_SCHEDULE_ROWS' }) })
    expect(out.unresolved).toEqual(['NFL:2026'])
    expect(audit).toHaveLength(0)
  })
})

describe('the league-log row', () => {
  const row = {
    id: 'a1', actionType: BEST_BALL_DRAFT_UNFINISHED_ACTION, entityId: '2026', userId: null,
    beforeState: null, afterState: { draftStatus: 'in_progress' }, metadata: { season: 2026, sport: 'NFL', sportWeek: 1 }, createdAt: new Date(0),
  }
  const names = { users: {}, teams: {} }

  it('is worded for the commissioner and hidden from members', () => {
    expect(LOG_ACTIONS[BEST_BALL_DRAFT_UNFINISHED_ACTION]?.members).toBe(false)
    expect(MEMBER_LOG_ACTION_TYPES).not.toContain(BEST_BALL_DRAFT_UNFINISHED_ACTION)
    const commish = describeLogEntry(row, { lang: 'en', names, forCommissioner: true })
    expect(commish?.title).toBe('The 2026 season started before the draft finished')
    expect(commish?.detail).toMatch(/Finish the draft to start scoring/)
    expect(commish?.category).toBe('draft')
    expect(describeLogEntry(row, { lang: 'en', names, forCommissioner: false })).toBeNull()
    expect(describeLogEntry(row, { lang: 'es', names, forCommissioner: true })?.title).toMatch(/empezó antes de terminar el draft/)
  })
})

describe('the Best Ball tab while the draft is open', () => {
  it('names the state in plain words', () => {
    expect(draftPendingNotice('in_progress')).toBe('The draft is still running. Best ball scores begin after the draft finishes, because no team has a roster until then.')
    expect(draftPendingNotice('paused')).toMatch(/^The draft is still running\./)
    expect(draftPendingNotice('pre_draft')).toMatch(/^The draft has not started yet\. Best ball scores begin after the draft finishes/)
    expect(draftPendingNotice('completed')).toBeNull()
    expect(draftPendingNotice(null)).toBeNull()
  })

  const leagueRow = (platform: string) => ({
    id: 'L1', name: 'L', sport: 'NFL', season: 2026, leagueSize: 12, bestBallMode: true, settings: {}, bbMatchupFormat: 'h2h', bbScoringPeriod: 'weekly',
    platform, rosters: [], teams: [],
  })
  const get = async () => {
    const req = { nextUrl: new URL('http://localhost/api/leagues/L1/bestball') } as never
    const res = await bestBallGET(req, { params: Promise.resolve({ leagueId: 'L1' }) })
    return res.json()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    db.redraftSeason.findFirst.mockResolvedValue(null)
    db.draftSession.findFirst.mockResolvedValue({ status: 'in_progress' })
  })

  it('the API says so for a hosted league with no season yet', async () => {
    db.league.findUnique.mockResolvedValue(leagueRow('manual'))
    const body = await get()
    expect(body.draftNotice).toMatch(/^The draft is still running\./)
  })

  it('the API says nothing extra once the draft is completed, or for an imported league', async () => {
    db.draftSession.findFirst.mockResolvedValue({ status: 'completed' })
    db.league.findUnique.mockResolvedValue(leagueRow('manual'))
    expect((await get()).draftNotice).toBeNull()
    db.draftSession.findFirst.mockResolvedValue({ status: 'in_progress' })
    db.league.findUnique.mockResolvedValue(leagueRow('sleeper'))
    expect((await get()).draftNotice).toBeNull()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('the tab shows it instead of "lineups appear once the first games are played"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          league: { id: 'L1', name: 'L', sport: 'NFL', season: 2026, summary: 'Best Ball', settings: { mode: 'standard', draftMode: 'snake', contestStructure: 'season', matchupFormat: 'h2h', waiversEnabled: false, tradesEnabled: false, substitutionsEnabled: false, playoffTeams: 0 }, profile: { label: 'NFL', scoringPeriod: 'weekly', recommendedRosterSize: 18, lineupSlots: [], notes: [] } },
          selectedWeek: 1,
          weeksAvailable: [],
          draftNotice: 'The draft is still running. Best ball scores begin after the draft finishes, because no team has a roster until then.',
          lineups: [],
          rosterComposition: [],
          standings: [],
          history: [],
        }),
      })),
    )
    render(<BestBallTab leagueId="L1" sport="NFL" />)
    await waitFor(() => expect(screen.getByTestId('bestball-draft-pending').textContent).toMatch(/scores begin after the draft finishes/))
    expect(screen.queryByText(/Lineups appear here once the first games are played/)).toBeNull()
  })
})
