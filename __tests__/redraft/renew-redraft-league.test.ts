import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * One renew for a redraft league: roster reset + next RedraftSeason + next draft with a
 * commissioner-chosen order, in one transaction. Before this, renew cleared `Roster.playerData`
 * and nothing else, and the next draft was a separate `create_next_draft` action that always
 * used the league's default order — the `prev_standings` / `worst_to_first` settings were saved
 * but nothing computed them.
 */

const m = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  draftSessionFindFirst: vi.fn(),
  seasonFindMany: vi.fn(),
  rosterFindMany: vi.fn(),
  redraftRosterFindMany: vi.fn(),
  leagueSettingsFindUnique: vi.fn(),
  // transaction
  txDraftSessionFindFirst: vi.fn(),
  txDraftSessionCreate: vi.fn(),
  txRosterUpdateMany: vi.fn(),
  txLineupDeleteMany: vi.fn(),
  txLockDeleteMany: vi.fn(),
  txWaiverUpdateMany: vi.fn(),
  txRedraftWaiverUpdateMany: vi.fn(),
  txAfTradeUpdateMany: vi.fn(),
  txProposalUpdateMany: vi.fn(),
  txLegacyTradeUpdateMany: vi.fn(),
  txRosterPlayerDeleteMany: vi.fn(),
  txLeagueUpdate: vi.fn(),
  txLeagueSettingsUpdateMany: vi.fn(),
  transaction: vi.fn(),
  buildSlotOrder: vi.fn(),
  ensureShell: vi.fn(),
  finalists: vi.fn(),
  logAction: vi.fn(),
}))

const tx = {
  draftSession: { findFirst: m.txDraftSessionFindFirst, create: m.txDraftSessionCreate },
  roster: { updateMany: m.txRosterUpdateMany },
  afRosterLineupAssignment: { deleteMany: m.txLineupDeleteMany },
  afLineupLockState: { deleteMany: m.txLockDeleteMany },
  waiverClaim: { updateMany: m.txWaiverUpdateMany },
  redraftWaiverClaim: { updateMany: m.txRedraftWaiverUpdateMany },
  afLeagueTrade: { updateMany: m.txAfTradeUpdateMany },
  redraftTradeProposal: { updateMany: m.txProposalUpdateMany },
  redraftLeagueTrade: { updateMany: m.txLegacyTradeUpdateMany },
  redraftRosterPlayer: { deleteMany: m.txRosterPlayerDeleteMany },
  league: { update: m.txLeagueUpdate },
  leagueSettings: { updateMany: m.txLeagueSettingsUpdateMany },
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: m.leagueFindUnique },
    draftSession: { findFirst: m.draftSessionFindFirst },
    redraftSeason: { findMany: m.seasonFindMany },
    roster: { findMany: m.rosterFindMany },
    redraftRoster: { findMany: m.redraftRosterFindMany },
    leagueSettings: { findUnique: m.leagueSettingsFindUnique },
    $transaction: m.transaction,
  },
}))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ buildSlotOrderForLeague: m.buildSlotOrder }))
vi.mock('@/lib/redraft/offseason/ensureNextRedraftSeasonShell', () => ({ ensureNextRedraftSeasonShell: m.ensureShell }))
vi.mock('@/lib/live-draft-engine/createNextLeagueDraft', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/live-draft-engine/createNextLeagueDraft')>()),
  championAndRunnerUp: m.finalists,
}))
vi.mock('@/server/services/auditService', () => ({ logAction: m.logAction }))

import {
  buildRenewalSlotOrder,
  draftOrderMethodForRenewMode,
  renewRedraftLeague,
  resolveRenewDraftOrderMode,
} from '@/lib/redraft/offseason/renewRedraftLeague'

const completedDraft = {
  id: 'draft-1',
  status: 'completed',
  rounds: 15,
  teamCount: 4,
  draftType: 'snake',
  thirdRoundReversal: false,
  timerSeconds: 90,
  aiAutoPick: false,
  cpuAutoPick: true,
  alphabeticalSort: false,
  sportType: 'NFL',
  auctionBudgetPerTeam: null,
  onClockTradeTimerBehavior: 'inherit_remaining',
  inDraftPlayerTradesEnabled: true,
  customRankingsEnabled: true,
}

