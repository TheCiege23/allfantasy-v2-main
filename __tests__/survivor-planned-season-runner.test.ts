import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSurvivorFullSeasonPlan } from '@/lib/survivor/survivorFullSeasonPlan'
import { finalizeExileRosterResults } from '@/lib/survivor/exileRosterService'
import { processReturnFromExile } from '@/lib/survivor/exileEngine'
import { getFinaleState } from '@/lib/survivor/SurvivorFinaleEngine'
import { generateAndPostWeeklyRecap } from '@/lib/survivor/weeklyRecapGenerator'

const state = vi.hoisted(() => ({ game: {} as Record<string, unknown>, resolved: false, active: 20 }))
const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn(), findMany: vi.fn() },
  survivorAuditEntry: { findFirst: vi.fn(), create: vi.fn() },
  survivorPlayer: { count: vi.fn() },
  survivorGameState: { update: vi.fn(), updateMany: vi.fn() },
  survivorTribalCouncil: { findFirst: vi.fn() },
  exileWeeklyEntry: { findFirst: vi.fn() },
}))
const engine = vi.hoisted(() => ({
  advancePhase: vi.fn(), advanceWeek: vi.fn(), allScoresFinalizedForWeek: vi.fn(),
  finalizeWeeklyScores: vi.fn(), getOrCreateSurvivorGameState: vi.fn(),
  processTribalDeadline: vi.fn(), syncWeeklyScores: vi.fn(), triggerTribalOpen: vi.fn(),
  tryAutomaticPhaseAdvance: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/survivor/gameStateMachine', () => engine)
vi.mock('@/lib/survivor/exileEngine', () => ({ processReturnFromExile: vi.fn(), scoreExileWeek: vi.fn() }))
vi.mock('@/lib/survivor/exileRosterService', () => ({ closeExpiredExileRosters: vi.fn(), finalizeExileRosterResults: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorFinaleEngine', () => ({ getFinaleState: vi.fn() }))
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({ withSurvivorSetupTransaction: (_id: string, fn: (tx: typeof db) => unknown) => fn(db) }))
vi.mock('@/lib/survivor/survivorVerifiedSlateChallenges', () => ({ ensureVerifiedSlateChallenges: vi.fn(), settleVerifiedSlateChallenges: vi.fn() }))
vi.mock('@/lib/survivor/weeklyRecapGenerator', () => ({ generateAndPostWeeklyRecap: vi.fn() }))

const start = new Date('2026-09-01T12:00:00Z')
const later = new Date('2027-03-01T12:00:00Z')

async function setup(sport: 'NBA' | 'NHL', week: number, options: { exile?: boolean; finalized?: boolean } = {}) {
  const plan = buildSurvivorFullSeasonPlan({ sport, season: 2026, castSize: 20, now: start, exileEnabled: options.exile, exileReturnWeek: 10 })
  db.league.findUnique.mockResolvedValue({ sport, season: 2026, survivorMode: true, platform: 'allfantasy', settings: { survivor_full_season_plan: plan } })
  state.game = { phase: 'pre_merge', currentWeek: week, weekScoringFinalAt: options.finalized ? later : null, activeCouncilId: null }
  engine.getOrCreateSurvivorGameState.mockImplementation(async () => state.game)
  db.survivorAuditEntry.findFirst.mockImplementation(async () => state.resolved ? { id: 'audit-1' } : null)
  db.survivorPlayer.count.mockImplementation(async () => state.active)
  db.exileWeeklyEntry.findFirst.mockResolvedValue(null)
  db.survivorTribalCouncil.findFirst.mockResolvedValue(null)
  engine.allScoresFinalizedForWeek.mockResolvedValue(false)
  return plan
}

beforeEach(() => {
  vi.clearAllMocks()
  state.resolved = false
  state.active = 20
})

describe.each(['NBA', 'NHL'] as const)('%s Survivor planned season tick', sport => {
  it('stops every planned season step while the pause snapshot exists', async () => {
    const { runPlannedSurvivorLeague } = await import('@/lib/survivor/survivorPlannedSeasonRunner')
    await setup(sport, 3, { finalized: true })
    state.game.pausedSnapshot = { needsTribalLock: true }
    expect(await runPlannedSurvivorLeague('league-1', later)).toBe('paused')
    expect(engine.processTribalDeadline).not.toHaveBeenCalled()
    expect(engine.advanceWeek).not.toHaveBeenCalled()
    expect(engine.triggerTribalOpen).not.toHaveBeenCalled()
  })
  it.each([true, false])('replays saved weekly state through a crowned Final 3 (Exile qualifies: %s)', async qualifies => {
    const { runPlannedSurvivorLeague } = await import('@/lib/survivor/survivorPlannedSeasonRunner')
    const plan = await setup(sport, 1, { exile: true })
    const resolvedWeeks = new Set<number>()
    let returnResolved = false
    let skipped = 0
    state.game.currentWeek = plan.startWeek
    engine.allScoresFinalizedForWeek.mockResolvedValue(true)
    engine.finalizeWeeklyScores.mockImplementation(async () => { state.game.weekScoringFinalAt = new Date('2027-04-01T00:00:00Z') })
    engine.advanceWeek.mockImplementation(async () => { state.game.currentWeek = Number(state.game.currentWeek) + 1; state.game.weekScoringFinalAt = null })
    engine.triggerTribalOpen.mockImplementation(async () => { state.game.activeCouncilId = `council-${state.game.currentWeek}`; state.game.tribalDeadline = new Date('2027-04-01T00:00:00Z') })
    engine.processTribalDeadline.mockImplementation(async () => { resolvedWeeks.add(Number(state.game.currentWeek)); state.active--; state.game.activeCouncilId = null })
    db.survivorAuditEntry.findFirst.mockImplementation(async ({ where }) => where.action === 'scheduled_exile_return_resolved'
      ? returnResolved ? { id: 'return' } : null
      : resolvedWeeks.has(where.week) ? { id: `week-${where.week}` } : null)
    db.survivorAuditEntry.create.mockImplementation(async ({ data }) => { if (data.action === 'planned_elimination_skipped_final_three') { resolvedWeeks.add(data.week); skipped++ }; return { id: 'audit' } })
    vi.mocked(processReturnFromExile).mockImplementation(async () => { returnResolved = true; if (qualifies) state.active++; return true as never })
    vi.mocked(getFinaleState).mockResolvedValue({ closed: true, winnerRosterId: 'winner' } as never)
    const now = new Date('2027-04-15T12:00:00Z')
    let outcome = ''
    for (let step = 0; step < (plan.endWeek - plan.startWeek + 1) * 6; step++) {
      outcome = await runPlannedSurvivorLeague('league-1', now)
      if (outcome === 'season_complete') break
      expect(['awaiting_verified_scores', 'awaiting_calendar', 'awaiting_exile_results', 'cast_below_final_three']).not.toContain(outcome)
    }
    expect(outcome).toBe('season_complete')
    expect(Number(state.game.currentWeek)).toBe(plan.finaleWeek)
    expect(state.active).toBe(3)
    expect(skipped).toBe(qualifies ? 0 : 1)
    expect(resolvedWeeks.size).toBe(plan.eliminationWeeks.length)
  })

  it.each([true, false])('replays every regular-season period to three finalists (Exile return: %s)', async qualifiesToReturn => {
    const { plannedWeekKind } = await import('@/lib/survivor/survivorPlannedSeasonRunner')
    const plan = await setup(sport, 1, { exile: true })
    let active = plan.castSize
    let skipped = 0
    let returned = 0
    let openings = 0
    let finales = 0
    for (let week = plan.startWeek; week <= plan.endWeek; week++) {
      const kind = plannedWeekKind(plan, week)
      if (kind === 'opening') openings++
      if (kind === 'elimination') {
        if (active === 3) skipped++
        else active--
      }
      if (week === plan.exileReturnWeek && qualifiesToReturn) { active++; returned++ }
      if (kind === 'finale') { finales++; expect(active).toBe(3) }
    }
    expect(openings).toBe(1)
    expect(finales).toBe(1)
    expect(returned).toBe(qualifiesToReturn ? 1 : 0)
    expect(skipped).toBe(qualifiesToReturn ? 0 : 1)
  })

  it('waits for final scores before opening a vote or moving the week', async () => {
    const { runPlannedSurvivorLeague } = await import('@/lib/survivor/survivorPlannedSeasonRunner')
    const plan = await setup(sport, 5)
    state.game.currentWeek = plan.eliminationWeeks[2]
    expect(await runPlannedSurvivorLeague('league-1', later)).toBe('awaiting_verified_scores')
    expect(engine.triggerTribalOpen).not.toHaveBeenCalled()
    expect(engine.advanceWeek).not.toHaveBeenCalled()
  })

  it('advances a verified opening week without creating an elimination council', async () => {
    const { runPlannedSurvivorLeague } = await import('@/lib/survivor/survivorPlannedSeasonRunner')
    const plan = await setup(sport, 1, { finalized: true })
    state.game.currentWeek = plan.openingWeek
    expect(await runPlannedSurvivorLeague('league-1', later)).toBe('week_advanced')
    expect(engine.advanceWeek).toHaveBeenCalledWith('league-1')
    expect(generateAndPostWeeklyRecap).toHaveBeenCalledWith('league-1', plan.openingWeek)
    expect(engine.triggerTribalOpen).not.toHaveBeenCalled()
  })

  it('holds the week and recap until a council is publicly revealed', async () => {
    const { runPlannedSurvivorLeague } = await import('@/lib/survivor/survivorPlannedSeasonRunner')
    const plan = await setup(sport, 5, { finalized: true })
    state.game.currentWeek = plan.eliminationWeeks[2]
    state.resolved = true
    db.survivorTribalCouncil.findFirst.mockResolvedValue({ isRevealed: false })
    expect(await runPlannedSurvivorLeague('league-1', later)).toBe('awaiting_reveal')
    expect(generateAndPostWeeklyRecap).not.toHaveBeenCalled()
    expect(engine.advanceWeek).not.toHaveBeenCalled()
  })

  it('keeps progression pending when an Exile roster has no finalized result', async () => {
    const { runPlannedSurvivorLeague } = await import('@/lib/survivor/survivorPlannedSeasonRunner')
    const plan = await setup(sport, 1, { finalized: true })
    state.game.currentWeek = plan.openingWeek
    db.exileWeeklyEntry.findFirst.mockResolvedValue({ id: 'exile-1' })
    vi.mocked(finalizeExileRosterResults).mockResolvedValue(false)
    expect(await runPlannedSurvivorLeague('league-1', later)).toBe('awaiting_exile_results')
    expect(engine.advanceWeek).not.toHaveBeenCalled()
  })

  it('completes only after a real crowned jury winner exists', async () => {
    const { runPlannedSurvivorLeague } = await import('@/lib/survivor/survivorPlannedSeasonRunner')
    const plan = await setup(sport, 1, { finalized: true })
    state.game.currentWeek = plan.finaleWeek
    vi.mocked(getFinaleState).mockResolvedValue({ closed: true, winnerRosterId: 'winner' } as never)
    expect(await runPlannedSurvivorLeague('league-1', new Date('2027-04-15T12:00:00Z'))).toBe('season_complete')
    expect(engine.advancePhase).toHaveBeenCalledWith('league-1', 'automatic', undefined, expect.objectContaining({ toPhase: 'complete' }))
  })

  it('processes a due council without advancing while its elimination is unresolved', async () => {
    const { runPlannedSurvivorLeague } = await import('@/lib/survivor/survivorPlannedSeasonRunner')
    const plan = await setup(sport, 5, { finalized: true })
    state.game.currentWeek = plan.eliminationWeeks[2]
    state.game = { ...state.game, activeCouncilId: 'council-1', tribalDeadline: new Date('2026-12-01T00:00:00Z') }
    expect(await runPlannedSurvivorLeague('league-1', later)).toBe('ceremony_processed')
    expect(engine.processTribalDeadline).toHaveBeenCalledOnce()
    expect(engine.advanceWeek).not.toHaveBeenCalled()
  })

  it('preserves the final three if the single Exile return spot went unclaimed', async () => {
    const { runPlannedSurvivorLeague } = await import('@/lib/survivor/survivorPlannedSeasonRunner')
    const plan = await setup(sport, 5, { exile: true, finalized: true })
    state.game.currentWeek = plan.eliminationWeeks[2]
    state.active = 3
    db.survivorAuditEntry.create.mockResolvedValue({ id: 'skip-1' })
    expect(await runPlannedSurvivorLeague('league-1', later)).toBe('final_three_preserved')
    expect(db.survivorAuditEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'planned_elimination_skipped_final_three' }) }))
    expect(engine.triggerTribalOpen).not.toHaveBeenCalled()
  })
})

it('does not activate autonomous hosting merely because a league has a saved season plan', async () => {
  const { runPlannedSurvivorSeasonBatch } = await import('@/lib/survivor/survivorPlannedSeasonRunner')
  const plan = await setup('NBA', 1)
  db.league.findMany.mockResolvedValue([{ id: 'league-1', settings: { survivor_full_season_plan: plan } }])
  delete process.env.SURVIVOR_PLANNED_SEASON_AUTOMATION_ENABLED
  expect(await runPlannedSurvivorSeasonBatch(later)).toEqual({ considered: 0, failed: 0, outcomes: { disabled: 1 } })
  expect(db.league.findMany).not.toHaveBeenCalled()
  expect(engine.advanceWeek).not.toHaveBeenCalled()
})

it('freezes a league the commissioner paused, even though its phase is unchanged', async () => {
  const { runPlannedSurvivorLeague } = await import('@/lib/survivor/survivorPlannedSeasonRunner')
  const plan = await setup('NBA', 1, { finalized: true })
  state.game.currentWeek = plan.eliminationWeeks[0]
  state.game.pausedSnapshot = { needsTribalLock: true }
  expect(await runPlannedSurvivorLeague('league-1', later)).toBe('paused')
  expect(engine.triggerTribalOpen).not.toHaveBeenCalled()
  expect(engine.processTribalDeadline).not.toHaveBeenCalled()
  expect(engine.advanceWeek).not.toHaveBeenCalled()
  expect(engine.syncWeeklyScores).not.toHaveBeenCalled()
})
