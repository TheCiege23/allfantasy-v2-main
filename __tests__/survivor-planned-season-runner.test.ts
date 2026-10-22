import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSurvivorFullSeasonPlan } from '@/lib/survivor/survivorFullSeasonPlan'
import { finalizeExileRosterResults } from '@/lib/survivor/exileRosterService'
import { processReturnFromExile } from '@/lib/survivor/exileEngine'
import { getFinaleState, settleFinaleIfDue } from '@/lib/survivor/SurvivorFinaleEngine'
import { ensureJuryVotingOpen } from '@/lib/survivor/juryEngine'
import { generateAndPostWeeklyRecap } from '@/lib/survivor/weeklyRecapGenerator'

const state = vi.hoisted(() => ({ game: {} as Record<string, unknown>, resolved: false, active: 20 }))
const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn(), findMany: vi.fn() },
  survivorAuditEntry: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  survivorPlayer: { count: vi.fn() },
  survivorGameState: { update: vi.fn(), updateMany: vi.fn() },
  survivorTribalCouncil: { findFirst: vi.fn(), findMany: vi.fn() },
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
vi.mock('@/lib/survivor/SurvivorFinaleEngine', () => ({ getFinaleState: vi.fn(), settleFinaleIfDue: vi.fn() }))
vi.mock('@/lib/survivor/juryEngine', () => ({ ensureJuryVotingOpen: vi.fn() }))
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({ withSurvivorSetupTransaction: (_id: string, fn: (tx: typeof db) => unknown) => fn(db) }))
vi.mock('@/lib/survivor/survivorVerifiedSlateChallenges', () => ({ ensureVerifiedSlateChallenges: vi.fn(), settleVerifiedSlateChallenges: vi.fn() }))
vi.mock('@/lib/survivor/weeklyRecapGenerator', () => ({ generateAndPostWeeklyRecap: vi.fn() }))
const redraw = vi.hoisted(() => ({ autoApply: vi.fn() }))
vi.mock('@/lib/survivor/survivorTribeRedrawDecision', () => ({ autoApplyPendingTribeRedraw: redraw.autoApply }))
const surprise = vi.hoisted(() => ({ ensure: vi.fn(), dissolve: vi.fn() }))
vi.mock('@/lib/survivor/survivorSurpriseTribes', () => ({ ensureSurpriseTribeWeek: surprise.ensure, dissolveSurpriseTribes: surprise.dissolve }))

const start = new Date('2026-09-01T12:00:00Z')
const later = new Date('2027-03-01T12:00:00Z')

