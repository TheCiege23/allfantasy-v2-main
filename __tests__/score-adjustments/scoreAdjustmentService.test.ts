import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => {
  const state = {
    settings: {} as Record<string, unknown>,
    matchups: [] as Array<{ id: string; leagueId: string; seasonId: string; week: number; homeRosterId: string; awayRosterId: string | null; homeScore: number; awayScore: number }>,
  }
  const matchup = {
    findFirst: vi.fn(async ({ where }: { where: { id: string; leagueId: string } }) => state.matchups.find((m) => m.id === where.id && m.leagueId === where.leagueId) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { homeScore?: { increment: number }; awayScore?: { increment: number } } }) => {
      const m = state.matchups.find((x) => x.id === where.id)!
      if (data.homeScore) m.homeScore += data.homeScore.increment
      if (data.awayScore) m.awayScore += data.awayScore.increment
      return m
    }),
  }
  const tx = {
    $queryRaw: vi.fn(async () => []),
    league: {
      findUnique: vi.fn(async () => ({ settings: state.settings })),
      update: vi.fn(async ({ data }: { data: { settings: Record<string, unknown> } }) => { state.settings = data.settings; return {} }),
    },
    redraftMatchup: matchup,
  }
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    redraftMatchup: matchup,
    leagueAuditLog: { create: vi.fn(async () => ({})) },
  }
  return { state, tx, prisma }
})
const c2c = vi.hoisted(() => vi.fn(async () => false))
const standings = vi.hoisted(() => vi.fn(async () => ({})))
vi.mock('@/lib/prisma', () => ({ prisma: db.prisma }))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: c2c }))
vi.mock('@/lib/redraft/standingsEngine', () => ({ updateStandings: standings }))

import { addScoreAdjustment, applyStatCorrectionAdjustment, removeScoreAdjustment } from '@/lib/score-adjustments/scoreAdjustmentService'

const add = (over: Record<string, unknown> = {}) => addScoreAdjustment('L', 'commish', { matchupId: 'm1', rosterId: 'away', points: -5, reason: 'empty slot penalty', ...over })

describe('score adjustment service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    c2c.mockResolvedValue(false)
    db.state.settings = { scoring_mode: 'points', other: 1 }
    db.state.matchups = [
      { id: 'm1', leagueId: 'L', seasonId: 's1', week: 4, homeRosterId: 'home', awayRosterId: 'away', homeScore: 100, awayScore: 90 },
      { id: 'med', leagueId: 'L', seasonId: 's1', week: 4, homeRosterId: 'home', awayRosterId: null, homeScore: 100, awayScore: 0 },
      { id: 'elsewhere', leagueId: 'L2', seasonId: 's9', week: 4, homeRosterId: 'x', awayRosterId: 'y', homeScore: 1, awayScore: 1 },
    ]
  })

  it('saves the adjustment, moves the stored score in the same transaction, refreshes standings and audits', async () => {
    const r = await add()
    expect(r).toMatchObject({ ok: true, net: -5, adjustment: { matchupId: 'm1', rosterId: 'away', week: 4, points: -5, reason: 'empty slot penalty', byUserId: 'commish' } })
    expect(db.state.matchups[0]).toMatchObject({ homeScore: 100, awayScore: 85 })
    expect(db.state.settings).toMatchObject({ other: 1, commissioner_score_adjustments: [expect.objectContaining({ points: -5 })] })
    expect(db.tx.$queryRaw).toHaveBeenCalled()
    expect(standings).toHaveBeenCalledWith('s1', 4)
    expect(db.prisma.leagueAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actionType: 'score_adjustment_added', entityType: 'score_adjustment', userId: 'commish' }) }))
  })

  it('removing takes exactly those points back and clears the key when the list empties', async () => {
    const r = await add()
    await add({ rosterId: 'home', points: 2 })
    if (!r.ok) throw new Error('setup')
    expect(await removeScoreAdjustment('L', 'commish', r.adjustment.id)).toMatchObject({ ok: true, net: 0 })
    expect(db.state.matchups[0]).toMatchObject({ homeScore: 102, awayScore: 90 })
    const list = db.state.settings.commissioner_score_adjustments as unknown[]
    expect(list).toHaveLength(1)
    const last = list[0] as { id: string }
    await removeScoreAdjustment('L', 'commish', last.id)
    expect(db.state.settings).not.toHaveProperty('commissioner_score_adjustments')
    expect(db.state.matchups[0]).toMatchObject({ homeScore: 100, awayScore: 90 })
    expect(db.prisma.leagueAuditLog.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ actionType: 'score_adjustment_removed' }) }))
  })

  it('refuses a team not in the matchup, another league’s matchup, the median row, category leagues and C2C', async () => {
    expect(await add({ rosterId: 'stranger' })).toEqual({ ok: false, error: 'bad_target' })
    expect(await add({ matchupId: 'elsewhere', rosterId: 'x' })).toEqual({ ok: false, error: 'not_found' })
    expect(await add({ matchupId: 'med', rosterId: 'home' })).toEqual({ ok: false, error: 'median_only' })
    db.state.settings = { scoring_mode: 'h2h_category' }
    expect(await add()).toEqual({ ok: false, error: 'not_points' })
    db.state.settings = { scoring_mode: 'points' }
    c2c.mockResolvedValue(true)
    expect(await add()).toEqual({ ok: false, error: 'c2c' })
    expect(db.state.matchups[0]).toMatchObject({ homeScore: 100, awayScore: 90 })
    expect(db.prisma.leagueAuditLog.create).not.toHaveBeenCalled()
  })

  it('an unknown adjustment id changes nothing', async () => {
    expect(await removeScoreAdjustment('L', 'commish', 'nope')).toEqual({ ok: false, error: 'not_found' })
    expect(db.tx.league.update).not.toHaveBeenCalled()
  })

  it('a failing standings refresh or audit write never undoes a saved ruling', async () => {
    standings.mockRejectedValueOnce(new Error('down'))
    db.prisma.leagueAuditLog.create.mockRejectedValueOnce(new Error('down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await add()).toMatchObject({ ok: true })
    expect(db.state.matchups[0].awayScore).toBe(85)
    warn.mockRestore()
  })
})

