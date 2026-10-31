import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  draftFact: { findMany: vi.fn() },
  roster: { findMany: vi.fn() },
  leagueTeam: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const access = vi.hoisted(() => vi.fn(async (_u: string, _f: string) => ({ allowed: true })))
vi.mock('@/lib/subscription/FeatureGateService', () => ({ FeatureGateService: class { evaluateUserFeatureAccess = access } }))
vi.mock('@/lib/roster/resolvePlayerNames', () => ({ resolvePlayerNamesForSport: vi.fn(async () => new Map([['p1', 'Puka']])) }))

import { readImportedKeeperGrid } from '@/lib/import-assist/keeperGridService'

const league = (over: Record<string, unknown> = {}) => ({
  userId: 'owner', platform: 'sleeper', sport: 'NFL', leagueType: 'keeper', settings: {},
  keeperCostSystem: 'round_based', keeperRoundPenalty: 0, keeperInflationRate: 1, keeperConflictRule: 'player_chooses', keeperWaiverAllowed: true, keeperMaxYears: 3,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  access.mockResolvedValue({ allowed: true })
  db.draftFact.findMany.mockResolvedValue([{ playerId: 'p1', season: 2026, round: 5, metadata: { isKeeper: true } }, { playerId: 'x', season: 2026, round: 12, metadata: null }])
  db.roster.findMany.mockResolvedValue([{ id: 'r1', platformUserId: 'u1', playerData: { players: ['p1'], starters: [] } }])
  db.leagueTeam.findMany.mockResolvedValue([{ externalId: 'u1', teamName: 'Gridiron Ghosts', ownerName: 'carl' }])
})

describe('readImportedKeeperGrid', () => {
  it('imported keeper league: grid, steps and chat text from the DB only', async () => {
    db.league.findUnique.mockResolvedValue(league())
    const v = await readImportedKeeperGrid('L1', 'owner')
    if (!v.applies || v.locked) throw new Error('expected a grid')
    expect(v.grid!.teams[0]).toMatchObject({ name: 'Gridiron Ghosts', players: [{ name: 'Puka', costRound: 5, keptThisSeason: true }] })
    expect(v.steps.length).toBeGreaterThan(0)
    expect(v.shareText).toMatch(/Puka: Round 5, kept 1x/)
  })
  it('does not apply to native or non-keeper leagues', async () => {
    db.league.findUnique.mockResolvedValue(league({ platform: 'allfantasy' }))
    expect(await readImportedKeeperGrid('L1', 'owner')).toEqual({ applies: false, reason: 'native' })
    db.league.findUnique.mockResolvedValue(league({ leagueType: 'redraft' }))
    expect(await readImportedKeeperGrid('L1', 'owner')).toEqual({ applies: false, reason: 'not_keeper' })
    expect(db.draftFact.findMany).not.toHaveBeenCalled()
  })
  it('AF Commissioner: locked unless the head commissioner or the viewer has it', async () => {
    db.league.findUnique.mockResolvedValue(league())
    access.mockResolvedValue({ allowed: false })
    expect(await readImportedKeeperGrid('L1', 'cocommish')).toEqual({ applies: true, locked: true, platform: 'sleeper' })
    expect(db.draftFact.findMany).not.toHaveBeenCalled()
    access.mockImplementation(async (u: string) => ({ allowed: u === 'owner' }))
    const v = await readImportedKeeperGrid('L1', 'cocommish')
    expect(v.applies && !v.locked).toBe(true)
  })
  it('says so when no draft is on file', async () => {
    db.league.findUnique.mockResolvedValue(league())
    db.draftFact.findMany.mockResolvedValue([])
    const v = await readImportedKeeperGrid('L1', 'owner')
    expect(v.applies && !v.locked && v.grid).toBeNull()
    expect(v.applies && !v.locked && v.note).toMatch(/No imported draft/)
  })
})
