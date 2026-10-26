/** Anti-tanking penalties, end to end over mocks: warning on a flag, strike then lost pick on confirmation. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({
  flag: vi.fn(),
  strikes: vi.fn(),
  upsert: vi.fn(async () => ({})),
  notify: vi.fn(async () => ({})),
  log: vi.fn(async () => ({ id: 'a' })),
  inventory: vi.fn(),
  settings: {} as Record<string, unknown>,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    integrityFlag: { findUnique: m.flag, count: m.strikes },
    redraftSeason: { findFirst: vi.fn(async () => ({ createdAt: new Date('2026-08-01') })) },
    roster: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ platformUserId: where.id === 'orphan-team' ? 'orphan-x' : `user-${where.id}` })) },
    appUser: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ futureDraftPick: { upsert: m.upsert } })),
  },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.notify }))
vi.mock('@/server/services/auditService', () => ({ logAction: m.log }))
vi.mock('@/lib/league-trade-engine/nativeFuturePicks', () => ({ loadNativeFuturePicks: m.inventory }))

import { onTankingFlagConfirmed, onTankingFlagOpened, TANKING_PICK_FORFEITED_ACTION } from '@/lib/integrity/tankingPenaltyService'

const flagRow = (status: string, rosters = ['r1']) => ({ leagueId: 'L', flagType: 'tanking', status, affectedRosterIds: rosters, league: { settings: m.settings } })
const pick = (season: number, round: number, owner: string, original: string) => ({ season, round, ownerTeamId: owner, originalTeamId: original, source: 'own' })

beforeEach(() => {
  vi.clearAllMocks()
  m.settings = {}
  m.inventory.mockResolvedValue({ picks: [pick(2027, 1, 'r1', 'r1'), pick(2027, 2, 'r1', 'r1')] })
})

describe('a flag is opened', () => {
  it('the manager is warned privately, with what a confirmed case would cost — and nothing is taken', async () => {
    m.flag.mockResolvedValue(flagRow('open'))
    m.strikes.mockResolvedValue(1)
    await onTankingFlagOpened('f1')
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['user-r1'], category: 'league_announcements', body: expect.stringContaining('If it is confirmed, your team loses a draft pick') }))
    expect(m.upsert).not.toHaveBeenCalled()
  })

  it('says nothing when the commissioner turned penalties off', async () => {
    m.settings = { integrity_tanking_penalties: { enabled: false } }
    m.flag.mockResolvedValue(flagRow('open'))
    await onTankingFlagOpened('f1')
    expect(m.notify).not.toHaveBeenCalled()
  })
})

describe('the commissioner confirms a flag', () => {
  it('the first strike is an official warning, and no pick is taken', async () => {
    m.flag.mockResolvedValue(flagRow('escalated'))
    m.strikes.mockResolvedValue(1)
    const r = await onTankingFlagConfirmed('f1', 'commish')
    expect(r).toEqual([{ rosterId: 'r1', step: { kind: 'warning', strike: 1, strikesLeft: 1 } }])
    expect(m.upsert).not.toHaveBeenCalled()
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Official warning: tanking' }))
  })

  it('the second strike takes the team’s own 1st-round pick, and logs and tells the manager', async () => {
    m.flag.mockResolvedValue(flagRow('escalated'))
    m.strikes.mockResolvedValue(2)
    const r = await onTankingFlagConfirmed('f1', 'commish')
    expect(r[0]).toMatchObject({ step: { kind: 'forfeit_pick' }, forfeited: { season: 2027, round: 1, label: '2027 1st-round pick' } })
    expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { leagueId_pickSeason_round_originalRosterId: { leagueId: 'L', pickSeason: 2027, round: 1, originalRosterId: 'r1' } },
      update: expect.objectContaining({ status: 'forfeited', currentOwnerId: 'r1' }),
    }))
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: TANKING_PICK_FORFEITED_ACTION, entityId: 'r1' }))
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Draft pick forfeited for tanking' }))
  })

  it('a team with no pick to lose is still struck, and the commissioner decides the penalty', async () => {
    m.flag.mockResolvedValue(flagRow('escalated'))
    m.strikes.mockResolvedValue(2)
    m.inventory.mockResolvedValue({ picks: [] })
    const r = await onTankingFlagConfirmed('f1', 'commish')
    expect(r[0]).toMatchObject({ forfeited: null })
    expect(m.upsert).not.toHaveBeenCalled()
  })

  it('does nothing for a flag that is not a confirmed tanking flag', async () => {
    m.flag.mockResolvedValue({ ...flagRow('escalated'), flagType: 'collusion' })
    expect(await onTankingFlagConfirmed('f1', 'commish')).toEqual([])
    m.flag.mockResolvedValue(flagRow('dismissed'))
    expect(await onTankingFlagConfirmed('f1', 'commish')).toEqual([])
  })

  it('an abandoned team (orphan seat) is penalised but nobody is messaged', async () => {
    m.flag.mockResolvedValue(flagRow('escalated', ['orphan-team']))
    m.strikes.mockResolvedValue(1)
    await onTankingFlagConfirmed('f1', 'commish')
    expect(m.notify).not.toHaveBeenCalled()
  })
})