const draftRosters = [
  { id: 'R-a', platformUserId: 'user-a' },
  { id: 'R-b', platformUserId: 'user-b' },
  { id: 'R-c', platformUserId: 'user-c' },
  { id: 'R-d', platformUserId: 'orphan-d' },
]
const defaultSlots = draftRosters.map((r, i) => ({ slot: i + 1, rosterId: r.id, displayName: `Team ${r.id.slice(2).toUpperCase()}` }))

// Last season: b worst (2-11), d (orphan, 5-8), c lost the final, a won the title.
const lastSeason = [
  { id: 's-a', ownerId: 'user-a', wins: 9, losses: 4, ties: 0, pointsFor: 1500 },
  { id: 's-b', ownerId: 'user-b', wins: 2, losses: 11, ties: 0, pointsFor: 1100 },
  { id: 's-c', ownerId: 'user-c', wins: 10, losses: 3, ties: 0, pointsFor: 1600 },
  { id: 's-d', ownerId: 'roster:R-d', wins: 5, losses: 8, ties: 0, pointsFor: 1300 },
]

function league(overrides: Record<string, unknown> = {}) {
  return {
    id: 'L1',
    sport: 'NFL',
    platform: 'manual',
    leagueType: 'redraft',
    isDynasty: false,
    waiverBudget: 100,
    lifecycleState: 'offseason',
    lifecycleMetadata: {},
    settings: {},
    ...overrides,
  }
}

const slotIds = () => m.txDraftSessionCreate.mock.calls[0]![0].data.slotOrder.map((e: { rosterId: string }) => e.rosterId)

beforeEach(() => {
  vi.clearAllMocks()
  m.leagueFindUnique.mockResolvedValue(league())
  m.draftSessionFindFirst.mockResolvedValue(completedDraft)
  m.seasonFindMany.mockResolvedValue([{ id: 'season-1', season: 2026, status: 'complete' }])
  m.rosterFindMany.mockResolvedValue(draftRosters)
  m.redraftRosterFindMany.mockResolvedValue(lastSeason)
  m.leagueSettingsFindUnique.mockResolvedValue(null)
  m.finalists.mockResolvedValue({ championId: 's-a', runnerUpId: 's-c' })
  m.buildSlotOrder.mockResolvedValue(defaultSlots)
  m.ensureShell.mockResolvedValue({ id: 'season-2', season: 2027 })
  m.transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx))
  m.txDraftSessionFindFirst.mockResolvedValue(null)
  m.txDraftSessionCreate.mockResolvedValue({ id: 'draft-2' })
  for (const fn of [
    m.txRosterUpdateMany,
    m.txLineupDeleteMany,
    m.txLockDeleteMany,
    m.txWaiverUpdateMany,
    m.txRedraftWaiverUpdateMany,
    m.txAfTradeUpdateMany,
    m.txProposalUpdateMany,
    m.txLegacyTradeUpdateMany,
    m.txRosterPlayerDeleteMany,
    m.txLeagueSettingsUpdateMany,
  ]) {
    fn.mockResolvedValue({ count: 1 })
  }
  m.txRosterUpdateMany.mockResolvedValue({ count: 4 })
  m.txLeagueUpdate.mockResolvedValue({})
  m.logAction.mockResolvedValue({ id: 'audit' })
})

describe('draft order modes map onto the existing draftOrderMethod values', () => {
  it('accepts the new names and the saved setting names alike', () => {
    expect(resolveRenewDraftOrderMode('random')).toBe('random')
    expect(resolveRenewDraftOrderMode('randomized')).toBe('random')
    expect(resolveRenewDraftOrderMode('standings')).toBe('standings')
    expect(resolveRenewDraftOrderMode('worst_to_first')).toBe('standings')
    expect(resolveRenewDraftOrderMode('reverse_standings')).toBe('reverse_standings')
    expect(resolveRenewDraftOrderMode('prev_standings')).toBe('reverse_standings')
    expect(resolveRenewDraftOrderMode('manual')).toBe('manual')
    expect(resolveRenewDraftOrderMode('reverse_max_pf')).toBeNull()
    expect(resolveRenewDraftOrderMode(undefined)).toBeNull()
  })

  it('writes back the value LeagueSettings already understands', () => {
    expect(draftOrderMethodForRenewMode('random')).toBe('randomized')
    expect(draftOrderMethodForRenewMode('standings')).toBe('worst_to_first')
    expect(draftOrderMethodForRenewMode('reverse_standings')).toBe('prev_standings')
    expect(draftOrderMethodForRenewMode('manual')).toBe('manual')
  })
})