async function setup(sport: 'NBA' | 'NHL', week: number, options: { exile?: boolean; finalized?: boolean; castSize?: number; now?: Date; exileReturnWeek?: number } = {}) {
  const plan = buildSurvivorFullSeasonPlan({ sport, season: 2026, castSize: options.castSize ?? 20, now: options.now ?? start, exileEnabled: options.exile, exileReturnWeek: options.exileReturnWeek ?? 10 })
  db.league.findUnique.mockResolvedValue({ sport, season: 2026, survivorMode: true, platform: 'allfantasy', settings: { survivor_full_season_plan: plan } })
  state.game = { phase: 'pre_merge', currentWeek: week, weekScoringFinalAt: options.finalized ? later : null, activeCouncilId: null }
  engine.getOrCreateSurvivorGameState.mockImplementation(async () => state.game)
  db.survivorAuditEntry.findFirst.mockImplementation(async () => state.resolved ? { id: 'audit-1' } : null)
  // The week-progress loader: one resolved council (and its elimination) when state.resolved.
  db.survivorAuditEntry.findMany.mockImplementation(async () => state.resolved ? [{ action: 'player_eliminated' }] : [])
  db.survivorTribalCouncil.findMany.mockImplementation(async () => state.resolved ? [{ attendingTribeId: null }] : [])
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
  it('draws the surprise two-tribe week at the top of an elimination-week tick once the rule is on', async () => {
    const { runPlannedSurvivorLeague } = await import('@/lib/survivor/survivorPlannedSeasonRunner')
    const plan = await setup(sport, 1, { finalized: true })
    db.league.findUnique.mockResolvedValue({ sport, season: 2026, survivorMode: true, platform: 'allfantasy', settings: { survivor_full_season_plan: plan, postMergeSurpriseTribeWeeks: 2 } })
    state.game.currentWeek = plan.eliminationWeeks[0]
    await runPlannedSurvivorLeague('league-1', later)
    expect(surprise.ensure).toHaveBeenCalledWith('league-1', plan.eliminationWeeks[0], plan)
    expect(surprise.ensure.mock.invocationCallOrder[0]).toBeLessThan(engine.triggerTribalOpen.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER)
  })

  it('stops every planned season step while the pause snapshot exists', async () => {
    const { runPlannedSurvivorLeague } = await import('@/lib/survivor/survivorPlannedSeasonRunner')
    await setup(sport, 3, { finalized: true })
    state.game.pausedSnapshot = { needsTribalLock: true }
    expect(await runPlannedSurvivorLeague('league-1', later)).toBe('paused')
    expect(engine.processTribalDeadline).not.toHaveBeenCalled()
    expect(engine.advanceWeek).not.toHaveBeenCalled()
    expect(engine.triggerTribalOpen).not.toHaveBeenCalled()
  })
  it.each([
    { qualifies: true, late: false }, { qualifies: false, late: false },
    // A 24-player cast drafted in January: fewer periods than eliminations, so some weeks vote twice.
    { qualifies: true, late: true }, { qualifies: false, late: true },
  ])('replays saved weekly state through a crowned Final 3 (Exile qualifies: $qualifies, late draft: $late)', async ({ qualifies, late }) => {
    const { runPlannedSurvivorLeague } = await import('@/lib/survivor/survivorPlannedSeasonRunner')
    const plan = await setup(sport, 1, late ? { exile: true, castSize: 24, now: new Date('2027-01-10T12:00:00Z'), exileReturnWeek: 20 } : { exile: true })
    if (late) expect(new Set(plan.eliminationWeeks).size).toBeLessThan(plan.eliminationWeeks.length)
    const resolvedWeeks = new Set<number>()
    const eliminatedIn = new Map<number, number>()
    const openedIn = new Map<number, number>()
    let returnResolved = false
    let skipped = 0
    const skippedWeeks = new Set<number>()
    state.active = plan.castSize
    state.game.currentWeek = plan.startWeek
    engine.allScoresFinalizedForWeek.mockResolvedValue(true)
    engine.finalizeWeeklyScores.mockImplementation(async () => { state.game.weekScoringFinalAt = new Date('2027-04-01T00:00:00Z') })
    engine.advanceWeek.mockImplementation(async () => { state.game.currentWeek = Number(state.game.currentWeek) + 1; state.game.weekScoringFinalAt = null })
    engine.triggerTribalOpen.mockImplementation(async () => {
      const week = Number(state.game.currentWeek)
      openedIn.set(week, (openedIn.get(week) ?? 0) + 1)
      state.game.activeCouncilId = `council-${week}-${openedIn.get(week)}`; state.game.tribalDeadline = new Date('2027-04-01T00:00:00Z')
    })
    engine.processTribalDeadline.mockImplementation(async () => {
      const week = Number(state.game.currentWeek)
      resolvedWeeks.add(week); eliminatedIn.set(week, (eliminatedIn.get(week) ?? 0) + 1); state.active--; state.game.activeCouncilId = null
    })
    db.survivorAuditEntry.findMany.mockImplementation(async ({ where }) => [
      ...Array.from({ length: eliminatedIn.get(where.week) ?? 0 }, () => ({ action: 'player_eliminated' })),
      ...(skippedWeeks.has(where.week) ? [{ action: 'planned_elimination_skipped_final_three' }] : []),
    ])
    db.survivorTribalCouncil.findMany.mockImplementation(async ({ where }) => Array.from({ length: openedIn.get(where.week) ?? 0 }, () => ({ attendingTribeId: null })))
    db.survivorAuditEntry.findFirst.mockImplementation(async ({ where }) => where.action === 'scheduled_exile_return_resolved'
      ? returnResolved ? { id: 'return' } : null
      : where.action === 'planned_elimination_skipped_final_three'
        ? skippedWeeks.has(where.week) ? { id: `skip-${where.week}` } : null
        : resolvedWeeks.has(where.week) ? { id: `week-${where.week}` } : null)
    db.survivorAuditEntry.create.mockImplementation(async ({ data }) => { if (data.action === 'planned_elimination_skipped_final_three') { resolvedWeeks.add(data.week); skippedWeeks.add(data.week); skipped++ }; return { id: 'audit' } })
    vi.mocked(processReturnFromExile).mockImplementation(async () => { returnResolved = true; if (qualifies) state.active++; return true as never })
    vi.mocked(getFinaleState).mockResolvedValue({ closed: true, winnerRosterId: 'winner' } as never)
    const now = new Date('2027-04-15T12:00:00Z')
    let outcome = ''
    for (let step = 0; step < (plan.endWeek - plan.startWeek + 1) * 8; step++) {
      outcome = await runPlannedSurvivorLeague('league-1', now)
      if (outcome === 'season_complete') break
      expect(['awaiting_verified_scores', 'awaiting_calendar', 'awaiting_exile_results', 'cast_below_final_three']).not.toContain(outcome)
    }
    expect(outcome).toBe('season_complete')
    expect(Number(state.game.currentWeek)).toBe(plan.finaleWeek)
    expect(state.active).toBe(3)
    expect(skipped).toBe(qualifies ? 0 : 1)
    expect(resolvedWeeks.size).toBe(new Set(plan.eliminationWeeks).size)
    // Every scheduled vote ran (bar the final-three skip), and a double week ran exactly two.
    expect([...eliminatedIn.values()].reduce((a, b) => a + b, 0)).toBe(plan.eliminationWeeks.length - skipped)
    for (const [week, count] of openedIn) expect(count).toBeLessThanOrEqual(plan.eliminationWeeks.filter(w => w === week).length)
    // An unanswered tribe-imbalance recommendation gets its default before each council opens.
    expect(redraw.autoApply).toHaveBeenCalledTimes(engine.triggerTribalOpen.mock.calls.length)
    expect(redraw.autoApply).toHaveBeenCalledWith('league-1', plan.eliminationWeeks[0])
    // Surprise tribes dissolve before every week flip, and are never drawn while the rule is off.
    expect(surprise.dissolve).toHaveBeenCalledTimes(engine.advanceWeek.mock.calls.length)
    expect(surprise.ensure).not.toHaveBeenCalled()
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
    expect(ensureJuryVotingOpen).not.toHaveBeenCalled()
  })

  it('opens jury voting itself, with the ceremony as the deadline, and keeps waiting while jurors vote', async () => {
    const { runPlannedSurvivorLeague } = await import('@/lib/survivor/survivorPlannedSeasonRunner')
    const plan = await setup(sport, 1, { finalized: true })
    state.game.currentWeek = plan.finaleWeek
    const finaleNow = new Date('2027-04-15T12:00:00Z')
    vi.mocked(getFinaleState).mockResolvedValue({ open: true, closed: false, winnerRosterId: null, votingDeadline: null } as never)
    vi.mocked(settleFinaleIfDue).mockResolvedValue({ open: true, closed: false, winnerRosterId: null, votingDeadline: new Date('2027-04-20T00:00:00Z') } as never)
    expect(await runPlannedSurvivorLeague('league-1', finaleNow)).toBe('awaiting_jury')
    expect(ensureJuryVotingOpen).toHaveBeenCalledOnce()
    const [leagueId, deadline] = vi.mocked(ensureJuryVotingOpen).mock.calls[0]
    expect(leagueId).toBe('league-1')
    expect(deadline).toBeInstanceOf(Date)
    expect((deadline as Date).getTime()).toBeGreaterThan(finaleNow.getTime())
    expect(settleFinaleIfDue).toHaveBeenCalledWith('league-1', plan.finaleWeek)
    expect(engine.advancePhase).not.toHaveBeenCalled()
  })

  it('crowns the winner in the same tick the jury finishes, with no commissioner click', async () => {
    const { runPlannedSurvivorLeague } = await import('@/lib/survivor/survivorPlannedSeasonRunner')
    const plan = await setup(sport, 1, { finalized: true })
    state.game.currentWeek = plan.finaleWeek
    vi.mocked(getFinaleState).mockResolvedValue({ open: true, closed: false, winnerRosterId: null, votingDeadline: new Date('2027-04-20T00:00:00Z') } as never)
    vi.mocked(settleFinaleIfDue).mockResolvedValue({ open: true, closed: true, winnerRosterId: 'winner' } as never)
    expect(await runPlannedSurvivorLeague('league-1', new Date('2027-04-21T12:00:00Z'))).toBe('season_complete')
    expect(ensureJuryVotingOpen).not.toHaveBeenCalled()
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
