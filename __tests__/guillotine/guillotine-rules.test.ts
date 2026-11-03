import { beforeEach, describe, expect, it, vi } from 'vitest'

const leagueFindUnique = vi.fn()
const leagueUpdate = vi.fn()
const configFindUnique = vi.fn()
const queryRaw = vi.fn()
const getGuillotineConfig = vi.fn()
const upsertGuillotineConfig = vi.fn()
const hasFirstChopHappened = vi.fn()
const evaluateUserFeatureAccess = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/guillotine/weeklyRecap', () => ({ hasGuillotineAiRecapPlan: async () => false }))
vi.mock('@/lib/prisma', () => {
  const tx = {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    league: { findUnique: (...a: unknown[]) => leagueFindUnique(...a), update: (...a: unknown[]) => leagueUpdate(...a) },
  }
  return {
    prisma: {
      ...tx,
      guillotineLeagueConfig: { findUnique: (...a: unknown[]) => configFindUnique(...a) },
      $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  }
})
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({
  DEFAULT_END_WEEK_BY_SPORT: { NBA: 24, NFL: 18 },
  getGuillotineConfig: (...a: unknown[]) => getGuillotineConfig(...a),
  upsertGuillotineConfig: (...a: unknown[]) => upsertGuillotineConfig(...a),
}))
vi.mock('@/lib/guillotine/guillotineFirstChopWeek', () => ({ hasFirstChopHappened: (...a: unknown[]) => hasFirstChopHappened(...a) }))
vi.mock('@/lib/subscription/FeatureGateService', () => ({
  FeatureGateService: class {
    evaluateUserFeatureAccess = (...a: unknown[]) => evaluateUserFeatureAccess(...a)
  },
}))

import { normalizeGuillotineRulesPatch, paidFieldsChanged, GUILLOTINE_PAID_RULE_FIELDS, type GuillotineRules } from '@/lib/guillotine/guillotineRules'
import { saveGuillotineRules } from '@/lib/guillotine/guillotineRulesSave'

const CONFIG = {
  leagueId: 'L1',
  sport: 'NBA',
  eliminationStartWeek: 2,
  eliminationEndWeek: 24,
  teamsPerChop: 1,
  correctionWindow: 'after_stat_corrections',
  customCutoffDayOfWeek: null,
  customCutoffTimeUtc: null,
  statCorrectionHours: 24,
  tiebreakerOrder: ['bench_points', 'season_points', 'previous_period', 'draft_slot', 'commissioner', 'random'],
  dangerMarginPoints: 10,
  rosterReleaseTiming: 'next_waiver_run',
  commissionerOverride: true,
}

const CURRENT: GuillotineRules = {
  teamsPerChop: 1,
  eliminationEndWeek: 24,
  endgame: 'last_team_standing',
  tiebreakerOrder: CONFIG.tiebreakerOrder as GuillotineRules['tiebreakerOrder'],
  statCorrectionHours: 24,
  dangerMarginPoints: 10,
  rosterReleaseTiming: 'next_waiver_run',
  aiRecapAuto: true,
  faabOnChop: 'keep',
  bestBall: false,
}

describe('normalizeGuillotineRulesPatch', () => {
  const bounds = { startWeek: 2, seasonWeeks: 24 }
  it('accepts a valid partial patch', () => {
    expect(normalizeGuillotineRulesPatch({ endgame: 'final_four', teamsPerChop: '2' }, bounds)).toEqual({
      ok: true,
      value: { endgame: 'final_four', teamsPerChop: 2 },
    })
  })
  it('rejects out-of-range and unknown values with a plain-English message', () => {
    const cases: Array<[unknown, string]> = [
      [{ teamsPerChop: 0 }, 'teamsPerChop'],
      [{ eliminationEndWeek: 1 }, 'eliminationEndWeek'],
      [{ eliminationEndWeek: 25 }, 'eliminationEndWeek'],
      [{ endgame: 'sudden_death' }, 'endgame'],
      [{ tiebreakerOrder: ['bench_points', 'bench_points'] }, 'tiebreakerOrder'],
      [{ tiebreakerOrder: ['coin_flip'] }, 'tiebreakerOrder'],
      [{ statCorrectionHours: 73 }, 'statCorrectionHours'],
      [{ dangerMarginPoints: -1 }, 'dangerMarginPoints'],
      [{ rosterReleaseTiming: 'custom_time' }, 'rosterReleaseTiming'],
    ]
    for (const [raw, field] of cases) {
      const r = normalizeGuillotineRulesPatch(raw, bounds)
      expect(r.ok, JSON.stringify(raw)).toBe(false)
      if (!r.ok) expect(r.error.field).toBe(field)
    }
    expect(normalizeGuillotineRulesPatch({}, bounds).ok).toBe(false)
  })
})