describe('buildRenewalSlotOrder', () => {
  const teams = defaultSlots.map(({ rosterId, displayName }) => ({ rosterId, displayName }))
  const worstToFirst = ['R-b', 'R-d', 'R-c', 'R-a']

  it('standings: worst to first, champion last', () => {
    const r = buildRenewalSlotOrder({ mode: 'standings', teams, worstToFirst })
    expect(r.ok && r.slotOrder.map((e) => e.rosterId)).toEqual(['R-b', 'R-d', 'R-c', 'R-a'])
    expect(r.ok && r.slotOrder.map((e) => e.slot)).toEqual([1, 2, 3, 4])
    expect(r.ok && r.slotOrder[0]!.displayName).toBe('Team B')
  })

  it('reverse standings: champion first', () => {
    const r = buildRenewalSlotOrder({ mode: 'reverse_standings', teams, worstToFirst })
    expect(r.ok && r.slotOrder.map((e) => e.rosterId)).toEqual(['R-a', 'R-c', 'R-d', 'R-b'])
  })

  it('standings that do not cover every team are refused rather than padded', () => {
    const r = buildRenewalSlotOrder({ mode: 'standings', teams, worstToFirst: ['R-b', 'R-c', 'R-a'] })
    expect(r).toMatchObject({ ok: false, code: 'STANDINGS_UNAVAILABLE' })
  })

  it('random: a permutation of exactly the league’s teams, driven by the injected source', () => {
    const seq = [0.9, 0.1, 0.5]
    let i = 0
    const r = buildRenewalSlotOrder({ mode: 'random', teams, random: () => seq[i++ % seq.length]! })
    expect(r.ok).toBe(true)
    const ids = r.ok ? r.slotOrder.map((e) => e.rosterId) : []
    expect([...ids].sort()).toEqual(['R-a', 'R-b', 'R-c', 'R-d'])
    // Fisher-Yates with that sequence moves teams; it is not the identity order.
    expect(ids).not.toEqual(['R-a', 'R-b', 'R-c', 'R-d'])
  })

  it('manual: the commissioner’s exact order', () => {
    const r = buildRenewalSlotOrder({ mode: 'manual', teams, manualOrder: ['R-c', 'R-a', 'R-d', 'R-b'] })
    expect(r.ok && r.slotOrder.map((e) => e.rosterId)).toEqual(['R-c', 'R-a', 'R-d', 'R-b'])
  })

  it.each([
    ['missing a team', ['R-c', 'R-a', 'R-d']],
    ['a duplicate', ['R-c', 'R-a', 'R-a', 'R-b']],
    ['a team from another league', ['R-c', 'R-a', 'R-d', 'R-zzz']],
    ['an extra team', ['R-c', 'R-a', 'R-d', 'R-b', 'R-zzz']],
    ['no list at all', undefined],
  ])('manual: refuses a list with %s', (_label, manualOrder) => {
    const r = buildRenewalSlotOrder({ mode: 'manual', teams, manualOrder: manualOrder as string[] | undefined })
    expect(r).toMatchObject({ ok: false, code: 'INVALID_MANUAL_ORDER' })
  })
})