describe('applying a stat correction', () => {
  const apply = (targetNet: number, rosterId = 'away') =>
    applyStatCorrectionAdjustment('L', 'commish', { matchupId: 'm1', rosterId, targetNet, reason: 'Stat correction, week 4: Run Back −4.5' })

  beforeEach(() => {
    vi.clearAllMocks()
    c2c.mockResolvedValue(false)
    db.state.settings = { scoring_mode: 'points' }
    db.state.matchups = [{ id: 'm1', leagueId: 'L', seasonId: 's1', week: 4, homeRosterId: 'home', awayRosterId: 'away', homeScore: 100, awayScore: 90 }]
  })

  it('adds a tagged adjustment for the correction, moves the sealed score, refreshes standings and audits', async () => {
    const r = await apply(-4.5)
    expect(r).toMatchObject({ ok: true, net: -4.5, adjustment: { points: -4.5, source: 'stat_correction', week: 4, byUserId: 'commish' } })
    expect(db.state.matchups[0].awayScore).toBe(85.5)
    expect(standings).toHaveBeenCalledWith('s1', 4)
    expect(db.prisma.leagueAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actionType: 'score_adjustment_added' }) }))
  })

  it('applies a correction once: a second tap adds nothing and moves nothing', async () => {
    await apply(-4.5)
    vi.clearAllMocks()
    const again = await apply(-4.5)
    expect(again).toMatchObject({ ok: true, adjustment: null, net: -4.5 })
    expect(db.state.matchups[0].awayScore).toBe(85.5)
    expect(db.tx.league.update).not.toHaveBeenCalled()
    expect(db.prisma.leagueAuditLog.create).not.toHaveBeenCalled()
  })

  it('adds only the difference when a further correction changes the total', async () => {
    await apply(-4.5)
    const r = await apply(-6)
    expect(r).toMatchObject({ ok: true, adjustment: { points: -1.5 } })
    expect(db.state.matchups[0].awayScore).toBe(84)
  })

  it("leaves the commissioner's own adjustment out of what counts as applied", async () => {
    await add({ points: -5, reason: 'late lineup penalty' })
    const r = await apply(-4.5)
    expect(r).toMatchObject({ ok: true, adjustment: { points: -4.5 }, net: -9.5 })
    expect(db.state.matchups[0].awayScore).toBe(80.5)
  })

  it('refuses a category league and a team not in the matchup', async () => {
    db.state.settings = { scoring_mode: 'h2h_category' }
    expect(await apply(-4.5)).toEqual({ ok: false, error: 'not_points' })
    db.state.settings = { scoring_mode: 'points' }
    expect(await apply(-4.5, 'stranger')).toEqual({ ok: false, error: 'bad_target' })
    expect(db.state.matchups[0].awayScore).toBe(90)
  })
})
