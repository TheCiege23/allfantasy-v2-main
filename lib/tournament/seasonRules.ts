import { z } from 'zod'
import { getDefaultScoringTemplate, SCORING_DEFAULTS_REGISTRY_VERSION } from '@/lib/scoring-defaults/ScoringDefaultsRegistry'
import type { SeasonBlueprint } from './seasonBlueprint'

const instant = z.union([z.literal(''), z.string().datetime({ offset: true })])
export const seasonRulesSchema = z.object({
  version: z.literal(1),
  sport: z.enum(['NFL', 'NBA']),
  scoringPreset: z.enum(['ppr', 'half_ppr', 'standard', 'nba_points']),
  scoringSourceVersion: z.string().min(1).max(80),
  weights: z.array(z.object({ statKey: z.string().min(1).max(80), points: z.number().finite().min(-100).max(100) })).min(1).max(300),
  starters: z.array(z.object({ position: z.string().min(1).max(20), count: z.number().int().min(0).max(10) })).min(1).max(12),
  bench: z.number().int().min(0).max(19),
  ir: z.number().int().min(0).max(5),
  draftPolicy: z.object({ version: z.literal(1), openingOrder: z.literal('audited_shuffle'), laterOrder: z.literal('previous_seed'), autodraft: z.literal('best_available_legal'), pickClockSeconds: z.number().int().min(10).max(300), auctionBudget: z.number().int().min(10).max(1000), nominationClockSeconds: z.number().int().min(10).max(120), bidExtensionSeconds: z.number().int().min(5).max(60), minimumBid: z.literal(1) }).optional(),
  transactionPolicy: z.object({
    version: z.literal(1), irEligibleStatuses: z.array(z.enum(['IR', 'OUT', 'INJURED'])).min(1).max(3),
    ineligibleIr: z.literal('block_adds_until_corrected'), waiverInitialPriority: z.literal('reverse_draft_order'),
    waiverTie: z.literal('rolling_priority'), zeroDollarBids: z.boolean(),
    resetBudgetAndPriorityEachDraft: z.literal(true), finalTrades: z.literal(false),
  }).optional(),
  lineupLock: z.enum(['individual_game', 'period_start']),
  nbaGames: z.object({ mode: z.enum(['capped_starts', 'all_scheduled']), startsPerPeriod: z.number().int().min(1).max(100), shortPeriods: z.enum(['same_cap', 'prorate_by_days']) }),
  waivers: z.object({ mode: z.enum(['faab', 'rolling_priority']), budget: z.number().int().min(0).max(1000), processingHourUtc: z.number().int().min(0).max(23), holdHours: z.number().int().min(0).max(72) }),
  tradeDeadlineHoursBeforeCut: z.number().int().min(1).max(168),
  tradeReviewHours: z.number().int().min(0).max(72),
  correctionHours: z.number().int().min(1).max(168),
  postponements: z.literal('actual_game_start_period'),
  unresolvedTies: z.literal('audited_commissioner_resolution'),
  finalRosterRelease: z.literal(false),
  calendar: z.object({
    timezone: z.string().min(1).max(80).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false } }, 'Choose a valid IANA time zone.'),
    seasonLabel: z.string().trim().max(40),
    sourceUrl: z.union([z.literal(''), z.string().url().max(500)]),
    regularSeasonStartsAt: instant,
    regularSeasonEndsAt: instant,
    scheduleReviewed: z.boolean(),
    periods: z.array(z.object({ number: z.number().int().min(1).max(30), startsAt: instant, endsAt: instant, finalizesAt: instant })).max(30),
    drafts: z.array(z.object({ stage: z.number().int().min(1).max(3), startsAt: instant, completeBy: instant })).max(3),
  }),
})
export type SeasonRules = z.infer<typeof seasonRulesSchema>

