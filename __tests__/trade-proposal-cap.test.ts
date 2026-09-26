import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ config: vi.fn(), viewer: vi.fn(), team: vi.fn(), roster: vi.fn(), contracts: vi.fn(), validate: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueTeam: { findFirst: m.team }, roster: { findFirst: m.roster }, playerContract: { findMany: m.contracts } } }))
vi.mock('@/lib/salary-cap/SalaryCapLeagueConfig', () => ({ getSalaryCapConfig: m.config }))
vi.mock('@/lib/salary-cap/SalaryCapTradeValidator', () => ({ validateTradeCap: m.validate }))
vi.mock('@/lib/trade-intel/viewerLeagueRoster', () => ({ resolveViewerLeagueRoster: m.viewer }))
import { prepareProposalCap, proposalCapNote } from '@/lib/trade-value-console/proposalCap'
const args = { leagueId: 'league', userId: 'user', opponentTeamExternalId: '2' }
const give = [{ kind: 'player' as const, name: 'Player One', playerId: 'other-provider-id' }]
const contract = { id: 'contract', rosterId: 'roster-one', playerId: 'stored-player', playerName: 'Player One', salary: 30, yearsTotal: 2, yearSigned: 2026, status: 'active' }
const impact = { fromFutureLegal: true, toFutureLegal: true, errors: [], years: [{ capYear: 2026, fromLegal: true, toLegal: true }] }
beforeEach(() => {
  vi.clearAllMocks()
  m.config.mockResolvedValue({ configId: 'config', season: 2026 })
  m.viewer.mockResolvedValue({ ok: true, team: { platformUserId: 'platform-one', externalId: '1' }, roster: { id: 'roster-one' } })
  m.team.mockImplementation(async ({ where }) => where.externalId === '2'
    ? { id: 'team-two', externalId: '2', platformUserId: 'platform-two' }
    : { id: 'team-one', externalId: '1', platformUserId: 'platform-one' })
  m.roster.mockImplementation(async ({ where }) => ({ id: where.platformUserId === 'user' ? 'roster-one' : 'roster-two', platformUserId: where.platformUserId }))
  m.contracts.mockResolvedValue([contract])
  m.validate.mockResolvedValue(impact)
})
describe('proposal affordability', () => {
  it('resolves provider IDs by an exact owned name and uses stored contract terms', async () => {
    const evaluate = await prepareProposalCap(args)
    expect(await evaluate(give, [])).toMatchObject({ status: 'evaluated', legal: true, contracts: [{ salary: 30, expires: 2027 }] })
    expect(m.validate).toHaveBeenCalledWith('league', { fromRosterId: 'roster-one', toRosterId: 'roster-two',
      movingToReceiver: [{ contractId: 'contract', playerId: 'stored-player', salary: 30 }], movingToSender: [] })
  })
  it.each(['expired', 'foreign', 'ambiguous'])('withholds a %s player contract', async kind => {
    m.contracts.mockResolvedValue(kind === 'expired' ? [{ ...contract, yearsTotal: 1, yearSigned: 2025 }]
      : kind === 'foreign' ? [{ ...contract, rosterId: 'roster-two' }] : [contract, { ...contract, id: 'duplicate' }])
    expect(await (await prepareProposalCap(args))(give, [])).toMatchObject({ status: 'unavailable' })
    expect(m.validate).not.toHaveBeenCalled()
  })
  it('does not guess across multiple contract roster namespaces', async () => {
    m.contracts.mockResolvedValue([contract, { ...contract, rosterId: 'team-one', id: 'duplicate' }])
    expect(await (await prepareProposalCap(args))(give, [])).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('ambiguous roster') })
  })
  it('reports the first failed commitment year', async () => {
    m.validate.mockResolvedValue({ ...impact, toFutureLegal: false, years: [...impact.years, { capYear: 2027, fromLegal: true, toLegal: false }] })
    const result = await (await prepareProposalCap(args))(give, [])
    expect(result).toMatchObject({ status: 'evaluated', legal: false })
    expect(proposalCapNote(result)).toContain('2027 for the other team')
  })
  it('leaves ordinary leagues unaffected', async () => {
    m.config.mockResolvedValue(null)
    expect(await (await prepareProposalCap(args))(give, [])).toEqual({ status: 'not_applicable' })
    expect(m.contracts).not.toHaveBeenCalled()
  })
  it('requires a counterparty and does not treat FAAB as salary cash', async () => {
    expect(await (await prepareProposalCap({ ...args, opponentTeamExternalId: null }))(give, [])).toMatchObject({ status: 'unavailable' })
    expect(await (await prepareProposalCap(args))([{ kind: 'faab', amount: 10 }], [])).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('FAAB') })
  })
  it('withholds the check when the validator or data load fails', async () => {
    m.validate.mockRejectedValue(new Error('database'))
    expect(await (await prepareProposalCap(args))(give, [])).toMatchObject({ status: 'unavailable' })
    m.config.mockRejectedValue(new Error('database'))
    expect(await (await prepareProposalCap(args))(give, [])).toMatchObject({ status: 'unavailable' })
  })
})