describe('paidFieldsChanged', () => {
  it('ignores free fields, untouched paid fields, and a paid field put back to its default', () => {
    expect(paidFieldsChanged({ endgame: 'final_two', rosterReleaseTiming: 'immediate' }, CURRENT)).toEqual([])
    expect(paidFieldsChanged({ teamsPerChop: 1, dangerMarginPoints: 10 }, CURRENT)).toEqual([])
    expect(paidFieldsChanged({ statCorrectionHours: 48 }, CURRENT)).toEqual([]) // 48 is the default
    expect(paidFieldsChanged({ teamsPerChop: 2, statCorrectionHours: 12 }, CURRENT)).toEqual(['teamsPerChop', 'statCorrectionHours'])
  })
  it('keeps endgame and release timing free', () => {
    expect(GUILLOTINE_PAID_RULE_FIELDS.has('endgame')).toBe(false)
    expect(GUILLOTINE_PAID_RULE_FIELDS.has('rosterReleaseTiming')).toBe(false)
  })
})

describe('best ball lineups (lib/guillotine/guillotineBestBall.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getGuillotineConfig.mockResolvedValue(CONFIG)
    configFindUnique.mockResolvedValue({ id: 'cfg1' })
    hasFirstChopHappened.mockResolvedValue(false)
    evaluateUserFeatureAccess.mockResolvedValue({ allowed: false })
  })
  const league = (over: Record<string, unknown> = {}) => ({ sport: 'NBA', settings: {}, guillotineEndgame: 'last_team_standing', status: 'pre_draft', lifecycleState: null, ...over })

  it('is a yes/no; anything else is refused', () => {
    expect(normalizeGuillotineRulesPatch({ bestBall: true }, { startWeek: 2, seasonWeeks: 24 })).toEqual({ ok: true, value: { bestBall: true } })
    expect(normalizeGuillotineRulesPatch({ bestBall: 'yes' }, { startWeek: 2, seasonWeeks: 24 })).toMatchObject({ ok: false, error: { field: 'bestBall' } })
  })

  it('a free commissioner turns it on before the draft, and it lands in settings.best_ball', async () => {
    leagueFindUnique.mockResolvedValue(league())
    const r = await saveGuillotineRules('L1', 'u1', { bestBall: true })
    expect(r.ok).toBe(true)
    expect(leagueUpdate.mock.calls[0]![0].data.settings.best_ball).toBe(true)
    // Not a Best Ball league: the format column is never touched.
    expect(leagueUpdate.mock.calls[0]![0].data).not.toHaveProperty('bestBallMode')
    expect(upsertGuillotineConfig).not.toHaveBeenCalled()
  })

  it('reads back as on, and unlocked before the draft', async () => {
    leagueFindUnique.mockResolvedValue(league({ settings: { best_ball: true } }))
    const r = await saveGuillotineRules('L1', 'u1', { rosterReleaseTiming: 'immediate' })
    expect(r).toMatchObject({ ok: true, view: { rules: { bestBall: true }, bestBallLocked: false } })
  })

  it.each(['drafting', 'in_season', 'post_draft'])('once the league is %s it is fixed (409) and nothing is written', async (status) => {
    leagueFindUnique.mockResolvedValue(league({ status }))
    const r = await saveGuillotineRules('L1', 'u1', { bestBall: true })
    expect(r).toMatchObject({ ok: false, status: 409, field: 'bestBall' })
    expect(leagueUpdate).not.toHaveBeenCalled()
  })

  it('a locked league can still save its other rules, sending best ball unchanged', async () => {
    leagueFindUnique.mockResolvedValue(league({ status: 'in_season', settings: { best_ball: true } }))
    const r = await saveGuillotineRules('L1', 'u1', { bestBall: true, rosterReleaseTiming: 'immediate' })
    expect(r).toMatchObject({ ok: true, view: { bestBallLocked: true } })
  })
})

