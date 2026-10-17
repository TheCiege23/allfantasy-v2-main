import { describe, expect, it } from 'vitest'
import { buildSeasonBlueprint, defaultSeasonBlueprint } from '@/lib/tournament/seasonBlueprint'
import { assessSeasonRules, defaultSeasonRules, nbaStartCap, scoringPeriodForGame, seasonRulesSchema } from '@/lib/tournament/seasonRules'

function completeConfig() {
  const config = { ...defaultSeasonBlueprint(), name: 'NBA Pilot', rules: defaultSeasonRules('NBA', 'nba_points') }
  const rules = config.rules
  const epoch = Date.parse('2026-10-20T00:00:00Z')
  const hour = 3600000
  const iso = (hours: number) => new Date(epoch + hours * hour).toISOString()
  // Artificial fixture: spaced windows deliberately leave correction and redraft time.
  rules.calendar = {
    timezone: 'America/New_York', seasonLabel: 'Test season', sourceUrl: 'https://www.nba.com/schedule', scheduleReviewed: true,
    regularSeasonStartsAt: iso(0), regularSeasonEndsAt: iso(24 * 192),
    periods: Array.from({ length: 24 }, (_, i) => ({ number: i + 1, startsAt: iso(i * 192), endsAt: iso(i * 192 + 144), finalizesAt: iso(i * 192 + 168) })),
    drafts: [
      { stage: 1, startsAt: iso(-48), completeBy: iso(-24) },
      { stage: 2, startsAt: iso(9 * 192 + 168), completeBy: iso(10 * 192 - 24) },
      { stage: 3, startsAt: iso(19 * 192 + 168), completeBy: iso(20 * 192 - 24) },
    ],
  }
  // Exactly 24h between correction closure and next period: a two-hour draft needs a smaller buffer.
  config.redraftBufferHours = 12
  rules.calendar.drafts[1]!.completeBy = iso(10 * 192 - 12)
  rules.calendar.drafts[2]!.completeBy = iso(20 * 192 - 12)
  return config
}