/** Snapshot defaults into the saved plan; future registry changes cannot silently alter its rules. */
export function defaultSeasonRules(sport: 'NFL' | 'NBA', preset: SeasonBlueprint['scoring']): SeasonRules {
  const template = getDefaultScoringTemplate(sport, preset === 'nba_points' ? 'points' : preset === 'half_ppr' ? 'half_ppr' : preset)
  return {
    version: 1, sport, scoringPreset: preset, scoringSourceVersion: SCORING_DEFAULTS_REGISTRY_VERSION,
    weights: template.rules.filter(r => r.enabled).map(r => ({ statKey: r.statKey, points: r.pointsValue * r.multiplier })),
    starters: Object.entries(sport === 'NBA' ? { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 1 } : { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 }).map(([position, count]) => ({ position, count })),
    draftPolicy: { version: 1, openingOrder: 'audited_shuffle', laterOrder: 'previous_seed', autodraft: 'best_available_legal', pickClockSeconds: 90, auctionBudget: 200, nominationClockSeconds: 30, bidExtensionSeconds: 10, minimumBid: 1 },
    transactionPolicy: { version: 1, irEligibleStatuses: sport === 'NBA' ? ['OUT', 'INJURED'] : ['IR', 'OUT'], ineligibleIr: 'block_adds_until_corrected', waiverInitialPriority: 'reverse_draft_order', waiverTie: 'rolling_priority', zeroDollarBids: true, resetBudgetAndPriorityEachDraft: true, finalTrades: false },
    bench: sport === 'NBA' ? 4 : 6, ir: 2, lineupLock: 'individual_game',
    nbaGames: { mode: 'capped_starts', startsPerPeriod: 40, shortPeriods: 'prorate_by_days' },
    waivers: { mode: 'faab', budget: 100, processingHourUtc: 8, holdHours: 24 },
    tradeDeadlineHoursBeforeCut: 48, tradeReviewHours: 24, correctionHours: 24,
    postponements: 'actual_game_start_period', unresolvedTies: 'audited_commissioner_resolution', finalRosterRelease: false,
    calendar: { timezone: 'America/New_York', seasonLabel: '', sourceUrl: '', regularSeasonStartsAt: '', regularSeasonEndsAt: '', scheduleReviewed: false, periods: [], drafts: [] },
  }
}

