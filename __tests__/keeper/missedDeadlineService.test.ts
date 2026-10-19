import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => {
  const state = {
    league: {} as Record<string, unknown>,
    rosters: [] as Array<{ id: string; players: Array<Record<string, unknown>> }>,
    records: [] as Array<{ rosterId: string; playerId?: string }>,
    marks: [] as Array<{ metadata: unknown }>,
    eligibility: [] as Array<Record<string, unknown>>,
  }
  const prisma = {
    league: { findFirst: vi.fn(async () => state.league) },
    redraftRoster: { findMany: vi.fn(async () => state.rosters) },
    keeperRecord: {
      findMany: vi.fn(async () => state.records),
      create: vi.fn(async ({ data }: { data: { rosterId: string; playerId: string } }) => { state.records.push(data); return data }),
    },
    leagueAuditLog: { findMany: vi.fn(async () => state.marks), create: vi.fn(async () => ({})) },
    keeperEligibility: { findMany: vi.fn(async () => state.eligibility) },
    draftSession: { findFirst: vi.fn(async () => ({ rounds: 15 })) },
  }
  return { state, prisma }
})
const gate = vi.hoisted(() => vi.fn(async () => ({ allowed: true })))
const chart = vi.hoisted(() => vi.fn())
const recompute = vi.hoisted(() => vi.fn(async () => []))
vi.mock('@/lib/prisma', () => ({ prisma: db.prisma }))
vi.mock('@/lib/subscription/FeatureGateService', () => ({ FeatureGateService: class { evaluateUserFeatureAccess = gate } }))
vi.mock('@/lib/fantasycalc-db', () => ({ getFantasyCalcValuesDbFirst: chart }))
vi.mock('@/lib/keeper/eligibilityEngine', () => ({ computeKeeperEligibility: recompute }))

import { applyMissedDeadlineRule } from '@/lib/keeper/missedDeadlineService'

const player = (playerId: string, playerName: string) => ({ playerId, playerName, position: 'WR', team: 'X', sport: 'NFL', acquisitionType: 'drafted', droppedAt: null })
const fc = (sleeperId: string, name: string, overallRank: number) => ({ player: { sleeperId, name, position: 'WR' }, overallRank })

beforeEach(() => {
  vi.clearAllMocks()
  gate.mockResolvedValue({ allowed: true })
  db.state.league = { id: 'L', userId: 'commish', sport: 'NFL', leagueSize: 12, keeperCount: 2, keeperMissedDeadlineRule: 'auto_best_value', keeperCostSystem: 'round_based', keeperRoundPenalty: 1, keeperConflictRule: 'player_chooses', settings: {} }
  db.state.rosters = [
    { id: 'silent', players: [player('p1', 'Star Guy'), player('p2', 'Bust Guy'), player('p3', 'Name Match')] },
    { id: 'answered', players: [player('p9', 'Other')] },
    { id: 'choseNone', players: [player('p8', 'Ignored')] },
  ]
  db.state.records = [{ rosterId: 'answered', playerId: 'p9' }]
  db.state.marks = [{ metadata: { rosterId: 'choseNone' } }]
  db.state.eligibility = [
    { rosterId: 'silent', playerId: 'p1', isEligible: true, projectedCostRound: 9 },
    { rosterId: 'silent', playerId: 'p2', isEligible: true, projectedCostRound: 3 },
    { rosterId: 'silent', playerId: 'p3', isEligible: true, projectedCostRound: 7 },
    { rosterId: 'choseNone', playerId: 'p8', isEligible: true, projectedCostRound: 12 },
  ]
  chart.mockResolvedValue([fc('p1', 'Star Guy', 10), fc('xx', 'Bust Guy', 80), fc('zz', 'Name Match', 30), fc('p8', 'Ignored', 1)])
})

describe('applying the missed-deadline rule at lock', () => {
  it('keeps best value only for the team that said nothing, as pending records, and audits it', async () => {
    const out = await applyMissedDeadlineRule('L', 'S')
    expect(out.skippedReason).toBeNull()
    expect(out.applied.map((a) => [a.rosterId, a.keepers.map((k) => k.playerId)])).toEqual([['silent', ['p1', 'p3']]])
    expect(db.prisma.keeperRecord.create).toHaveBeenCalledTimes(2)
    expect(db.prisma.keeperRecord.create.mock.calls[0][0].data).toMatchObject({ seasonId: 'S', rosterId: 'silent', playerId: 'p1', status: 'pending', costRound: 9 })
    expect(db.prisma.keeperRecord.create.mock.calls[0][0].data.costLabel).toContain('kept by AF')
    expect(db.prisma.leagueAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actionType: 'keeper_missed_deadline_applied' }) }))
  })

  it('"keeps nobody" (the default) writes nothing', async () => {
    db.state.league.keeperMissedDeadlineRule = 'auto_no_keepers'
    expect(await applyMissedDeadlineRule('L', 'S')).toMatchObject({ rule: 'auto_no_keepers', applied: [] })
    expect(db.prisma.keeperRecord.create).not.toHaveBeenCalled()
    expect(chart).not.toHaveBeenCalled()
  })

  it('a lapsed plan or a sport without market values falls back to no keepers, and says why', async () => {
    gate.mockResolvedValue({ allowed: false })
    expect(await applyMissedDeadlineRule('L', 'S')).toMatchObject({ applied: [], skippedReason: 'not_entitled' })
    gate.mockResolvedValue({ allowed: true })
    db.state.league.sport = 'NBA'
    expect(await applyMissedDeadlineRule('L', 'S')).toMatchObject({ applied: [], skippedReason: 'no_market_values' })
    expect(db.prisma.keeperRecord.create).not.toHaveBeenCalled()
  })

  it('a record that lands first (a late submission racing the lock) wins', async () => {
    db.prisma.keeperRecord.create.mockRejectedValueOnce(new Error('unique'))
    const out = await applyMissedDeadlineRule('L', 'S')
    expect(out.applied[0].keepers.map((k) => k.playerId)).toEqual(['p3'])
  })
})
