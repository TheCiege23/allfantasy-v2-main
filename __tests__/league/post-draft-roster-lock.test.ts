/**
 * Post-draft roster lock + the derived `post_draft` → `in_season` phase.
 *
 * Policy (owner's default): from draft completion until the first waiver run after the draft OR the
 * start of week 1 — whichever comes first — adds/drops, free-agent pickups and trades are refused with
 * `roster_locked_post_draft`. Lineup moves and waiver claims stay allowed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  league: null as null | Record<string, unknown>,
  draftSession: null as null | { status: string; completedAt: Date | null },
  waiverRun: null as null | { runAt: Date },
  sportsGames: [] as Array<{ week: number | null; seasonType: string | null; startTime: Date | null }>,
  waiverRunWhere: null as unknown,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => db.league) },
    draftSession: { findFirst: vi.fn(async () => db.draftSession) },
    waiverRun: {
      findFirst: vi.fn(async (args: { where: unknown }) => {
        db.waiverRunWhere = args.where
        return db.waiverRun
      }),
    },
    sportsGame: { findMany: vi.fn(async () => db.sportsGames) },
    sportsDataCache: { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null) },
  },
}))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn(async () => undefined) }))

import { assertLifecycleActionAllowed, isActionAllowed } from '@/server/services/leagueLifecycleService'
import { resolvePostDraftContext } from '@/server/services/postDraftRosterLockService'
import {
  POST_DRAFT_LOCK_POLICY,
  POST_DRAFT_ROSTER_LOCK_CODE,
  postDraftRosterLockRefusal,
  resolveDailySportWeek1Start,
  resolveEffectiveLifecyclePhase,
  resolveNflWeek1Start,
  resolvePostDraftRosterLock,
} from '@/lib/league/postDraftRosterLock'

// NFL 2026: preseason row labelled week 1 must be ignored; regular week 1 kicks off Thu Sep 10 ET.
const NFL_ROWS = [
  { week: 1, seasonType: 'pre', startTime: new Date('2026-08-07T23:00:00.000Z') },
  { week: 1, seasonType: 'regular', startTime: new Date('2026-09-13T17:00:00.000Z') },
  { week: 1, seasonType: 'regular', startTime: new Date('2026-09-11T00:20:00.000Z') },
  { week: 2, seasonType: 'regular', startTime: new Date('2026-09-18T00:15:00.000Z') },
]
const NFL_WEEK1 = new Date('2026-09-11T00:20:00.000Z')
const DRAFT_DONE = new Date('2026-09-01T02:00:00.000Z')
const JUST_AFTER_DRAFT = new Date('2026-09-01T02:05:00.000Z')

function seedNflLeague() {
  db.league = {
    id: 'L1',
    userId: 'comm',
    lifecycleState: 'post_draft',
    locked: false,
    emergencyPaused: false,
    lifecycleMetadata: null,
    settings: {},
    status: 'active',
    sport: 'NFL',
    season: 2026,
    isDynasty: false,
    timezone: 'America/New_York',
  }
  db.draftSession = { status: 'completed', completedAt: DRAFT_DONE }
  db.waiverRun = null
  db.sportsGames = NFL_ROWS
}

beforeEach(() => {
  seedNflLeague()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(JUST_AFTER_DRAFT)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the policy table', () => {
  it('refuses add/drop, FA pickup and trades; allows lineup and waiver claims', () => {
    expect(POST_DRAFT_LOCK_POLICY).toEqual({
      add_drop: 'refused',
      free_agent_pickup: 'refused',
      trade: 'refused',
      waiver_claim: 'allowed',
      lineup: 'allowed',
    })
  })
})

describe('resolvePostDraftRosterLock (pure)', () => {
  const base = {
    storedState: 'post_draft',
    draftCompletedAt: DRAFT_DONE,
    firstWaiverRunAfterDraftAt: null,
    week1StartsAt: NFL_WEEK1,
    now: JUST_AFTER_DRAFT,
  }

  it('is locked right after the draft, until week 1 at the latest', () => {
    expect(resolvePostDraftRosterLock(base)).toEqual({ locked: true, unlocksAt: NFL_WEEK1 })
  })

  it('unlocks after the first waiver run following the draft', () => {
    const run = new Date('2026-09-02T09:00:00.000Z')
    expect(resolvePostDraftRosterLock({ ...base, firstWaiverRunAfterDraftAt: run, now: new Date('2026-09-02T09:01:00.000Z') }))
      .toEqual({ locked: false, reason: 'waiver_run_cleared' })
  })

  it('a waiver run from BEFORE the draft does not unlock', () => {
    expect(resolvePostDraftRosterLock({ ...base, firstWaiverRunAfterDraftAt: new Date('2026-08-30T09:00:00.000Z') }).locked).toBe(true)
  })

  it('unlocks at the start of week 1', () => {
    expect(resolvePostDraftRosterLock({ ...base, now: NFL_WEEK1 })).toEqual({ locked: false, reason: 'week1_started' })
  })

  it('does not lock a post_draft league with no completed draft (imports, forced transitions)', () => {
    expect(resolvePostDraftRosterLock({ ...base, draftCompletedAt: null })).toEqual({ locked: false, reason: 'no_draft_completion' })
  })

  it('does not lock outside post_draft', () => {
    expect(resolvePostDraftRosterLock({ ...base, storedState: 'in_season' }).locked).toBe(false)
  })

  it('the refusal carries the code and a message naming when it unlocks', () => {
    const refusal = postDraftRosterLockRefusal('trade', { locked: true, unlocksAt: NFL_WEEK1 }, 'America/New_York')
    expect(refusal?.code).toBe('roster_locked_post_draft')
    expect(refusal?.status).toBe(423)
    expect(refusal?.unlocksAt).toBe(NFL_WEEK1.toISOString())
    expect(refusal?.error).toMatch(/Trades open after the first waiver run or when week 1 starts \(Thu, Sep 10, 8:20 PM EDT\)/)
    expect(postDraftRosterLockRefusal('waiver_claim', { locked: true, unlocksAt: NFL_WEEK1 })).toBeNull()
    expect(postDraftRosterLockRefusal('lineup', { locked: true, unlocksAt: NFL_WEEK1 })).toBeNull()
  })
})

describe('derived phase: week 1 start for each sport', () => {
  it('NFL — first regular-season kickoff, preseason rows ignored', () => {
    expect(resolveNflWeek1Start(NFL_ROWS, DRAFT_DONE)).toEqual(NFL_WEEK1)
  })
  it('NFL — a league drafted after week 1 kicked off gets the next week', () => {
    expect(resolveNflWeek1Start(NFL_ROWS, new Date('2026-09-12T00:00:00.000Z'))).toEqual(new Date('2026-09-18T00:15:00.000Z'))
  })
  it.each([
    ['NBA', 2026, '2026-10-20T00:00:00.000Z'],
    ['NHL', 2026, '2026-09-29T00:00:00.000Z'],
    ['MLB', 2026, '2026-03-25T00:00:00.000Z'],
    ['MLB', 2027, '2027-03-24T00:00:00.000Z'],
  ])('%s %i — the regular-season opener', (sport, season, opener) => {
    const draftedBefore = new Date(Date.parse(opener) - 5 * 86_400_000)
    expect(resolveDailySportWeek1Start(sport, season, draftedBefore)).toEqual(new Date(opener))
  })
  it('daily sport drafted mid-week-1 gets week 2', () => {
    expect(resolveDailySportWeek1Start('NHL', 2026, new Date('2026-09-30T12:00:00.000Z'))).toEqual(new Date('2026-10-06T00:00:00.000Z'))
  })
  it('an unknown opener derives nothing — it never guesses', () => {
    expect(resolveDailySportWeek1Start('NBA', 2031, null)).toBeNull()
    expect(resolveEffectiveLifecyclePhase({ storedState: 'post_draft', week1StartsAt: null, now: new Date('2032-01-01') })).toBe('post_draft')
  })

  it.each([
    ['NFL', 2026, NFL_WEEK1],
    ['NBA', 2026, new Date('2026-10-20T00:00:00.000Z')],
    ['NHL', 2026, new Date('2026-09-29T00:00:00.000Z')],
    ['MLB', 2027, new Date('2027-03-24T00:00:00.000Z')],
  ])('%s %i — a stored post_draft reads as in_season from week 1 (via the DB loader)', async (sport, season, week1) => {
    db.league = { ...db.league!, sport, season }
    db.draftSession = { status: 'completed', completedAt: new Date(week1.getTime() - 7 * 86_400_000) }
    const row = db.league as never
    const before = await resolvePostDraftContext(row, { now: new Date(week1.getTime() - 60_000) })
    expect(before.effectiveState).toBe('post_draft')
    expect(before.lock.locked).toBe(true)
    expect(before.week1StartsAt).toEqual(week1)
    const after = await resolvePostDraftContext(row, { now: week1 })
    expect(after.effectiveState).toBe('in_season')
    expect(after.lock).toEqual({ locked: false, reason: 'week1_started' })
  })

  it('the stored phase table is unchanged: post_draft still allows these actions in principle', () => {
    expect(isActionAllowed('trade_act', 'post_draft')).toBe(true)
    expect(isActionAllowed('waiver_claim_submit', 'post_draft')).toBe(true)
  })
})

describe('assertLifecycleActionAllowed — the gate every endpoint uses', () => {
  it('refuses a trade right after the draft with roster_locked_post_draft', async () => {
    const r = await assertLifecycleActionAllowed('L1', 'trade_act', 'u1')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.err.code).toBe(POST_DRAFT_ROSTER_LOCK_CODE)
    expect(r.err.status).toBe(423)
    expect(r.err.error).toMatch(/week 1 starts/)
  })

  it('refuses a free-agent pickup (add-drop route) right after the draft', async () => {
    const r = await assertLifecycleActionAllowed('L1', 'waiver_claim_submit', 'u1', { rosterMove: 'free_agent_pickup' })
    expect(r).toMatchObject({ ok: false, err: { code: POST_DRAFT_ROSTER_LOCK_CODE } })
  })

  it('allows a waiver claim during the lock, and reports the lock to the caller', async () => {
    const r = await assertLifecycleActionAllowed('L1', 'waiver_claim_submit', 'u1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.postDraftLock?.locked).toBe(true)
  })

  it('allows a lineup move during the lock', async () => {
    const r = await assertLifecycleActionAllowed('L1', 'roster_edit', 'u1', { rosterMove: 'lineup' })
    expect(r.ok).toBe(true)
  })

  it('unlocks once the first waiver run after the draft has completed', async () => {
    vi.setSystemTime(new Date('2026-09-02T10:00:00.000Z'))
    db.waiverRun = { runAt: new Date('2026-09-02T09:00:00.000Z') }
    const r = await assertLifecycleActionAllowed('L1', 'trade_act', 'u1')
    expect(r.ok).toBe(true)
    // FCFS-immediate runs never count, and only runs after the draft do.
    expect(db.waiverRunWhere).toMatchObject({
      leagueId: 'L1',
      status: 'completed',
      runType: { notIn: ['fcfs_immediate'] },
      runAt: { gt: DRAFT_DONE },
    })
  })

  it('unlocks at week 1, and the derived in_season phase admits in-season actions', async () => {
    vi.setSystemTime(NFL_WEEK1)
    expect((await assertLifecycleActionAllowed('L1', 'trade_act', 'u1')).ok).toBe(true)
    expect((await assertLifecycleActionAllowed('L1', 'waiver_claim_submit', 'u1', { rosterMove: 'free_agent_pickup' })).ok).toBe(true)
    // `scoring_process_week` is not in the post_draft set; it passes only because the phase derived to in_season.
    expect(isActionAllowed('scoring_process_week', 'post_draft')).toBe(false)
    expect((await assertLifecycleActionAllowed('L1', 'scoring_process_week', 'comm', { isElevatedCommissioner: true })).ok).toBe(true)
  })

  it('still refuses scoring_process_week before week 1 (the phase is still post_draft)', async () => {
    const r = await assertLifecycleActionAllowed('L1', 'scoring_process_week', 'comm', { isElevatedCommissioner: true })
    expect(r).toMatchObject({ ok: false, err: { code: 'LIFECYCLE_BLOCKED' } })
  })

  it('the commissioner override path still makes manual roster moves during the lock', async () => {
    const r = await assertLifecycleActionAllowed('L1', 'trade_act', 'comm', {
      commissionerOverride: true,
      isElevatedCommissioner: true,
    })
    expect(r.ok).toBe(true)
    const fa = await assertLifecycleActionAllowed('L1', 'waiver_claim_submit', 'comm', {
      commissionerOverride: true,
      isElevatedCommissioner: true,
      rosterMove: 'free_agent_pickup',
    })
    expect(fa.ok).toBe(true)
  })

  it('a commissioner acting as a manager (no override) is locked like everyone else', async () => {
    const r = await assertLifecycleActionAllowed('L1', 'trade_act', 'comm', { isElevatedCommissioner: true })
    expect(r).toMatchObject({ ok: false, err: { code: POST_DRAFT_ROSTER_LOCK_CODE } })
  })

  it('a dynasty league is not locked by the redraft policy', async () => {
    db.league = { ...db.league!, isDynasty: true }
    expect((await assertLifecycleActionAllowed('L1', 'trade_act', 'u1')).ok).toBe(true)
  })

  it('a devy league (dynasty family by leagueType, isDynasty false) is not locked either', async () => {
    db.league = { ...db.league!, isDynasty: false, leagueType: 'devy' }
    expect((await assertLifecycleActionAllowed('L1', 'trade_act', 'u1')).ok).toBe(true)
  })

  it('fails open when the context read throws', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.draftSession.findFirst).mockRejectedValueOnce(new Error('db down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await assertLifecycleActionAllowed('L1', 'trade_act', 'u1')).ok).toBe(true)
    warn.mockRestore()
  })
})