describe('renewRedraftLeague', () => {
  it.each(['NFL', 'NBA', 'NHL', 'MLB'])('%s: resets rosters, creates the season and the draft in ONE transaction', async (sport) => {
    m.leagueFindUnique.mockResolvedValue(league({ sport, waiverBudget: 250 }))
    m.draftSessionFindFirst.mockResolvedValue({ ...completedDraft, sportType: sport })

    const r = await renewRedraftLeague('L1', 'commish', { draftOrder: 'standings' })

    expect(r).toMatchObject({ ok: true, sessionId: 'draft-2', seasonId: 'season-2', season: 2027, orderMode: 'standings' })
    expect(m.transaction).toHaveBeenCalledTimes(1)
    // The season shell is written through the SAME transaction, not a second one.
    expect(m.ensureShell).toHaveBeenCalledWith('L1', 'season-1', tx)

    // (a) roster reset: players and lineups cleared, teams/owners untouched, FAAB restored.
    expect(m.txRosterUpdateMany).toHaveBeenCalledWith({ where: { leagueId: 'L1' }, data: { playerData: {}, faabRemaining: 250 } })
    const rosterData = m.txRosterUpdateMany.mock.calls[0]![0].data
    expect(rosterData).not.toHaveProperty('platformUserId')
    expect(m.txLineupDeleteMany).toHaveBeenCalledWith({ where: { leagueId: 'L1' } })
    expect(m.txLockDeleteMany).toHaveBeenCalledWith({ where: { leagueId: 'L1' } })
    expect(m.txRosterPlayerDeleteMany).toHaveBeenCalledWith({ where: { roster: { seasonId: 'season-2' } } })
    // Waiver claims and pending trades are cancelled, not deleted, so their history stays readable.
    expect(m.txWaiverUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: 'L1', status: 'pending' }, data: expect.objectContaining({ status: 'cancelled' }) }),
    )
    expect(m.txRedraftWaiverUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: 'L1', status: 'pending' }, data: expect.objectContaining({ status: 'cancelled' }) }),
    )
    expect(m.txAfTradeUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leagueId: 'L1', status: { in: ['pending', 'scheduled'] } },
        data: expect.objectContaining({ status: 'cancelled' }),
      }),
    )
    expect(m.txProposalUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: 'L1', status: 'pending' }, data: expect.objectContaining({ status: 'cancelled' }) }),
    )
    expect(m.txLegacyTradeUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: 'L1', status: 'pending' }, data: expect.objectContaining({ status: 'cancelled' }) }),
    )

    // (b) the draft: a full redraft, last draft's settings, this sport.
    const data = m.txDraftSessionCreate.mock.calls[0]![0].data
    expect(data).toMatchObject({
      leagueId: 'L1',
      sportType: sport,
      status: 'pre_draft',
      draftType: 'snake',
      rounds: 15,
      teamCount: 4,
      playerPool: 'all',
      draftModeLabel: 'standard',
      timerSeconds: 90,
    })
    // (c) worst-to-first from last season, champion last.
    expect(slotIds()).toEqual(['R-b', 'R-d', 'R-c', 'R-a'])
    expect(m.finalists).toHaveBeenCalledWith('season-1')

    // The league leaves the offseason with a marker that makes a second renew detectable.
    expect(m.txLeagueUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'L1' },
        data: expect.objectContaining({
          lifecycleState: 'pre_draft',
          lifecycleMetadata: expect.objectContaining({ renewedIntoSeason: 2027, nextDraftCreated: 'draft-2' }),
        }),
      }),
    )
    // The saved order setting is the existing value, not a parallel enum.
    expect(m.txLeagueSettingsUpdateMany).toHaveBeenCalledWith({ where: { leagueId: 'L1' }, data: { draftOrderMethod: 'worst_to_first' } })
  })

  it("FAAB 'carry_over' (lib/waiver-wire/faab-rollover.ts): balances are kept; only a team with none gets the budget", async () => {
    m.leagueFindUnique.mockResolvedValue(league({ waiverBudget: 250, waiverSettings: { waiverEngineConfig: { faab_rollover_rule: 'carry_over' } } }))
    const r = await renewRedraftLeague('L1', 'commish', { draftOrder: 'standings' })
    expect(r).toMatchObject({ ok: true })
    expect(m.txRosterUpdateMany).toHaveBeenNthCalledWith(1, { where: { leagueId: 'L1' }, data: { playerData: {} } })
    expect(m.txRosterUpdateMany).toHaveBeenNthCalledWith(2, { where: { leagueId: 'L1', faabRemaining: null }, data: { faabRemaining: 250 } })
  })

  it("no rule, a keeper / dynasty caller (faabFamily 'carry_rosters'): balances carry over by default", async () => {
    m.leagueFindUnique.mockResolvedValue(league({ waiverBudget: 250 }))
    const r = await renewRedraftLeague('L1', 'commish', { draftOrder: 'standings', faabFamily: 'carry_rosters' })
    expect(r).toMatchObject({ ok: true })
    expect(m.txRosterUpdateMany).toHaveBeenNthCalledWith(1, { where: { leagueId: 'L1' }, data: { playerData: {} } })
    expect(m.txRosterUpdateMany).toHaveBeenNthCalledWith(2, { where: { leagueId: 'L1', faabRemaining: null }, data: { faabRemaining: 250 } })
  })

  it("a keeper caller whose commissioner chose 'reset' still resets: an explicit choice beats the default", async () => {
    m.leagueFindUnique.mockResolvedValue(league({ waiverBudget: 250, waiverSettings: { waiverEngineConfig: { faab_rollover_rule: 'reset' } } }))
    await renewRedraftLeague('L1', 'commish', { draftOrder: 'standings', faabFamily: 'carry_rosters' })
    expect(m.txRosterUpdateMany).toHaveBeenCalledTimes(1)
    expect(m.txRosterUpdateMany).toHaveBeenCalledWith({ where: { leagueId: 'L1' }, data: { playerData: {}, faabRemaining: 250 } })
  })

  it("FAAB 'reset' chosen explicitly: the same single write as the default", async () => {
    m.leagueFindUnique.mockResolvedValue(league({ waiverBudget: 250, waiverSettings: { waiverEngineConfig: { faab_rollover_rule: 'reset' } } }))
    await renewRedraftLeague('L1', 'commish', { draftOrder: 'standings' })
    expect(m.txRosterUpdateMany).toHaveBeenCalledTimes(1)
    expect(m.txRosterUpdateMany).toHaveBeenCalledWith({ where: { leagueId: 'L1' }, data: { playerData: {}, faabRemaining: 250 } })
  })

  it('reverse_standings: the champion picks first', async () => {
    const r = await renewRedraftLeague('L1', 'commish', { draftOrder: 'reverse_standings' })
    expect(r).toMatchObject({ ok: true, orderMode: 'reverse_standings' })
    expect(slotIds()).toEqual(['R-a', 'R-c', 'R-d', 'R-b'])
    expect(m.txLeagueSettingsUpdateMany).toHaveBeenCalledWith({ where: { leagueId: 'L1' }, data: { draftOrderMethod: 'prev_standings' } })
  })

  it('random: shuffled server-side over exactly the league’s teams; standings are never read', async () => {
    const r = await renewRedraftLeague('L1', 'commish', { draftOrder: 'random', random: () => 0 })
    expect(r).toMatchObject({ ok: true, orderMode: 'random' })
    expect([...slotIds()].sort()).toEqual(['R-a', 'R-b', 'R-c', 'R-d'])
    // random() === 0 always swaps with index 0: [a,b,c,d] → [b,c,d,a]
    expect(slotIds()).toEqual(['R-b', 'R-c', 'R-d', 'R-a'])
    expect(m.redraftRosterFindMany).not.toHaveBeenCalled()
  })

  it('manual: the commissioner’s exact list', async () => {
    const r = await renewRedraftLeague('L1', 'commish', { draftOrder: 'manual', manualOrder: ['R-d', 'R-c', 'R-b', 'R-a'] })
    expect(r).toMatchObject({ ok: true, orderMode: 'manual' })
    expect(slotIds()).toEqual(['R-d', 'R-c', 'R-b', 'R-a'])
  })

  it('manual: an invalid list is refused BEFORE anything is reset', async () => {
    const r = await renewRedraftLeague('L1', 'commish', { draftOrder: 'manual', manualOrder: ['R-d', 'R-c', 'R-b'] })
    expect(r).toMatchObject({ ok: false, code: 'INVALID_MANUAL_ORDER' })
    expect(m.transaction).not.toHaveBeenCalled()
    expect(m.txRosterUpdateMany).not.toHaveBeenCalled()
  })

  it('an unknown order mode is refused', async () => {
    const r = await renewRedraftLeague('L1', 'commish', { draftOrder: 'alphabetical' })
    expect(r).toMatchObject({ ok: false, code: 'INVALID_DRAFT_ORDER' })
    expect(m.transaction).not.toHaveBeenCalled()
  })

  it('no mode given: falls back to the league’s saved draftOrderMethod', async () => {
    m.leagueSettingsFindUnique.mockResolvedValue({ draftOrderMethod: 'prev_standings' })
    const r = await renewRedraftLeague('L1', 'commish', {})
    expect(r).toMatchObject({ ok: true, orderMode: 'reverse_standings' })
    expect(slotIds()).toEqual(['R-a', 'R-c', 'R-d', 'R-b'])
  })

  it('standings with no title game recorded still order worst to first by record', async () => {
    m.finalists.mockResolvedValue({ championId: null, runnerUpId: null })
    const r = await renewRedraftLeague('L1', 'commish', { draftOrder: 'standings' })
    expect(r).toMatchObject({ ok: true })
    // b 2-11, d 5-8, a 9-4, c 10-3
    expect(slotIds()).toEqual(['R-b', 'R-d', 'R-a', 'R-c'])
  })

  it('refuses while the season is still being played, and writes nothing', async () => {
    m.seasonFindMany.mockResolvedValue([{ id: 'season-1', season: 2026, status: 'active' }])
    const r = await renewRedraftLeague('L1', 'commish', { draftOrder: 'random' })
    expect(r).toMatchObject({ ok: false, code: 'SEASON_IN_PROGRESS' })
    expect(m.transaction).not.toHaveBeenCalled()
  })

  describe('🛑 a second renew into the same season is refused', () => {
    it('when the first renew’s draft is still open', async () => {
      m.seasonFindMany.mockResolvedValue([
        { id: 'season-2', season: 2027, status: 'setup' },
        { id: 'season-1', season: 2026, status: 'complete' },
      ])
      m.draftSessionFindFirst.mockResolvedValue({ ...completedDraft, id: 'draft-2', status: 'pre_draft' })
      const r = await renewRedraftLeague('L1', 'commish', { draftOrder: 'random' })
      expect(r).toMatchObject({ ok: false, code: 'ALREADY_RENEWED' })
      expect(m.transaction).not.toHaveBeenCalled()
      expect(m.txRosterUpdateMany).not.toHaveBeenCalled()
      expect(m.txDraftSessionCreate).not.toHaveBeenCalled()
    })

    it('when the renewed season has already drafted but not started (marker, not draft status)', async () => {
      m.leagueFindUnique.mockResolvedValue(league({ lifecycleMetadata: { renewedIntoSeason: 2027 } }))
      m.seasonFindMany.mockResolvedValue([
        { id: 'season-2', season: 2027, status: 'setup' },
        { id: 'season-1', season: 2026, status: 'complete' },
      ])
      const r = await renewRedraftLeague('L1', 'commish', { draftOrder: 'random' })
      expect(r).toMatchObject({ ok: false, code: 'ALREADY_RENEWED' })
      expect(m.transaction).not.toHaveBeenCalled()
    })

    it('end to end: renew, then renew again against the state the first one wrote', async () => {
      const first = await renewRedraftLeague('L1', 'commish', { draftOrder: 'standings' })
      expect(first.ok).toBe(true)
      const written = m.txLeagueUpdate.mock.calls[0]![0].data

      // What the database now holds after the first renew.
      m.leagueFindUnique.mockResolvedValue(league({ lifecycleState: written.lifecycleState, lifecycleMetadata: written.lifecycleMetadata }))
      m.seasonFindMany.mockResolvedValue([
        { id: 'season-2', season: 2027, status: 'setup' },
        { id: 'season-1', season: 2026, status: 'complete' },
      ])
      m.draftSessionFindFirst.mockResolvedValue({ ...completedDraft, id: 'draft-2', status: 'pre_draft' })
      vi.clearAllMocks()
      m.transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx))

      const second = await renewRedraftLeague('L1', 'commish', { draftOrder: 'standings' })
      expect(second).toMatchObject({ ok: false, code: 'ALREADY_RENEWED' })
      expect(m.transaction).not.toHaveBeenCalled()
      expect(m.txRosterUpdateMany).not.toHaveBeenCalled()
    })

    it('a concurrent renew that wins the race between the read and the write rolls this one back', async () => {
      m.txDraftSessionFindFirst.mockResolvedValue({ id: 'draft-race' })
      const r = await renewRedraftLeague('L1', 'commish', { draftOrder: 'random' })
      expect(r).toMatchObject({ ok: false, code: 'ALREADY_RENEWED' })
      expect(m.txDraftSessionCreate).not.toHaveBeenCalled()
    })
  })

  it('a renew in the NEXT offseason is allowed again (the marker names a season that has since completed)', async () => {
    m.leagueFindUnique.mockResolvedValue(league({ lifecycleMetadata: { renewedIntoSeason: 2027 } }))
    m.seasonFindMany.mockResolvedValue([
      { id: 'season-2', season: 2027, status: 'complete' },
      { id: 'season-1', season: 2026, status: 'complete' },
    ])
    m.ensureShell.mockResolvedValue({ id: 'season-3', season: 2028 })
    const r = await renewRedraftLeague('L1', 'commish', { draftOrder: 'random' })
    expect(r).toMatchObject({ ok: true, season: 2028 })
    expect(m.ensureShell).toHaveBeenCalledWith('L1', 'season-2', tx)
  })
})
