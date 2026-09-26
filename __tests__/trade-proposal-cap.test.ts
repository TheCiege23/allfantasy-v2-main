import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ config: vi.fn(), viewer: vi.fn(), team: vi.fn(), roster: vi.fn(), teamRoster: vi.fn(), contracts: vi.fn(), validate: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueTeam: { findFirst: m.team }, roster: { findFirst: m.roster }, playerContract: { findMany: m.contracts } } }))
vi.mock('@/lib/salary-cap/SalaryCapLeagueConfig', () => ({ getSalaryCapConfig: m.config }))
vi.mock('@/lib/salary-cap/SalaryCapTradeValidator', () => ({ validateTradeCap: m.validate }))
vi.mock('@/lib/trade-intel/viewerLeagueRoster', () => ({ resolveViewerLeagueRoster: m.viewer }))
vi.mock('@/lib/leagues/rosterForTeam', () => ({ findRosterForTeam: m.teamRoster }))
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
  m.teamRoster.mockResolvedValue({ id: 'roster-two', matchedBy: 'source_manager_id', playerData: {} })
  m.contracts.mockResolvedValue([contract])
  m.validate.mockResolvedValue(impact)
})
describe('proposal affordability', () => {
  it('uses the durable opponent-roster join when that manager has linked an AllFantasy account', async () => {
    m.teamRoster.mockResolvedValue({ id: 'linked-opponent-roster', matchedBy: 'source_manager_id', playerData: {} })
    m.contracts.mockResolvedValue([contract, { ...contract, id: 'other-contract', rosterId: 'linked-opponent-roster', playerId: 'p2', playerName: 'Incoming Player' }])
    expect(await (await prepareProposalCap(args))(give, [{ kind: 'player', name: 'Incoming Player' }])).toMatchObject({ status: 'evaluated', legal: true })
    expect(m.teamRoster).toHaveBeenCalledWith('league', 'platform-two')
    expect(m.validate.mock.calls[0][1].toRosterId).toBe('linked-opponent-roster')
  })
  it('resolves provider IDs by an exact owned name and uses stored contract terms', async () => {
    const evaluate = await prepareProposalCap(args)
    const result = await evaluate(give, [])
    expect(result).toMatchObject({ status: 'evaluated', legal: true, contracts: [{ salary: 30, expires: 2027 }] })
    expect(proposalCapNote(result)).toBeNull()
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
  it('does not treat a labeled salary-cap league with missing rules as an ordinary league', async () => {
    m.config.mockResolvedValue(null)
    expect(await (await prepareProposalCap({ ...args, requiresCap: true }))(give, []))
      .toMatchObject({ status: 'unavailable', reason: expect.stringContaining('marked Salary Cap') })
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