describe('season playing rules contract', () => {
  it('reads old plans without inventing a verified calendar', () => {
    const plan = buildSeasonBlueprint({ ...defaultSeasonBlueprint(), name: 'Old plan' })
    expect(plan.config.rules).toBeUndefined()
    expect(assessSeasonRules(plan.config).ready).toBe(false)
  })
  it.each(['NFL', 'NBA'] as const)('snapshots valid %s defaults with drafted roster totals', sport => {
    const config = defaultSeasonBlueprint(sport)
    const rules = defaultSeasonRules(sport, config.scoring)
    expect(seasonRulesSchema.safeParse(rules).success).toBe(true)
    expect(rules.starters.reduce((sum, s) => sum + s.count, rules.bench)).toBe(config.rosterSize)
    expect(rules.finalRosterRelease).toBe(false)
    expect(rules.calendar.scheduleReviewed).toBe(false)
  })
  it.each([['ppr', 1], ['half_ppr', 0.5], ['standard', 0]] as const)('uses %s reception weights', (preset, points) => {
    expect(defaultSeasonRules('NFL', preset).weights.find(s => s.statKey === 'receptions')?.points).toBe(points)
  })
  it('does not mutate the central scoring registry through plan edits', () => {
    const rules = defaultSeasonRules('NBA', 'nba_points')
    rules.weights[0]!.points = 99
    expect(defaultSeasonRules('NBA', 'nba_points').weights[0]!.points).not.toBe(99)
  })
  it('accepts a complete contract with explicit timing headroom', () => {
    const config = buildSeasonBlueprint(completeConfig()).config
    expect(assessSeasonRules(config)).toEqual({ ready: true, blockers: [] })
  })
  it.each([
    ['unreviewed schedule', (c: ReturnType<typeof completeConfig>) => { c.rules.calendar.scheduleReviewed = false }],
    ['missing period', (c: ReturnType<typeof completeConfig>) => { c.rules.calendar.periods.pop() }],
    ['duplicate period', (c: ReturnType<typeof completeConfig>) => { c.rules.calendar.periods[1]!.number = 1 }],
    ['roster mismatch', (c: ReturnType<typeof completeConfig>) => { c.rules.bench++ }],
    ['duplicate stat', (c: ReturnType<typeof completeConfig>) => { c.rules.weights.push(c.rules.weights[0]!) }],
    ['unknown stat', (c: ReturnType<typeof completeConfig>) => { c.rules.weights[0]!.statKey = 'made_up_stat' }],
    ['wrong sport', (c: ReturnType<typeof completeConfig>) => { c.rules.sport = 'NFL' }],
    ['wrong preset', (c: ReturnType<typeof completeConfig>) => { c.rules.scoringPreset = 'ppr' }],
    ['empty FAAB', (c: ReturnType<typeof completeConfig>) => { c.rules.waivers.budget = 0 }],
    ['unsupported position', (c: ReturnType<typeof completeConfig>) => { c.rules.starters[0]!.position = 'QB' }],
    ['insufficient correction time', (c: ReturnType<typeof completeConfig>) => { c.rules.correctionHours = 48 }],
    ['overlapping periods', (c: ReturnType<typeof completeConfig>) => { c.rules.calendar.periods[1]!.startsAt = c.rules.calendar.periods[0]!.startsAt }],
    ['out of season', (c: ReturnType<typeof completeConfig>) => { c.rules.calendar.regularSeasonEndsAt = c.rules.calendar.periods[0]!.endsAt }],
    ['early redraft', (c: ReturnType<typeof completeConfig>) => { c.rules.calendar.drafts[1]!.startsAt = c.rules.calendar.periods[9]!.endsAt }],
    ['late draft', (c: ReturnType<typeof completeConfig>) => { c.rules.calendar.drafts[1]!.completeBy = c.rules.calendar.periods[10]!.startsAt }],
    ['missing draft', (c: ReturnType<typeof completeConfig>) => { c.rules.calendar.drafts.pop() }],
    ['duplicate draft', (c: ReturnType<typeof completeConfig>) => { c.rules.calendar.drafts[2]!.stage = 2 }],
    ['blank draft', (c: ReturnType<typeof completeConfig>) => { c.rules.calendar.drafts[0]!.startsAt = '' }],
    ['unfinalized bracket predecessor', (c: ReturnType<typeof completeConfig>) => { c.rules.calendar.periods[20]!.finalizesAt = c.rules.calendar.periods[22]!.startsAt }],
    ['trade review too long', (c: ReturnType<typeof completeConfig>) => { c.trades = true; c.rules.tradeReviewHours = c.rules.tradeDeadlineHoursBeforeCut }],
  ])('blocks %s', (_label, change) => {
    const config = completeConfig(); change(config)
    expect(assessSeasonRules(config).ready).toBe(false)
  })
  it('rejects malformed dates, invalid timezones and roster release', () => {
    const rules = defaultSeasonRules('NBA', 'nba_points')
    for (const calendar of [{ ...rules.calendar, timezone: 'Bad/Zone' }, { ...rules.calendar, regularSeasonStartsAt: '2026-10-20' }]) expect(seasonRulesSchema.safeParse({ ...rules, calendar }).success).toBe(false)
    expect(seasonRulesSchema.safeParse({ ...rules, finalRosterRelease: true }).success).toBe(false)
  })
  it('assigns postponed games by actual start with half-open boundaries', () => {
    const { rules } = completeConfig()
    const first = rules.calendar.periods[0]!, next = rules.calendar.periods[1]!
    expect(scoringPeriodForGame(rules, first.startsAt)).toBe(1)
    expect(scoringPeriodForGame(rules, first.endsAt)).toBeNull()
    expect(scoringPeriodForGame(rules, next.startsAt)).toBe(2)
    expect(scoringPeriodForGame(rules, 'bad')).toBeNull()
  })
  it('scales game limits for short and extended periods and supports all scheduled games', () => {
    const { rules } = completeConfig()
    expect(nbaStartCap(rules, 1)).toBe(34) // six days, floor(40 * 6 / 7)
    rules.nbaGames.shortPeriods = 'same_cap'
    expect(nbaStartCap(rules, 1)).toBe(40)
    rules.nbaGames.mode = 'all_scheduled'
    expect(nbaStartCap(rules, 1)).toBeNull()
  })
})

it('requires explicit transaction terms without silently adding them to an older rule snapshot', () => {
  const config = completeConfig()
  delete config.rules.transactionPolicy
  expect(buildSeasonBlueprint(config).config.rules?.transactionPolicy).toBeUndefined()
  expect(assessSeasonRules(config).ready).toBe(false)
})