describe('saveGuillotineRules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getGuillotineConfig.mockResolvedValue(CONFIG)
    leagueFindUnique.mockResolvedValue({ sport: 'NBA', settings: { conceptSetup: { guillotine: { endgame: 'last_team_standing' } } }, guillotineEndgame: 'last_team_standing' })
    configFindUnique.mockResolvedValue({ id: 'cfg1' })
    hasFirstChopHappened.mockResolvedValue(false)
    evaluateUserFeatureAccess.mockResolvedValue({ allowed: false })
  })

  it('refuses a paid change without AF Commissioner (402) and writes nothing', async () => {
    const r = await saveGuillotineRules('L1', 'u1', { teamsPerChop: 2 })
    expect(r).toMatchObject({ ok: false, status: 402, fields: ['teamsPerChop'] })
    expect(upsertGuillotineConfig).not.toHaveBeenCalled()
  })

  it('lets a free commissioner change the free rules', async () => {
    const r = await saveGuillotineRules('L1', 'u1', { rosterReleaseTiming: 'immediate' })
    expect(r.ok).toBe(true)
    expect(upsertGuillotineConfig).toHaveBeenCalledWith('L1', { rosterReleaseTiming: 'immediate' })
  })

  it('saves paid rules for an AF Commissioner', async () => {
    evaluateUserFeatureAccess.mockResolvedValue({ allowed: true })
    const r = await saveGuillotineRules('L1', 'u1', { teamsPerChop: 2, statCorrectionHours: 12 })
    expect(r.ok).toBe(true)
    expect(upsertGuillotineConfig).toHaveBeenCalledWith('L1', { teamsPerChop: 2, statCorrectionHours: 12 })
  })

  it('writes the endgame where resolveGuillotineEndgame reads it first (settings.guillotineEndgame) and keeps the column in step', async () => {
    const r = await saveGuillotineRules('L1', 'u1', { endgame: 'final_three' })
    expect(r.ok).toBe(true)
    const data = leagueUpdate.mock.calls[0]![0].data
    expect(data.settings.guillotineEndgame).toBe('final_three')
    expect(data.settings.conceptSetup).toBeDefined()
    expect(data.guillotineEndgame).toBe('final_three')
    expect(data.guillotineEndgameThreshold).toBe(3)
  })

  it('saves the Chimmy recap switch to League.settings, free to change, and leaves the endgame column alone', async () => {
    const r = await saveGuillotineRules('L1', 'u1', { aiRecapAuto: false })
    expect(r.ok).toBe(true)
    const data = leagueUpdate.mock.calls[0]![0].data
    expect(data.settings.guillotineAiRecapAuto).toBe(false)
    expect(data).not.toHaveProperty('guillotineEndgame')
    expect(upsertGuillotineConfig).not.toHaveBeenCalled()
  })

  it('sharing a chopped team\'s FAAB is AF Commissioner: refused (402) for a free commissioner', async () => {
    const r = await saveGuillotineRules('L1', 'u1', { faabOnChop: 'split' })
    expect(r).toMatchObject({ ok: false, status: 402, fields: ['faabOnChop'] })
    expect(leagueUpdate).not.toHaveBeenCalled()
  })

  it('a free commissioner can still put a league left on "split" back to "keep"', async () => {
    leagueFindUnique.mockResolvedValue({ sport: 'NBA', settings: { guillotineFaabOnChop: 'split' }, guillotineEndgame: 'last_team_standing' })
    const r = await saveGuillotineRules('L1', 'u1', { faabOnChop: 'keep' })
    expect(r.ok).toBe(true)
    expect(leagueUpdate.mock.calls[0]![0].data.settings.guillotineFaabOnChop).toBe('keep')
  })

  it('saves the chopped-team FAAB choice to League.settings for an AF Commissioner', async () => {
    evaluateUserFeatureAccess.mockResolvedValue({ allowed: true })
    const r = await saveGuillotineRules('L1', 'u1', { faabOnChop: 'split' })
    expect(r.ok).toBe(true)
    expect(leagueUpdate.mock.calls[0]![0].data.settings.guillotineFaabOnChop).toBe('split')
    expect(upsertGuillotineConfig).not.toHaveBeenCalled()
    expect(normalizeGuillotineRulesPatch({ faabOnChop: 'give_to_commish' }, { startWeek: 2, seasonWeeks: 24 })).toMatchObject({
      ok: false,
      error: { field: 'faabOnChop' },
    })
  })

  it('locks the endgame once the first chop has happened (409)', async () => {
    hasFirstChopHappened.mockResolvedValue(true)
    const r = await saveGuillotineRules('L1', 'u1', { endgame: 'final_two' })
    expect(r).toMatchObject({ ok: false, status: 409, field: 'endgame' })
    expect(leagueUpdate).not.toHaveBeenCalled()
  })

  it('creates the config row from the DERIVED config, not schema defaults, when none exists', async () => {
    configFindUnique.mockResolvedValue(null)
    await saveGuillotineRules('L1', 'u1', { rosterReleaseTiming: 'immediate' })
    expect(upsertGuillotineConfig).toHaveBeenCalledWith('L1', expect.objectContaining({
      eliminationStartWeek: 2,
      statCorrectionHours: 24,
      rosterReleaseTiming: 'immediate',
    }))
  })
})
