import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ config: vi.fn(), contracts: vi.fn(), league: vi.fn(), ledger: vi.fn(), hits: vi.fn(), teams: vi.fn(), rosters: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: mocks.league },
  playerContract: { findMany: mocks.contracts }, salaryCapTeamLedger: { findUnique: mocks.ledger },
  leagueTeam: { findMany: mocks.teams }, roster: { findMany: mocks.rosters } } }))
vi.mock('@/lib/salary-cap/SalaryCapLeagueConfig', () => ({ getSalaryCapConfig: mocks.config }))
vi.mock('@/lib/salary-cap/CapCalculationService', () => ({ getTotalCapHitForRoster: mocks.hits,
  getEffectiveCap: (_config: unknown, _year: number, rollover: number) => 100 + rollover }))
import { validateTradeCap } from '@/lib/salary-cap/SalaryCapTradeValidator'

const contract = { id: 'c', rosterId: 'from', playerId: 'p', salary: 30, yearSigned: 2026,
  yearsTotal: 2, status: 'active', deadMoneyRemaining: null }
const input = { fromRosterId: 'from', toRosterId: 'to', movingToReceiver: [{ playerId: 'p', salary: 1 }], movingToSender: [] }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.config.mockResolvedValue({ configId: 'cfg', capFloorEnabled: false })
  mocks.league.mockResolvedValue({ season: 2026 })
  mocks.contracts.mockResolvedValue([contract])
  mocks.teams.mockResolvedValue([{ id: 'from', externalId: '1' }, { id: 'to', externalId: '2' }])
  mocks.rosters.mockResolvedValue([])
  mocks.ledger.mockResolvedValue(null)
  mocks.hits.mockImplementation(async (_config: string, roster: string) => ({ totalCapHit: roster === 'from' ? 30 : 50, deadMoneyHit: 0 }))
})
describe('salary cap trade validation', () => {
  it('withholds legality for a roster from another league', async () => {
    mocks.teams.mockResolvedValue([{ id: 'from', externalId: '1' }])
    expect((await validateTradeCap('league', input)).errors).toEqual(['Both rosters must belong to this league'])
    expect(mocks.hits).not.toHaveBeenCalled()
  })
  it('uses owned contract salary rather than the submitted amount and remains read only', async () => {
    const result = await validateTradeCap('league', input)
    expect(result.toCapHitDelta).toBe(30)
    expect(result.years?.[0].toCapHit).toBe(80)
    expect(result.toFutureLegal).toBe(true)
  })
  it('rejects a future over-cap year even when the present trade is legal', async () => {
    mocks.hits.mockImplementation(async (_config: string, roster: string, year: number) => ({
      totalCapHit: roster === 'from' ? 30 : year === 2027 ? 80 : 50, deadMoneyHit: 0 }))
    const result = await validateTradeCap('league', input)
    expect(result.toLegal).toBe(true)
    expect(result.toFutureLegal).toBe(false)
    expect(result.errors).toContain('Receiver would be over cap or under floor in 2027')
  })
  it('stops transferring salary after the traded contract expires', async () => {
    mocks.contracts.mockResolvedValue([{ ...contract, yearsTotal: 1 }, { ...contract, id: 'other', playerId: 'other', rosterId: 'to' }])
    const result = await validateTradeCap('league', input)
    expect(result.years?.[1].toCapHit).toBe(50)
  })
  it.each(['foreign', 'duplicate', 'expired', 'mismatched'])('withholds legality for %s contracts', async (kind) => {
    let proposal = input
    if (kind === 'foreign') mocks.contracts.mockResolvedValue([{ ...contract, rosterId: 'to' }])
    if (kind === 'expired') mocks.contracts.mockResolvedValue([{ ...contract, yearSigned: 2024, yearsTotal: 1 }])
    if (kind === 'duplicate') proposal = { ...input, movingToReceiver: [...input.movingToReceiver, ...input.movingToReceiver] }
    if (kind === 'mismatched') proposal = { ...input, movingToReceiver: [{ playerId: 'other', salary: 1 }] }
    const result = await validateTradeCap('league', proposal)
    expect(result.fromLegal).toBe(false)
    expect(result.toFutureLegal).toBe(false)
    expect(mocks.hits).not.toHaveBeenCalled()
  })
  it('checks future dead money even after the active contract expires', async () => {
    mocks.contracts.mockResolvedValue([{ ...contract, yearsTotal: 1 }, { ...contract, id: 'cut', status: 'cut', deadMoneyRemaining: { '2028': 120 } }])
    mocks.hits.mockImplementation(async (_config: string, roster: string, year: number) => ({
      totalCapHit: roster === 'from' && year === 2026 ? 30 : 0, deadMoneyHit: year === 2028 && roster === 'to' ? 120 : 0 }))
    expect((await validateTradeCap('league', input)).toFutureLegal).toBe(false)
  })
})
