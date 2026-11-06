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
/*
 * 🛑 THE REAL ID SPACES. A native tanking flag names a `RedraftRoster` ('r1'); the league's `Roster`
 * row is a different record ('gen-r1') linked by `redraftRosterId`. This mock used to return a
 * roster for ANY id, which is how the service shipped looking up the flag's id in the wrong table —
 * no warning sent, no pick or FAAB ever found — with this suite green.
 */
const { findRoster } = vi.hoisted(() => {
  const ROSTERS = [
    { id: 'gen-r1', redraftRosterId: 'r1', platformUserId: 'user-r1' },
    { id: 'gen-orphan', redraftRosterId: 'orphan-team', platformUserId: 'orphan-x' },
  ]
  type RosterWhere = { leagueId: string; OR: Array<{ id?: string; redraftRosterId?: string }> }
  const findRoster = async ({ where }: { where: RosterWhere }) =>
    ROSTERS.find((r) => where.OR.some((c) => (c.id != null && c.id === r.id) || (c.redraftRosterId != null && c.redraftRosterId === r.redraftRosterId))) ?? null
  return { findRoster }
})
vi.mock('@/lib/prisma', () => ({
  prisma: {
    integrityFlag: { findUnique: m.flag, count: m.strikes },
    redraftSeason: { findFirst: vi.fn(async () => ({ createdAt: new Date('2026-08-01') })) },
    roster: { findFirst: vi.fn(findRoster) },
    redraftRoster: { findFirst: vi.fn(async () => null) },
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
  // The pick inventory is keyed on `Roster.id`, never the flag's redraft id.
  m.inventory.mockResolvedValue({ picks: [pick(2027, 1, 'gen-r1', 'gen-r1'), pick(2027, 2, 'gen-r1', 'gen-r1')] })
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
      where: { leagueId_pickSeason_round_originalRosterId: { leagueId: 'L', pickSeason: 2027, round: 1, originalRosterId: 'gen-r1' } },
      update: expect.objectContaining({ status: 'forfeited', currentOwnerId: 'gen-r1' }),
    }))
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: TANKING_PICK_FORFEITED_ACTION, entityId: 'gen-r1' }))
    // The manager is found through the link too.
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['user-r1'] }))
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

describe('an imported league', () => {
  // Its picks and managers live on the host platform: a flag is the commissioner's finding, nothing more.
  const imported = (status: string) => ({ ...flagRow(status), league: { settings: m.settings, platform: 'sleeper' } })

  it('opening a flag sends no warning that promises a pick penalty', async () => {
    m.flag.mockResolvedValue(imported('open'))
    m.strikes.mockResolvedValue(0)
    await onTankingFlagOpened('f1')
    expect(m.notify).not.toHaveBeenCalled()
    expect(m.log).not.toHaveBeenCalled()
  })

  it('confirming a flag takes no pick and records no strike', async () => {
    m.flag.mockResolvedValue(imported('escalated'))
    m.strikes.mockResolvedValue(2)
    expect(await onTankingFlagConfirmed('f1', 'commish')).toEqual([])
    expect(m.upsert).not.toHaveBeenCalled()
    expect(m.notify).not.toHaveBeenCalled()
  })
})