/** Configuration readiness only; provider coverage and execution services have separate launch gates. */
export function assessSeasonRules(config: SeasonBlueprint) {
  const blockers: string[] = []
  const r = config.rules
  if (!r) return { ready: false, blockers: ['Add playing rules and a dated season calendar.'] }
  const add = (condition: boolean, message: string) => { if (condition) blockers.push(message) }
  add(r.sport !== config.sport || r.scoringPreset !== config.scoring, 'Refresh the playing rules for the selected sport and scoring preset.')
  add(!r.draftPolicy, 'Add draft order, clocks and auction terms before publication.')
  add(config.draftType === 'auction' && !!r.draftPolicy && r.draftPolicy.auctionBudget < config.rosterSize, 'Auction budget must cover at least one dollar per drafted roster spot.')
  add(!r.transactionPolicy, 'Add the IR and waiver transaction policy before publishing or opening registration.')
  add(!!r.transactionPolicy && new Set(r.transactionPolicy.irEligibleStatuses).size !== r.transactionPolicy.irEligibleStatuses.length, 'IR eligibility statuses must be unique.')
  const allowedStats = new Set(getDefaultScoringTemplate(config.sport, config.scoring === 'nba_points' ? 'points' : config.scoring).rules.map(s => s.statKey))
  add(new Set(r.weights.map(s => s.statKey)).size !== r.weights.length || r.weights.some(s => !allowedStats.has(s.statKey)), 'Scoring must contain distinct supported stat keys.')
  add(!r.weights.some(s => s.points !== 0), 'Enable at least one nonzero scoring weight.')
  const allowedSlots = config.sport === 'NBA' ? ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'] : ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DST']
  add(new Set(r.starters.map(s => s.position)).size !== r.starters.length || r.starters.some(s => !allowedSlots.includes(s.position)), 'Starter positions must be distinct and supported by this sport.')
  const starters = r.starters.reduce((sum, s) => sum + s.count, 0)
  add(starters < 1 || starters + r.bench !== config.rosterSize, 'Starters plus bench must equal total drafted roster slots. IR slots are additional.')
  add(r.waivers.mode === 'faab' && r.waivers.budget === 0, 'FAAB requires a positive budget.')
  add(config.trades && r.tradeReviewHours >= r.tradeDeadlineHoursBeforeCut, 'The trade deadline must leave time for review before each cut.')
  const c = r.calendar
  add(!c.seasonLabel || !c.sourceUrl || !c.scheduleReviewed, 'Add a season label and schedule source, then confirm the scoring calendar has been reviewed against actual games.')
  const ms = (value: string) => value ? Date.parse(value) : NaN
  const seasonStart = ms(c.regularSeasonStartsAt), seasonEnd = ms(c.regularSeasonEndsAt)
  add(!Number.isFinite(seasonStart) || !Number.isFinite(seasonEnd) || seasonStart >= seasonEnd, 'Set valid regular-season start and end timestamps.')
  const expected = Array.from({ length: config.finalWeek - config.startWeek + 1 }, (_, i) => config.startWeek + i)
  add(c.periods.length !== expected.length || new Set(c.periods.map(p => p.number)).size !== c.periods.length || expected.some(n => !c.periods.some(p => p.number === n)), 'Provide exactly one dated window for every configured scoring period.')
  const periods = [...c.periods].sort((a, b) => a.number - b.number)
  periods.forEach((p, i) => {
    const start = ms(p.startsAt), end = ms(p.endsAt), finalize = ms(p.finalizesAt)
    add(!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(finalize) || start >= end || finalize - end < r.correctionHours * 3600000, `Period ${p.number}: set start, end and finalization with the full correction window.`)
    add(start < seasonStart || end > seasonEnd, `Period ${p.number}: scoring must stay inside the regular season.`)
    add(p.number > config.secondCutWeek + 1 && i > 0 && start < ms(periods[i - 1]!.finalizesAt), `Period ${p.number}: the prior bracket result must finalize before the next matchup begins.`)
    add(i > 0 && start < ms(periods[i - 1]!.endsAt), `Period ${p.number}: scoring windows cannot overlap.`)
  })
  add(c.drafts.length !== 3 || new Set(c.drafts.map(d => d.stage)).size !== 3, 'Schedule one draft window for each of the three stages.')
  for (const stage of [1, 2, 3]) {
    const draft = c.drafts.find(d => d.stage === stage)
    if (!draft) continue
    const first = c.periods.find(p => p.number === (stage === 1 ? config.startWeek : stage === 2 ? config.firstCutWeek + 1 : config.secondCutWeek + 1))
    const prior = c.periods.find(p => p.number === (stage === 2 ? config.firstCutWeek : config.secondCutWeek))
    const start = ms(draft.startsAt), end = ms(draft.completeBy)
    add(!Number.isFinite(start) || !Number.isFinite(end) || start >= end, `Stage ${stage}: set a draft start and completion deadline.`)
    add(stage > 1 && (!prior || !Number.isFinite(ms(prior.finalizesAt)) || start < ms(prior.finalizesAt)), `Stage ${stage}: redraft must start after the previous cut's scores finalize.`)
    add(!first || !Number.isFinite(ms(first.startsAt)) || end + config.redraftBufferHours * 3600000 > ms(first.startsAt), `Stage ${stage}: draft completion must leave ${config.redraftBufferHours} hours before scoring starts.`)
  }
  return { ready: blockers.length === 0, blockers }
}

/** Half-open scoring windows: a game at the boundary belongs to the next window. */
export function scoringPeriodForGame(rules: SeasonRules, actualStartsAt: string): number | null {
  const time = Date.parse(actualStartsAt)
  const matches = rules.calendar.periods.filter(p => time >= Date.parse(p.startsAt) && time < Date.parse(p.endsAt))
  if (matches.length > 1) throw new Error('Overlapping scoring windows')
  return matches[0]?.number ?? null
}

/** Counted starts are consumed by eligible starters in actual tipoff order; the ingest adapter must enforce this. */
export function nbaStartCap(rules: SeasonRules, periodNumber: number): number | null {
  if (rules.nbaGames.mode === 'all_scheduled') return null
  const period = rules.calendar.periods.find(p => p.number === periodNumber)
  if (!period || !period.startsAt || !period.endsAt) throw new Error('A dated period is required')
  const days = (Date.parse(period.endsAt) - Date.parse(period.startsAt)) / 86400000
  if (days <= 0) throw new Error('Invalid scoring window')
  return rules.nbaGames.shortPeriods === 'same_cap' ? rules.nbaGames.startsPerPeriod : Math.max(1, Math.floor(rules.nbaGames.startsPerPeriod * days / 7))
}
