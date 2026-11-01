/**
 * The live Survivor Guilly chop with "Split it among the survivors" on. faabSplit.ts is tested on its
 * own; this runs the real executeSGLiveChop so the wiring is covered: the split happens inside the
 * chop's transaction, lands in chopSnapshot, and is announced after the chop line.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/platform/notification-service', () => ({ createPlatformNotification: vi.fn() }))
vi.mock('@/lib/survivor-guillotine/capped-scoring', () => ({ loadCappedGameScores: vi.fn() }))
vi.mock('@/lib/survivor-guillotine/rewards', () => ({ createSGWeeklyReward: vi.fn(), seedSGDraftIdols: vi.fn() }))
vi.mock('@/lib/survivor-guillotine/config', () => ({
  buildSGSchedule: () => ({ periods: [{ period: 1, chops: 1, mode: 'tribal', teamsEntering: 3 }], errors: [] }),
}))
// r3 loses: the resolver is not under test here, the chop's side effects are.
vi.mock('@/lib/survivor-guillotine/competition', () => ({
  resolveSGPeriod: () => ({ status: 'resolved', immuneTribeId: null, choppedTeamIds: ['r3'], savedTeamIds: [], placements: [], reasons: [] }),
}))

type Roster = { id: string; faabRemaining: number | null; redraftRosterId: string | null; playerData: unknown; updatedAt: Date }

const state = vi.hoisted(() => ({
  rosters: [] as Roster[],
  redraftFaab: {} as Record<string, number>,
  settings: {} as Record<string, unknown>,
  chat: [] as Array<{ message: string; metadata: Record<string, unknown> }>,
  seasonUpdate: null as null | Record<string, unknown>,
}))

const db = vi.hoisted(() => {
  const ok = () => vi.fn(async () => ({ count: 1 }))
  const none = () => vi.fn(async () => [])
  const self: Record<string, unknown> = {
    survivorGuillotineLeague: { findUnique: vi.fn(), updateMany: vi.fn() },
    survivorGuillotineChop: { count: vi.fn(async () => 0), findMany: none(), create: vi.fn() },
    survivorGuillotinePower: { findMany: none(), updateMany: ok() },
    league: { findUnique: vi.fn() },
    roster: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    redraftRoster: { update: vi.fn(), updateMany: vi.fn() },
    redraftRosterPlayer: { findMany: none(), updateMany: ok() },
    teamWeekResult: { findMany: vi.fn() },
    redraftSeason: { count: vi.fn(async () => 1) },
    leagueTeam: { findMany: vi.fn(async () => [{ claimedByUserId: 'u3', externalId: 'r3', teamName: 'Team Three', ownerName: 'Three' }]), updateMany: ok() },
    guillotineRosterState: { upsert: vi.fn() },
    waiverClaim: { updateMany: ok() },
    afRosterLineupAssignment: { deleteMany: ok() },
    leagueChatMessage: { create: vi.fn() },
  }
  self.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(self))
  return self as Record<string, Record<string, ReturnType<typeof vi.fn>>> & { $transaction: ReturnType<typeof vi.fn> }
})
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { executeSGLiveChop } from '@/lib/survivor-guillotine/live'

function wire() {
  db.survivorGuillotineLeague.findUnique.mockResolvedValue({
    leagueId: 'L1', currentPeriod: 1, revision: 4, config: { ceremonyMode: 'auto', immunityDeadline: 'ceremony', sport: 'NFL' },
    periodState: { period: 1, matchups: [], champions: [], sitOuts: [], priorSitOuts: [], ceremonyAt: '2000-01-01T00:00:00.000Z' },
    periodHistory: {}, scoreHistory: {},
    tribes: [{ rosterId: 'r1', tribeId: 'A' }, { rosterId: 'r2', tribeId: 'B' }, { rosterId: 'r3', tribeId: 'B' }],
  })
  db.survivorGuillotineLeague.updateMany.mockImplementation(async (args: { data: Record<string, unknown> }) => {
    state.seasonUpdate = args.data
    return { count: 1 }
  })
  db.league.findUnique.mockImplementation(async () => ({ season: 2026, userId: 'owner', settings: state.settings }))
  db.teamWeekResult.findMany.mockImplementation(async (args: { where: { week: number } }) =>
    args.where.week === 1 ? [{ rosterId: 'r1', totalPoints: 120 }, { rosterId: 'r2', totalPoints: 110 }, { rosterId: 'r3', totalPoints: 80 }] : [])
  db.roster.findMany.mockImplementation(async (args: { where?: { id?: { in: string[] } } }) => {
    const ids = args.where?.id?.in
    return ids ? state.rosters.filter((r) => ids.includes(r.id)) : state.rosters
  })
  db.roster.updateMany.mockImplementation(async (args: { where: { id: string; faabRemaining?: number }; data: { faabRemaining?: number } }) => {
    const row = state.rosters.find((r) => r.id === args.where.id)
    if (!row) return { count: 0 }
    if ('faabRemaining' in args.where && row.faabRemaining !== args.where.faabRemaining) return { count: 0 }
    if (args.data.faabRemaining !== undefined) row.faabRemaining = args.data.faabRemaining
    return { count: 1 }
  })
  db.roster.update.mockImplementation(async (args: { where: { id: string }; data: { faabRemaining: { increment: number } } }) => {
    const row = state.rosters.find((r) => r.id === args.where.id)!
    row.faabRemaining = (row.faabRemaining ?? 0) + args.data.faabRemaining.increment
    return row
  })
  db.redraftRoster.updateMany.mockImplementation(async (args: { where: { id: string }; data: { faabBalance: number | { increment: number } } }) => {
    const v = args.data.faabBalance
    state.redraftFaab[args.where.id] = typeof v === 'number' ? v : (state.redraftFaab[args.where.id] ?? 0) + v.increment
    return { count: 1 }
  })
  db.leagueChatMessage.create.mockImplementation(async (args: { data: { message: string; metadata: Record<string, unknown> } }) => {
    state.chat.push({ message: args.data.message, metadata: args.data.metadata })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  const at = new Date('2026-10-01T00:00:00Z')
  state.rosters = [
    { id: 'r1', faabRemaining: 40, redraftRosterId: 'rr1', playerData: [], updatedAt: at },
    { id: 'r2', faabRemaining: 10, redraftRosterId: 'rr2', playerData: [], updatedAt: at },
    { id: 'r3', faabRemaining: 60, redraftRosterId: 'rr3', playerData: [], updatedAt: at },
  ]
  state.redraftFaab = { rr1: 40, rr2: 10, rr3: 60 }
  state.settings = {}
  state.chat = []
  state.seasonUpdate = null
  wire()
})

describe('live Survivor Guilly chop — FAAB on chop', () => {
  it('"split": the chopped team\'s FAAB goes to the survivors, in both balances, and is announced after the chop', async () => {
    state.settings = { guillotineFaabOnChop: 'split' }
    await executeSGLiveChop('L1', 1)

    const faab = Object.fromEntries(state.rosters.map((r) => [r.id, r.faabRemaining]))
    expect(faab.r3).toBe(0)
    expect((faab.r1 ?? 0) + (faab.r2 ?? 0)).toBe(110)
    expect(state.redraftFaab).toEqual({ rr1: faab.r1, rr2: faab.r2, rr3: 0 })

    const snapshot = (state.seasonUpdate?.periodState as { chopSnapshot: { faabSplit: { pool: number } } }).chopSnapshot
    expect(snapshot.faabSplit).toMatchObject({ pool: 60, taken: { r3: 60 } })

    const events = state.chat.map((m) => m.metadata.event)
    expect(events.indexOf('faab_split')).toBeGreaterThan(events.indexOf('chop'))
    expect(state.chat.find((m) => m.metadata.event === 'faab_split')?.message).toContain('$60')
  })

  it('"keep" (the default): no FAAB moves and nothing is announced', async () => {
    await executeSGLiveChop('L1', 1)
    expect(state.rosters.map((r) => r.faabRemaining)).toEqual([40, 10, 60])
    expect((state.seasonUpdate?.periodState as { chopSnapshot: { faabSplit: unknown } }).chopSnapshot.faabSplit).toBeNull()
    expect(state.chat.some((m) => m.metadata.event === 'faab_split')).toBe(false)
  })
})
