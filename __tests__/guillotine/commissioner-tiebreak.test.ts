// @vitest-environment node
/**
 * "Commissioner decides" (lib/guillotine/commissionerTiebreak.ts): the tiebreak step that used to do nothing.
 *
 *   - the resolver reports a tie that reached the step with no pick, and still answers with the next step;
 *   - the chop engine HOLDS that chop (nothing about the week written) and asks the commissioner;
 *   - the commissioner's pick, for the same tie, chops that team on the next run;
 *   - after the window, or for a tie that changed, the next step's answer stands, as it always did;
 *   - the pick is checked under the league row's lock and written to the league log.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  guillotineSeason: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  guillotineElimination: { findFirst: vi.fn(), findMany: vi.fn() },
  guillotinePeriodScore: { findMany: vi.fn() },
  guillotineRosterState: { findMany: vi.fn(), upsert: vi.fn() },
  roster: { findMany: vi.fn(), update: vi.fn() },
  leagueTeam: { updateMany: vi.fn(), findMany: vi.fn() },
  appUser: { findMany: vi.fn() },
  redraftRosterPlayer: { updateMany: vi.fn() },
  redraftRoster: { findMany: vi.fn(), update: vi.fn() },
  leagueAuditLog: { create: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}))
const m = vi.hoisted(() => ({
  getGuillotineConfig: vi.fn(),
  resolveTiebreak: vi.fn(),
  evaluateWeek: vi.fn(),
  savePeriodScores: vi.fn(),
  dispatchNotification: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/automation/locks', () => ({
  acquireAutomationLock: vi.fn(async () => ({ ok: true, backend: 'postgres' })),
  releaseAutomationLock: vi.fn(async () => undefined),
}))
vi.mock('@/lib/guillotine/importedLeagueGuard', async (orig) => ({
  ...(await orig<typeof import('@/lib/guillotine/importedLeagueGuard')>()),
  isImportedLeague: vi.fn(async () => false),
}))
vi.mock('@/lib/league-runtime/reconcileRosterRedraftLinks', () => ({
  resolveRedraftRosterId: vi.fn(async () => null),
  resolveRedraftRosterIds: vi.fn(async () => new Map()),
  reconcileRosterRedraftLinks: vi.fn(),
}))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ getGuillotineConfig: m.getGuillotineConfig }))
vi.mock('@/lib/guillotine/GuillotineTiebreakResolver', () => ({ resolveTiebreak: m.resolveTiebreak }))
vi.mock('@/lib/guillotine/GuillotineWeekEvaluator', () => ({
  evaluateWeek: m.evaluateWeek,
  getDraftSlotByRoster: vi.fn(async () => new Map()),
  savePeriodScores: m.savePeriodScores,
}))
vi.mock('@/lib/guillotine/GuillotineRosterReleaseEngine', () => ({ releaseChoppedRosters: vi.fn(async () => ({})) }))
vi.mock('@/lib/guillotine/GuillotineEventLog', () => ({ appendEvent: vi.fn(), getRecentEvents: vi.fn() }))
vi.mock('@/lib/guillotine/weeklyRecap', () => ({ postAutomaticGuillotineRecap: vi.fn() }))
vi.mock('@/lib/guillotine/faabOnChopApply', () => ({ redistributeChoppedFaab: vi.fn() }))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({ createLeagueChatMessage: vi.fn() }))
vi.mock('@/lib/guillotine/guillotineChat', () => ({ postChopToLeagueChat: vi.fn() }))
vi.mock('@/lib/guillotine/chopAlerts', () => ({ sendChopResultAlerts: vi.fn() }))
vi.mock('@/lib/guillotine/guillotineChopAudit', () => ({
  recordChopAudit: vi.fn(async () => ({ recorded: true })),
  findGuillotineSeasonId: vi.fn(async () => null),
  isPeriodAlreadyRecorded: vi.fn(async () => false),
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.dispatchNotification }))

import { runElimination } from '@/lib/guillotine/GuillotineEliminationEngine'
import {
  COMMISSIONER_TIEBREAK_WINDOW_MS,
  engineTiebreakInputs,
  readCommissionerTiebreak,
  tiebreakState,
  validateTiebreakDecision,
  type CommissionerTiebreakEntry,
} from '@/lib/guillotine/commissionerTiebreak'
import { holdChopForCommissioner, saveCommissionerDecision } from '@/lib/guillotine/commissionerTiebreakStore'
import { describeLogEntry, rosterIdsNamedBy } from '@/lib/league-log/leagueLog'

const { resolveTiebreak: realResolveTiebreak } = await vi.importActual<typeof import('@/lib/guillotine/GuillotineTiebreakResolver')>(
  '@/lib/guillotine/GuillotineTiebreakResolver',
)

const NOW = new Date('2026-11-15T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()
const scores = [
  { rosterId: 'a', periodPoints: 80, seasonPointsCumul: 400 },
  { rosterId: 'b', periodPoints: 80, seasonPointsCumul: 400 },
  { rosterId: 'c', periodPoints: 95, seasonPointsCumul: 500 },
  { rosterId: 'd', periodPoints: 110, seasonPointsCumul: 520 },
]

describe('the resolver reports a tie that reached "Commissioner decides"', () => {
  const args = {
    candidates: scores,
    tiebreakerOrder: ['season_points', 'commissioner', 'random'] as const,
    teamsPerChop: 1,
    weekOrPeriod: 5,
    draftSlotByRoster: new Map<string, number>(),
    tiebreakSeed: 'L1:2026',
  }

  it('names the tied teams and still answers with the next step', () => {
    const res = realResolveTiebreak({ ...args, tiebreakerOrder: [...args.tiebreakerOrder] })
    expect(res.awaitingCommissioner).toEqual({ tiedRosterIds: ['a', 'b'], needed: 1 })
    expect(res.stepUsed).toBe('random')
    expect(res.choppedRosterIds).toHaveLength(1)
  })

  it('applies the commissioner pick at the step, and then nothing is awaited', () => {
    const res = realResolveTiebreak({ ...args, tiebreakerOrder: [...args.tiebreakerOrder], commissionerChoppedRosterIds: ['b'] })
    expect(res.choppedRosterIds).toEqual(['b'])
    expect(res.awaitingCommissioner).toBeUndefined()
  })

  it('awaits nothing when an earlier step breaks the tie', () => {
    const res = realResolveTiebreak({
      ...args,
      tiebreakerOrder: [...args.tiebreakerOrder],
      candidates: scores.map((s) => (s.rosterId === 'a' ? { ...s, seasonPointsCumul: 300 } : s)),
    })
    expect(res.choppedRosterIds).toEqual(['a'])
    expect(res.awaitingCommissioner).toBeUndefined()
  })
})

describe('the rules', () => {
  const entry = (over: Partial<CommissionerTiebreakEntry> = {}): CommissionerTiebreakEntry => ({
    tiedRosterIds: ['a', 'b', 'c'],
    needed: 1,
    requestedAt: hoursAgo(1),
    ...over,
  })

  it('reads only a well-formed entry', () => {
    const settings = { guillotine_commissioner_tiebreaks: { '2026:5': entry(), '2026:6': { tiedRosterIds: [], needed: 1, requestedAt: hoursAgo(1) } } }
    expect(readCommissionerTiebreak(settings, '2026:5')?.tiedRosterIds).toEqual(['a', 'b', 'c'])
    expect(readCommissionerTiebreak(settings, '2026:6')).toBeNull()
    expect(readCommissionerTiebreak(null, '2026:5')).toBeNull()
  })

  it('waits inside the window, expires after it, and a decision is final', () => {
    expect(tiebreakState(null, NOW)).toBe('none')
    expect(tiebreakState(entry(), NOW)).toBe('waiting')
    expect(tiebreakState(entry({ requestedAt: new Date(NOW.getTime() - COMMISSIONER_TIEBREAK_WINDOW_MS).toISOString() }), NOW)).toBe('expired')
    expect(tiebreakState(entry({ requestedAt: hoursAgo(40), decidedRosterIds: ['b'] }), NOW)).toBe('decided')
    expect(engineTiebreakInputs(entry({ decidedRosterIds: ['b'] }), NOW)).toEqual({ overrides: ['b'], mayWait: false })
    expect(engineTiebreakInputs(entry({ requestedAt: hoursAgo(13) }), NOW)).toEqual({ overrides: [], mayWait: false })
  })

  it('accepts exactly the number needed, only from the tied teams, only while waiting', () => {
    expect(validateTiebreakDecision(entry(), ['b'], NOW)).toEqual({ ok: true, rosterIds: ['b'] })
    expect(validateTiebreakDecision(entry(), ['b', 'b'], NOW)).toEqual({ ok: true, rosterIds: ['b'] })
    expect(validateTiebreakDecision(entry(), ['a', 'b'], NOW)).toMatchObject({ ok: false, status: 400 })
    expect(validateTiebreakDecision(entry(), ['z'], NOW)).toMatchObject({ ok: false, status: 400 })
    expect(validateTiebreakDecision(entry({ needed: 2 }), ['a'], NOW)).toMatchObject({ ok: false, error: 'Pick 2 teams.' })
    expect(validateTiebreakDecision(null, ['a'], NOW)).toMatchObject({ ok: false, status: 404 })
    expect(validateTiebreakDecision(entry({ decidedRosterIds: ['a'] }), ['b'], NOW)).toMatchObject({ ok: false, status: 409 })
    expect(validateTiebreakDecision(entry({ requestedAt: hoursAgo(13) }), ['b'], NOW)).toMatchObject({ ok: false, status: 409 })
  })
})

describe('the chop engine', () => {
  const awaiting = { choppedRosterIds: ['a'], stepUsed: 'random', reason: 'tiebreak: random', awaitingCommissioner: { tiedRosterIds: ['a', 'b'], needed: 1 } }
  const withEntry = (e: Record<string, unknown> | null) =>
    prismaMock.league.findUnique.mockResolvedValue({
      guillotineEndgame: 'last_team_standing',
      settings: e ? { guillotine_commissioner_tiebreaks: { '2026:5': e } } : {},
    })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    m.getGuillotineConfig.mockResolvedValue({ eliminationStartWeek: 1, eliminationEndWeek: 18, teamsPerChop: 1, tiebreakerOrder: ['season_points', 'commissioner', 'random'] })
    m.evaluateWeek.mockResolvedValue({ pastCutoff: true, activeRosterIds: scores.map((s) => s.rosterId), scores })
    prismaMock.guillotineRosterState.findMany.mockResolvedValue([])
    prismaMock.guillotinePeriodScore.findMany.mockResolvedValue([])
    prismaMock.guillotineRosterState.upsert.mockResolvedValue({})
    prismaMock.leagueTeam.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.leagueTeam.findMany.mockResolvedValue([])
    prismaMock.roster.findMany.mockResolvedValue([])
    prismaMock.redraftRoster.findMany.mockResolvedValue([])
    prismaMock.$executeRaw.mockResolvedValue(1)
    m.dispatchNotification.mockResolvedValue({})
    withEntry(null)
  })

  const run = () => runElimination({ leagueId: 'L1', weekOrPeriod: 5, season: 2026, skipChat: true, skipRosterRelease: true })

  it('holds the chop, writes nothing about the week, and asks the commissioner once', async () => {
    m.resolveTiebreak.mockReturnValue(awaiting)
    prismaMock.league.findUnique
      .mockResolvedValueOnce({ guillotineEndgame: 'last_team_standing', settings: {} })
      .mockResolvedValue({ name: 'Dynasty Bros', userId: 'owner-1' })

    const out = await run()

    expect(out).toMatchObject({ choppedRosterIds: [], reason: 'awaiting commissioner tiebreak' })
    expect(prismaMock.guillotineRosterState.upsert).not.toHaveBeenCalled()
    expect(m.savePeriodScores).not.toHaveBeenCalled()
    expect(m.dispatchNotification).toHaveBeenCalledTimes(1)
    expect(m.dispatchNotification.mock.calls[0]![0]).toMatchObject({
      userIds: ['owner-1'],
      category: 'commissioner_alerts',
      severity: 'high',
      actionHref: '/league/L1/guillotine-tiebreak',
      dedupePrefix: 'guillotine-tiebreak:L1:2026:5',
    })
  })

  it('keeps waiting without asking again while the window is open', async () => {
    m.resolveTiebreak.mockReturnValue(awaiting)
    withEntry({ tiedRosterIds: ['a', 'b'], needed: 1, requestedAt: hoursAgo(2), notifiedAt: hoursAgo(2) })

    const out = await run()

    expect(out?.reason).toBe('awaiting commissioner tiebreak')
    expect(m.dispatchNotification).not.toHaveBeenCalled()
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled()
  })

  it('chops the team the commissioner picked for this tie', async () => {
    m.resolveTiebreak
      .mockReturnValueOnce(awaiting)
      .mockReturnValueOnce({ choppedRosterIds: ['b'], stepUsed: 'commissioner', reason: 'tiebreak: commissioner' })
    withEntry({ tiedRosterIds: ['b', 'a'], needed: 1, requestedAt: hoursAgo(3), decidedRosterIds: ['b'], decidedBy: 'owner-1' })

    const out = await run()

    expect(m.resolveTiebreak.mock.calls[1]![0].commissionerChoppedRosterIds).toEqual(['b'])
    expect(out?.choppedRosterIds).toEqual(['b'])
    expect(prismaMock.guillotineRosterState.upsert.mock.calls[0]![0].where).toEqual({ rosterId: 'b' })
  })

  it('never applies a pick made for a different tie: the next rule decides', async () => {
    m.resolveTiebreak.mockReturnValue(awaiting)
    withEntry({ tiedRosterIds: ['a', 'c'], needed: 1, requestedAt: hoursAgo(3), decidedRosterIds: ['c'] })

    const out = await run()

    expect(m.resolveTiebreak).toHaveBeenCalledTimes(1)
    expect(out?.choppedRosterIds).toEqual(['a'])
  })

  it('never applies a pick made when the tie was different, even if that team is still tied', async () => {
    m.resolveTiebreak.mockReturnValue(awaiting)
    withEntry({ tiedRosterIds: ['a', 'b', 'c'], needed: 1, requestedAt: hoursAgo(3), decidedRosterIds: ['b'] })

    const out = await run()

    expect(m.resolveTiebreak).toHaveBeenCalledTimes(1)
    expect(out?.choppedRosterIds).toEqual(['a'])
  })

  it('after the window, the next rule decides and nobody is asked', async () => {
    m.resolveTiebreak.mockReturnValue(awaiting)
    withEntry({ tiedRosterIds: ['a', 'b'], needed: 1, requestedAt: hoursAgo(13), notifiedAt: hoursAgo(13) })

    const out = await run()

    expect(out?.choppedRosterIds).toEqual(['a'])
    expect(m.dispatchNotification).not.toHaveBeenCalled()
  })

  it('a tie broken before the step never waits', async () => {
    m.resolveTiebreak.mockReturnValue({ choppedRosterIds: ['a'], stepUsed: 'season_points', reason: 'tiebreak: season_points' })

    const out = await run()

    expect(out?.choppedRosterIds).toEqual(['a'])
    expect(m.dispatchNotification).not.toHaveBeenCalled()
  })
})

describe('holding and deciding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$executeRaw.mockResolvedValue(1)
    prismaMock.league.findUnique.mockResolvedValue({ name: 'Dynasty Bros', userId: 'owner-1' })
    prismaMock.leagueTeam.findMany.mockResolvedValue([{ claimedByUserId: 'head-2' }, { claimedByUserId: 'owner-1' }])
    m.dispatchNotification.mockResolvedValue({})
  })

  it('asks the owner and the head commissioner, then records that it asked', async () => {
    await holdChopForCommissioner({ leagueId: 'L1', key: '2026:5', week: 5, existing: null, tiedRosterIds: ['a', 'b'], needed: 1, now: NOW })
    expect(m.dispatchNotification.mock.calls[0]![0].userIds).toEqual(['owner-1', 'head-2'])
    // The entry, then the entry with notifiedAt.
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(prismaMock.$executeRaw.mock.calls[1])).toContain('notifiedAt')
  })

  it('never throws: a failed alert leaves the next run to ask again', async () => {
    m.dispatchNotification.mockRejectedValue(new Error('push down'))
    await expect(
      holdChopForCommissioner({ leagueId: 'L1', key: '2026:5', week: 5, existing: null, tiedRosterIds: ['a', 'b'], needed: 1, now: NOW }),
    ).resolves.toBeUndefined()
    expect(JSON.stringify(prismaMock.$executeRaw.mock.calls)).not.toContain('notifiedAt')
  })

  function txWith(settings: unknown) {
    const tx = { $queryRaw: vi.fn(async () => [{ settings }]), $executeRaw: vi.fn(async () => 1), leagueAuditLog: { create: vi.fn(async () => ({})) } }
    prismaMock.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx))
    return tx
  }
  const waiting = { guillotine_commissioner_tiebreaks: { '2026:5': { tiedRosterIds: ['a', 'b'], needed: 1, requestedAt: hoursAgo(1) } } }

  it('saves a valid pick and writes the league log', async () => {
    const tx = txWith(waiting)
    const out = await saveCommissionerDecision({
      leagueId: 'L1',
      key: '2026:5',
      userId: 'owner-1',
      now: NOW,
      check: (e) => validateTiebreakDecision(e, ['b'], NOW),
    })
    expect(out).toMatchObject({ ok: true, entry: { decidedRosterIds: ['b'], decidedBy: 'owner-1' } })
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
    expect(tx.leagueAuditLog.create.mock.calls[0]![0].data).toMatchObject({
      actionType: 'guillotine_tiebreak_decided',
      afterState: { tiedRosterIds: ['a', 'b'], choppedRosterIds: ['b'] },
    })
  })

  it('refuses a bad pick and writes nothing', async () => {
    const tx = txWith(waiting)
    const out = await saveCommissionerDecision({
      leagueId: 'L1',
      key: '2026:5',
      userId: 'owner-1',
      now: NOW,
      check: (e) => validateTiebreakDecision(e, ['c'], NOW),
    })
    expect(out).toMatchObject({ ok: false, status: 400 })
    expect(tx.$executeRaw).not.toHaveBeenCalled()
    expect(tx.leagueAuditLog.create).not.toHaveBeenCalled()
  })
})

describe('the league log', () => {
  const row = {
    id: 'r1',
    actionType: 'guillotine_tiebreak_decided',
    entityId: 'L1',
    userId: 'owner-1',
    beforeState: null,
    afterState: { tiedRosterIds: ['a', 'b'], choppedRosterIds: ['b'] },
    metadata: { key: '2026:5' },
    createdAt: NOW,
  }

  it('says who went and that the commissioner decided, to members too', () => {
    const entry = describeLogEntry(row, { lang: 'en', names: { users: { 'owner-1': 'Sam' }, teams: { a: 'Ankle Breakers', b: 'Bench Mob' } }, forCommissioner: false })
    expect(entry?.title).toContain('Broke the chop tie in week 5: Bench Mob goes')
    expect(entry?.detail).toContain('2 teams were tied')
    expect(rosterIdsNamedBy([row]).sort()).toEqual(['a', 'b'])
  })
})
