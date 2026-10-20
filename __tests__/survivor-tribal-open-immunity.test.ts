// @vitest-environment node
/**
 * triggerTribalOpen sends the lowest-scoring tribe that is not safe. The score sync's pick is
 * safe, a tribe that won immunity in a challenge stays home, and both council openers (legacy and
 * verified) receive the same tribe the necklace award treated as headed to council.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  db: {
    survivorGameState: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    league: { findUnique: vi.fn() },
    survivorLeagueConfig: { findUnique: vi.fn() },
    survivorTribe: { findMany: vi.fn() },
    survivorPlayer: { findMany: vi.fn() },
    survivorWeeklyScore: { findMany: vi.fn() },
    survivorTribalCouncil: { findFirst: vi.fn() },
  },
  legacyOpen: vi.fn(),
  verifiedOpen: vi.fn(),
  reminders: vi.fn(),
  effects: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/survivor/votingEngine', () => ({ openTribalCouncil: m.legacyOpen, lockVoting: vi.fn() }))
vi.mock('@/lib/survivor/survivorCouncilService', () => ({ openTribalCouncil: m.verifiedOpen, closeVoteWindow: vi.fn() }))
vi.mock('@/lib/survivor/notificationEngine', () => ({ scheduleTribalReminders: m.reminders }))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ getWeeklyEffectState: m.effects }))
vi.mock('@/lib/survivor/survivorNbaWeeklyScoring', () => ({ scoreNbaSurvivorAllGamesRoster: vi.fn(), scoreNbaSurvivorOneGameRoster: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorSitOutEngine', () => ({ applySurvivorSitOutToScoring: vi.fn() }))

import { triggerTribalOpen } from '@/lib/survivor/gameStateMachine'
import { buildSurvivorFullSeasonPlan } from '@/lib/survivor/survivorFullSeasonPlan'

const configRow = {
  id: 'cfg', leagueId: 'L1', mode: 'redraft', tribeCount: 4, tribeSize: 4, tribeFormation: 'random', mergeTrigger: 'week', mergeWeek: 10,
  mergePlayerCount: null, juryStartAfterMerge: 1, exileReturnEnabled: false, exileReturnTokens: 4, idolCount: 2, idolPowerPool: null,
  tribeShuffleEnabled: false, tribeShuffleConsecutiveLosses: null, tribeShuffleImbalanceThreshold: null, voteDeadlineDayOfWeek: null,
  voteDeadlineTimeUtc: null, selfVoteDisallowed: true, tribalCouncilDayOfWeek: null, tribalCouncilTimeUtc: null, minigameFrequency: 'none',
  seasonThemeLabel: null, engineSpecV2: null, challengesSystemRun: true, regularSeasonEndWeek: null, faqSeededAt: null,
}
const noEffects = () => ({ immuneTribeIds: new Set<string>(), protectedRosterIds: new Set<string>(), frozenWaiverRosterIds: new Set<string>(), scoreBoostByRoster: new Map<string, number>() })

function arrange(settings: Record<string, unknown>, game: Record<string, unknown> = {}) {
  m.db.survivorGameState.findUnique.mockResolvedValue({ leagueId: 'L1', phase: 'pre_merge', currentWeek: 6, immuneTribeId: 'vela', mergeTriggeredAt: null, ...game })
  m.db.league.findUnique.mockResolvedValue({ id: 'L1', sport: 'NBA', leagueVariant: 'survivor', survivorPhase: 'pre_merge', settings })
  m.db.survivorLeagueConfig.findUnique.mockResolvedValue(configRow)
  m.db.survivorTribe.findMany.mockResolvedValue(['vela', 'kora', 'lumo', 'nami'].map(id => ({ id })))
  m.db.survivorPlayer.findMany.mockResolvedValue([{ userId: 'u1' }])
  m.db.survivorWeeklyScore.findMany.mockResolvedValue([
    { tribeId: 'vela', finalScore: 300, countedTowardTribeTotal: true },
    { tribeId: 'kora', finalScore: 200, countedTowardTribeTotal: true },
    { tribeId: 'lumo', finalScore: 50, countedTowardTribeTotal: true },
    { tribeId: 'nami', finalScore: 100, countedTowardTribeTotal: true },
  ])
  m.db.survivorTribalCouncil.findFirst.mockResolvedValue(null)
  m.db.survivorGameState.update.mockResolvedValue({})
  m.effects.mockResolvedValue(noEffects())
  m.legacyOpen.mockResolvedValue({ id: 'c-legacy' })
  m.verifiedOpen.mockResolvedValue({ ok: true, created: true, councilId: 'c-verified', status: 'voting_open', phase: 'pre_merge', week: 6, voterCount: 4 })
}

const plannedSettings = () => {
  const plan = buildSurvivorFullSeasonPlan({ sport: 'NBA', season: 2026, castSize: 16, draftAt: new Date('2026-10-18T00:00:00Z'), now: new Date('2026-10-18T00:00:00Z') })
  return { plan, week: plan.eliminationWeeks[0]! }
}

describe('triggerTribalOpen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends the lowest-scoring tribe that is not safe (legacy opener, no season plan)', async () => {
    arrange({ tribalCouncilDay: 'Tuesday', tribalCouncilTime: '20:00' })
    await triggerTribalOpen('L1')
    expect(m.legacyOpen).toHaveBeenCalledWith('L1', 6, 'lumo', expect.any(Date))
    expect(m.verifiedOpen).not.toHaveBeenCalled()
    expect(m.db.survivorGameState.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ activeCouncilId: 'c-legacy', needsTribalLock: false }) }))
    expect(m.reminders).toHaveBeenCalledWith('L1', expect.any(Date))
  })

  it('a tribe that won immunity in a challenge stays home, so the next-lowest tribe attends', async () => {
    arrange({})
    m.effects.mockResolvedValue({ ...noEffects(), immuneTribeIds: new Set(['lumo']) })
    await triggerTribalOpen('L1')
    expect(m.effects).toHaveBeenCalledWith('L1', 6)
    expect(m.legacyOpen).toHaveBeenCalledWith('L1', 6, 'nami', expect.any(Date))
  })

  it('the score sync pick is safe even when the totals rank another tribe first', async () => {
    arrange({}, { immuneTribeId: 'lumo' })
    await triggerTribalOpen('L1')
    expect(m.legacyOpen).toHaveBeenCalledWith('L1', 6, 'nami', expect.any(Date))
  })

  it('the verified opener gets the same tribe in a planned season, from finalized counted scores', async () => {
    const { plan, week } = plannedSettings()
    arrange({ survivor_full_season_plan: plan, twoHighestTribesImmune: true, tribalCouncilDay: 'Tuesday', tribalCouncilTime: '20:00' }, { currentWeek: week, immuneTribeId: 'kora' })
    await triggerTribalOpen('L1')
    expect(m.verifiedOpen).toHaveBeenCalledWith('L1', { week, attendingTribeId: 'lumo', voteDeadlineAt: expect.any(Date) })
    expect(m.legacyOpen).not.toHaveBeenCalled()
    expect(m.db.survivorWeeklyScore.findMany.mock.calls[0][0].where).toMatchObject({ leagueId: 'L1', week, isFinalized: true, countedTowardTribeTotal: true })
    expect(m.reminders).toHaveBeenCalledWith('L1', expect.any(Date))
  })

  it('does not open a second council in a planned elimination week', async () => {
    const { plan, week } = plannedSettings()
    arrange({ survivor_full_season_plan: plan }, { currentWeek: week })
    m.db.survivorTribalCouncil.findFirst.mockResolvedValue({ id: 'existing' })
    await triggerTribalOpen('L1')
    expect(m.verifiedOpen).not.toHaveBeenCalled()
    expect(m.legacyOpen).not.toHaveBeenCalled()
  })
})
