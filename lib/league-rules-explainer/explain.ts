/**
 * Plain-language league rules, from a RuleSnapshot. Pure and client-safe.
 *
 * 🛑 HAND-WRITTEN, NEVER GENERATED. Each line is a fixed i18n key (lib/i18n/league-rules-copy.ts) with
 * the league's values interpolated. A value this module has no sentence for is OMITTED — the line is
 * dropped — so the popup can never show a raw key, an enum token or JSON.
 */

import type {
  ChangeGroup,
  RookieDraftLotteryRule,
  ChangeLine,
  RuleChange,
  RuleKey,
  RuleLine,
  RuleSection,
  RuleSnapshot,
  RuleText,
  RuleVar,
  SettingsChangeEvent,
} from './types'
import { sameRuleValue } from './compare'
import { isChangeableRuleKey } from './changeKeys'

const P = 'leagueRules'

const text = (k: string, vars?: Record<string, RuleVar>): RuleText => (vars ? { k: `${P}.${k}`, vars } : { k: `${P}.${k}` })
const plural = (k: string, n: number, vars: Record<string, RuleVar> = {}): RuleText => text(`${k}.${n === 1 ? 'one' : 'other'}`, { n, ...vars })

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isPosInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v > 0

/* ------------------------------------------------------------------ vocabularies */

const WAIVER_TYPES = new Set(['faab', 'rolling', 'reverse_standings'])
const TRADE_REVIEWS = new Set(['commissioner', 'league_vote', 'instant', 'none'])
const SCORING_MODES = new Set(['points', 'h2h_category', 'roto'])
const RECORD_MODES = new Set(['each', 'most'])
const LINEUP_MODES = new Set(['daily', 'weekly'])
const LINEUP_LOCKS = new Set(['per_player', 'first_game', 'manual'])
const ENDGAMES = new Set(['last_team_standing', 'final_four', 'final_three', 'final_two'])
const ENDGAME_TEAMS: Record<string, number> = { final_four: 4, final_three: 3, final_two: 2 }
const RELEASES = new Set(['immediate', 'next_waiver_run'])
const FAAB_ON_CHOP = new Set(['keep', 'split'])
const IMMUNITY = new Set(['off', 'top_scorer'])
const TIEBREAKS = new Set(['bench_points', 'season_points', 'previous_period', 'draft_slot', 'commissioner', 'random'])
const DAYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
const ROOKIE_ORDERS = new Set(['max_pf', 'reverse_standings', 'commissioner', 'weighted_lottery', 'live', 'auto_worst_to_first', 'auto_reverse_max_pf'])
const DRAFT_TYPES = new Set(['linear', 'snake'])
/** The main draft (./loadDraftRules.ts). */
const MAIN_DRAFT_TYPES = new Set(['snake', 'linear', 'auction'])
const MAIN_DRAFT_ORDERS = new Set(['weighted_lottery', 'random', 'manual', 'standings', 'reverse_standings'])
const DRAFT_TIMEOUTS = new Set(['autopick', 'skip', 'wait'])
const ORPHAN_DRAFTERS = new Set(['ai', 'cpu'])
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const TANKING_PENALTIES = new Set(['forfeit_pick', 'lottery_odds', 'faab'])
const KEEPER_COSTS = new Set(['round_based', 'inflation', 'auction_value', 'free'])
const PLATFORMS = new Set(['sleeper', 'espn', 'yahoo', 'mfl', 'fleaflicker', 'fantrax', 'cbs'])

type TaxiSteal = { hours: number; claims: number }
const isTaxiSteal = (v: unknown): v is TaxiSteal =>
  !!v && typeof v === 'object' && isPosInt((v as TaxiSteal).hours) && isNum((v as TaxiSteal).claims) && Number.isInteger((v as TaxiSteal).claims) && (v as TaxiSteal).claims >= 0

/** The stats worth a line per sport, in reading order. Keys are the scoring engine's stat keys. */
export const HEADLINE_STATS: Record<string, readonly string[]> = {
  NFL: ['passing_td', 'interception', 'rushing_td', 'receptions', 'receiving_td'],
  NBA: ['points', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers', 'three_pointers_made'],
  NHL: ['goal', 'assist', 'shot_on_goal', 'blocked_shot', 'power_play_point', 'save', 'goal_allowed', 'win', 'shutout'],
  NCAAF: ['passing_td', 'interception', 'rushing_td', 'receptions', 'receiving_td'],
  NCAAB: ['points', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers', 'three_pointers_made'],
  // MLB's `win` is a pitcher win and NHL's is a goalie win: they share a stat key but not a sentence,
  // so MLB lists no `win` rather than calling it a goalie win.
  MLB: ['home_run', 'rbi', 'run', 'stolen_base', 'strikeouts_pitched', 'save'],
  SOCCER: ['goal', 'assist', 'clean_sheet', 'save', 'yellow_card', 'red_card'],
}

/** Sports scored like American football, where a catch can be worth points. */
const RECEPTION_SPORTS = new Set(['NFL', 'NCAAF'])

const BENCH_SLOTS = new Set(['BN', 'BENCH'])
const RESERVE_SLOTS = new Set(['IR', 'IR_PLUS', 'IL', 'IL_PLUS', 'RESERVE'])
const STASH_SLOTS = new Set(['TAXI', 'DEVY', 'PROSPECT', 'CAMPUS', 'RIGHTS'])
const SLOT_KEY = /^[A-Z][A-Z0-9_+/]{0,23}$/

/** "FLEX_WR_RB" -> "FLEX (WR/RB)", "IL_PLUS" -> "IL+". Position abbreviations read the same in both languages. */
export function slotLabel(key: string): string {
  const k = key.toUpperCase()
  if (k.endsWith('_PLUS')) return `${k.slice(0, -5)}+`
  if (k.startsWith('FLEX_') && k.length > 5) return `FLEX (${k.slice(5).split('_').join('/')})`
  return k.replace(/_/g, ' ')
}

type SlotSplit = { starters: string[]; bench: number; reserve: number; stash: number }

function splitSlots(slots: Record<string, number> | null | undefined): SlotSplit | null {
  if (!slots || typeof slots !== 'object') return null
  const out: SlotSplit = { starters: [], bench: 0, reserve: 0, stash: 0 }
  for (const [raw, rawCount] of Object.entries(slots)) {
    const count = Number(rawCount)
    const key = String(raw).toUpperCase()
    if (!Number.isInteger(count) || count <= 0 || !SLOT_KEY.test(key)) continue
    if (BENCH_SLOTS.has(key)) out.bench += count
    else if (RESERVE_SLOTS.has(key)) out.reserve += count
    else if (STASH_SLOTS.has(key)) out.stash += count
    else out.starters.push(count > 1 ? `${count} ${slotLabel(key)}` : slotLabel(key))
  }
  return out
}

/* ------------------------------------------------------------------ value phrases */

const week = (n: number): RuleText => text('v.week', { n })
const money = (n: number): RuleText => text('v.money', { n })

/** 90 -> "90 seconds", 120 -> "2 minutes", 28800 -> "8 hours", 86400 -> "1 day". */
function duration(sec: number): RuleText {
  if (sec % 86400 === 0) return plural('v.days', sec / 86400)
  if (sec % 3600 === 0) return plural('v.hours', sec / 3600)
  if (sec % 60 === 0) return plural('v.minutes', sec / 60)
  return plural('v.seconds', sec)
}

type OvernightPause = { from: string; to: string; picksAllowed: boolean }
const isOvernightPause = (v: unknown): v is OvernightPause =>
  !!v && typeof v === 'object' && CLOCK_TIME.test(String((v as OvernightPause).from)) && CLOCK_TIME.test(String((v as OvernightPause).to))

function describeValue(key: RuleKey, value: unknown, snapshot: Pick<RuleSnapshot, 'sport'>): RuleText | null {
  if (value === null || value === undefined) {
    switch (key) {
      case 'tradeDeadlineWeek':
      case 'tradeDeadlineAt':
        return text('v.noDeadline')
      case 'playoffSeries':
        return text('v.cumulative')
      case 'waiverDays':
        return text('v.noDailySchedule')
      case 'chopSteps':
      case 'chopOverrides':
        return text('v.noSpecialWeeks')
      case 'taxiStealing':
        return text('v.off')
      case 'taxiMaxYears':
        return text('v.noLimit')
      case 'taxiDeadlineWeek':
        return text('v.noDeadline')
      case 'rookieDraftAutoStartDays':
        return text('v.autoStart.off')
      case 'draftPickSeconds':
        return text('v.noClock')
      case 'draftOvernightPause':
      case 'draftOrphanPicks':
        return text('v.off')
      case 'draftStartAt':
        return text('v.notScheduled')
      case 'draftDevyRounds':
      case 'draftCollegeRounds':
        return text('v.off')
      default:
        return null
    }
  }
  switch (key) {
    case 'teamCount':
    case 'playoffTeams':
      return isPosInt(value) ? plural('v.teams', value) : null
    case 'playoffByes':
    case 'teamsPerChop':
      return isNum(value) && value >= 0 && Number.isInteger(value) ? text('v.count', { n: value }) : null
    case 'playoffStartWeek':
    case 'tradeDeadlineWeek':
    case 'feederTradeDeadline':
    case 'chopStartWeek':
    case 'chopEndWeek':
      return isPosInt(value) ? week(value) : null
    case 'playoffWeeksPerRound':
    case 'championshipLength':
      return isPosInt(value) ? plural('v.weeks', value) : null
    case 'tradeReviewHours':
    case 'feederTradeLockHours':
    case 'waiverHours':
    case 'statCorrectionHours':
      return isNum(value) && value >= 0 ? plural('v.hours', value) : null
    case 'waiverBudget':
    case 'feederFaabBudget':
    case 'waiverMinBid':
      return isNum(value) && value >= 0 ? money(value) : null
    case 'dangerMarginPoints':
      return isNum(value) && value >= 0 ? plural('v.points', value) : null
    case 'waiverProcessHour':
      return isNum(value) && Number.isInteger(value) && value >= 0 && value <= 23 ? text('v.hourOfDay', { h: value }) : null
    case 'medianGame':
    case 'feederFaabReset':
    case 'thirdPlaceGame':
    case 'pickTrading':
    case 'pickTerms':
      return typeof value === 'boolean' ? text(value ? 'v.on' : 'v.off') : null
    case 'keeperCount':
    case 'feederRosterSize':
    case 'feederBenchSize':
      return isNum(value) && Number.isInteger(value) && value >= 0 ? plural('v.players', value) : null
    case 'keeperMaxYears':
    case 'taxiMaxYears':
    case 'taxiEligibilityYears':
      return isPosInt(value) ? plural('v.seasons', value) : null
    case 'taxiSlots':
      return isNum(value) && Number.isInteger(value) && value >= 0 ? text('v.count', { n: value }) : null
    case 'taxiDeadlineWeek':
      return isPosInt(value) ? week(value) : null
    case 'keeperCost':
      return typeof value === 'string' && KEEPER_COSTS.has(value) ? text(`keeperCost.${value}`) : null
    case 'pickTradeDeadline':
      return value === 'same' || value === 'open' ? text(`pickDeadline.${value}`) : isPosInt(value) ? text('pickDeadline.week', { week: value }) : null
    case 'taxiStealing':
      return isTaxiSteal(value) ? plural('v.protectHours', value.hours) : null
    case 'tradeDeadlineAt':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? text('v.date', { date: { date: value } }) : null
    case 'waiverType':
    case 'feederWaiverType':
      return typeof value === 'string' && WAIVER_TYPES.has(value) ? text(`waiverType.${value}`) : null
    case 'tradeReview':
      return typeof value === 'string' && TRADE_REVIEWS.has(value) ? text(`tradeReview.${value}`) : null
    case 'scoringMode':
      return typeof value === 'string' && SCORING_MODES.has(value) ? text(`scoringMode.${value}`) : null
    case 'categoryRecordMode':
      return typeof value === 'string' && RECORD_MODES.has(value) ? text(`recordMode.${value}`) : null
    case 'scoringPreset':
    case 'feederScoring':
      return typeof value === 'string' && presetKnown(value) ? text(`preset.${value}`) : null
    case 'lineupMode':
      return typeof value === 'string' && LINEUP_MODES.has(value) ? text(`lineupMode.${value}`) : null
    case 'endgame':
      return typeof value === 'string' && ENDGAMES.has(value) ? text(`endgame.${value}`) : null
    case 'releaseTiming':
      return typeof value === 'string' && RELEASES.has(value) ? text(`release.${value}`) : null
    case 'faabOnChop':
      return typeof value === 'string' && FAAB_ON_CHOP.has(value) ? text(`faabOnChop.${value}`) : null
    case 'chopImmunity':
      return typeof value === 'string' && IMMUNITY.has(value) ? text(`immunity.${value}`) : null
    case 'tiebreakers': {
      if (!Array.isArray(value)) return null
      const known = value.filter((v): v is string => typeof v === 'string' && TIEBREAKS.has(v))
      return known.length ? text('v.list', { list: { list: known.map((v) => text(`tiebreak.${v}`)) } }) : null
    }
    case 'waiverDays': {
      if (!Array.isArray(value)) return null
      const days = value.filter((d): d is string => typeof d === 'string' && DAYS.has(d))
      return days.length ? text('v.list', { list: { list: days.map((d) => text(`day.${d}`)) } }) : text('v.noProcessingDays')
    }
    case 'playoffSeries': {
      if (!Array.isArray(value) || !value.every(isPosInt)) return null
      return text('v.list', { list: { list: value.map((n, i) => text('v.seriesRound', { round: i + 1, n })) } })
    }
    case 'rosterSlots': {
      const split = splitSlots(value as Record<string, number>)
      if (!split || split.starters.length === 0) return null
      const parts: RuleVar[] = [...split.starters]
      if (split.bench) parts.push(text('v.benchSlots', { n: split.bench }))
      if (split.reserve) parts.push(text('v.reserveSlots', { n: split.reserve }))
      return text('v.list', { list: { list: parts } })
    }
    case 'chopSteps': {
      if (!Array.isArray(value)) return null
      const steps = value.filter((s): s is { fromWeek: number; chops: number } => isPosInt((s as { fromWeek?: unknown })?.fromWeek) && isPosInt((s as { chops?: unknown })?.chops))
      return steps.length ? text('v.list', { list: { list: steps.map((s) => text('v.chopStep', { week: s.fromWeek, n: s.chops })) } }) : text('v.noSpecialWeeks')
    }
    case 'chopOverrides': {
      const items = overrideItems(value)
      return items ? (items.length ? text('v.list', { list: { list: items } }) : text('v.noSpecialWeeks')) : null
    }
    case 'rookieDraftOrder':
      return typeof value === 'string' && ROOKIE_ORDERS.has(value) ? text(`v.rookieOrder.${value}`) : null
    case 'rookieDraftType':
      return typeof value === 'string' && DRAFT_TYPES.has(value) ? text(`v.draftType.${value}`) : null
    case 'rookieDraftRounds':
      return isPosInt(value) ? plural('v.rounds', value) : null
    case 'rookieDraftAutoStartDays':
      return isPosInt(value) ? text('v.autoStart.days', { n: value }) : null
    case 'draftType':
      return typeof value === 'string' && MAIN_DRAFT_TYPES.has(value) ? text(`v.draftType.${value}`) : null
    case 'draftRounds':
      return isPosInt(value) ? plural('v.rounds', value) : null
    case 'draftPickSeconds':
      return isPosInt(value) ? duration(value) : null
    case 'draftOvernightPause':
      return isOvernightPause(value) ? text('v.timeRange', { from: value.from, to: value.to }) : null
    case 'draftOnTimeout':
      return typeof value === 'string' && DRAFT_TIMEOUTS.has(value) ? text(`v.onTimeout.${value}`) : null
    case 'draftOrderMethod':
      return typeof value === 'string' && MAIN_DRAFT_ORDERS.has(value) ? text(`v.draftOrder.${value}`) : null
    case 'draftThirdRoundReversal':
    case 'draftAutostart':
      return typeof value === 'boolean' ? text(value ? 'v.on' : 'v.off') : null
    case 'draftAuctionBudget':
      return isPosInt(value) ? money(value) : null
    case 'draftStartAt':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? text('v.date', { date: { date: value } }) : null
    case 'draftOrphanPicks':
      return typeof value === 'string' && ORPHAN_DRAFTERS.has(value) ? text(`v.orphan.${value}`) : null
    case 'draftDevyRounds':
    case 'draftCollegeRounds': {
      const rounds = roundsOf(value)
      if (!rounds) return null
      return rounds.length ? plural('v.collegeRounds', rounds.length, { rounds: roundList(rounds) }) : text('v.collegeRounds.none')
    }
    case 'rookieDraftLottery': {
      const l = lotteryOf(value)
      if (!l) return null
      const parts = { pool: lotteryPool('v.lottery.pool', l), picks: lotteryPicks(l), odds: text(`v.lottery.odds.${l.odds}`), rest: text(`v.lottery.rest.${l.rest}`) }
      // A value stored before the tiebreak was described has none, and reads as it did.
      return l.tiebreak ? text('v.lottery.withTiebreak', { ...parts, tiebreak: text(`v.lottery.tiebreak.${l.tiebreak}`) }) : text('v.lottery', parts)
    }
    case 'tankingPenalty': {
      if (!value || typeof value !== 'object') return null
      if ((value as { enabled?: unknown }).enabled === false) return text('v.off')
      const cost = tankingCost(value)
      return cost ? text('v.tanking.on', { strike: (value as { atStrike: number }).atStrike, cost }) : null
    }
    default:
      return null
  }
}

const LOTTERY_POOLS = new Set(['non_playoff', 'worst'])
const LOTTERY_ODDS = new Set(['record', 'points_for', 'max_pf', 'equal'])
const LOTTERY_REST = new Set(['reverse_standings', 'reverse_max_pf'])
const LOTTERY_TIEBREAKS = new Set(['points_for', 'max_pf', 'random'])

/** A stored rookie-lottery value this module has sentences for, or null (an unknown part drops it whole). */
function lotteryOf(value: unknown): RookieDraftLotteryRule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (!isPosInt(v.teams) || !isPosInt(v.picks) || v.picks > v.teams) return null
  if (typeof v.pool !== 'string' || !LOTTERY_POOLS.has(v.pool)) return null
  if (typeof v.odds !== 'string' || !LOTTERY_ODDS.has(v.odds)) return null
  if (typeof v.rest !== 'string' || !LOTTERY_REST.has(v.rest)) return null
  if (v.tiebreak !== undefined && (typeof v.tiebreak !== 'string' || !LOTTERY_TIEBREAKS.has(v.tiebreak))) return null
  return value as RookieDraftLotteryRule
}

const lotteryPicks = (l: RookieDraftLotteryRule): RuleText => plural('lottery.picks', l.picks)
const lotteryPool = (k: string, l: RookieDraftLotteryRule): RuleText => plural(`${k}.${l.pool}`, l.teams)
/** "The 6 worst teams that missed the playoffs draw for the first 6 picks." */
const lotteryDraw = (l: RookieDraftLotteryRule): RuleText => plural(`dynasty.lottery.draw.${l.pool}`, l.teams, { picks: lotteryPicks(l) })

/** What a confirmed tanking strike costs, as a phrase ("its round 1 draft pick"), or null. */
function tankingCost(value: unknown): RuleText | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (typeof v.penalty !== 'string' || !TANKING_PENALTIES.has(v.penalty) || !isPosInt(v.atStrike)) return null
  if (v.penalty === 'forfeit_pick') return isPosInt(v.pickRound) ? text('tankingCost.forfeit_pick', { round: v.pickRound }) : null
  if (v.penalty === 'lottery_odds') {
    if (!isPosInt(v.lotteryOddsCutPct)) return null
    return v.lotteryOddsCutPct >= 100 ? text('tankingCost.lottery_all') : text('tankingCost.lottery_odds', { pct: v.lotteryOddsCutPct })
  }
  return isPosInt(v.faabPercent) ? text('tankingCost.faab', { pct: v.faabPercent }) : null
}

/** The tanking line: off, a first-strike penalty, or warnings then the penalty. */
function tankingLine(value: unknown): RuleText | null {
  if (!value || typeof value !== 'object') return null
  if ((value as { enabled?: unknown }).enabled === false) return text('dynasty.tanking.off')
  const cost = tankingCost(value)
  const strike = (value as { atStrike?: number }).atStrike
  if (!cost || !isPosInt(strike)) return null
  return strike <= 1 ? text('dynasty.tanking.onFirst', { cost }) : text('dynasty.tanking.on', { strike, cost })
}

function overrideItems(value: unknown): RuleText[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return Object.entries(value as Record<string, unknown>)
    .map(([w, n]) => ({ week: Number(w), n: Number(n) }))
    .filter((o) => isPosInt(o.week) && Number.isInteger(o.n) && o.n >= 0)
    .sort((a, b) => a.week - b.week)
    .map((o) => (o.n === 0 ? text('v.noChopWeek', { week: o.week }) : text('v.chopWeek', { week: o.week, n: o.n })))
}

const PRESETS = new Set(['ppr', 'half_ppr', 'standard', 'te_premium', '6pt_pass_td', 'points', 'categories'])
function presetKnown(v: string): boolean {
  return PRESETS.has(v)
}

/* ------------------------------------------------------------------ full rules */

type ExplainContext = { isCommissioner?: boolean }

function line(id: string, t: RuleText | null): RuleLine | null {
  return t ? { id, text: t } : null
}

function compact(lines: Array<RuleLine | null>): RuleLine[] {
  return lines.filter((l): l is RuleLine => l !== null)
}

function scoringLines(s: RuleSnapshot): RuleLine[] {
  const mode = s.scoringMode && SCORING_MODES.has(s.scoringMode) ? s.scoringMode : 'points'
  if (mode === 'h2h_category' || mode === 'roto') {
    const cats = (s.categories ?? []).filter((c) => typeof c === 'string' && c.trim()).map((c) => c.trim())
    const record = s.categoryRecordMode && RECORD_MODES.has(s.categoryRecordMode) ? s.categoryRecordMode : null
    return compact([
      line('scoring-mode', mode === 'roto' ? text('scoring.roto') : record ? text(`scoring.h2hCategory.${record}`) : text('scoring.h2hCategory.generic')),
      line('scoring-categories', cats.length ? plural('scoring.categories', cats.length, { list: cats.join(', ') }) : null),
    ])
  }
  const values = s.scoringValues ?? null
  const headline = HEADLINE_STATS[s.sport] ?? []
  const items = values
    ? headline.filter((k) => isNum(values[k]) && values[k] !== 0).map((k) => text('scoring.statValue', { stat: text(`stat.${k}`), pts: values[k]! }))
    : []
  let ppr: RuleText | null = null
  if (RECEPTION_SPORTS.has(s.sport)) {
    const rec = values && isNum(values.receptions) ? values.receptions : s.scoringPreset === 'ppr' ? 1 : s.scoringPreset === 'half_ppr' ? 0.5 : s.scoringPreset === 'standard' ? 0 : null
    if (rec === 1) ppr = text('scoring.ppr.full')
    else if (rec === 0.5) ppr = text('scoring.ppr.half')
    else if (rec === 0) ppr = text('scoring.ppr.none')
    else if (isNum(rec) && rec > 0) ppr = text('scoring.ppr.custom', { pts: rec })
  }
  return compact([
    line('scoring-mode', text('scoring.points')),
    line('scoring-ppr', ppr),
    line('scoring-values', items.length ? text('scoring.keyValues', { list: { list: items } }) : null),
  ])
}

function rosterLines(s: RuleSnapshot): RuleLine[] {
  const split = splitSlots(s.rosterSlots)
  if (!split) return []
  return compact([
    line('roster-starters', split.starters.length ? text('roster.starters', { list: { list: split.starters } }) : null),
    line('roster-bench', split.bench ? plural('roster.bench', split.bench) : null),
    line('roster-reserve', split.reserve ? plural('roster.reserve', split.reserve) : null),
  ])
}

function playoffLines(s: RuleSnapshot): RuleLine[] {
  if (!isPosInt(s.playoffTeams)) return [{ id: 'playoffs-none', text: text('playoffs.none') }]
  const series = Array.isArray(s.playoffSeries) && s.playoffSeries.every(isPosInt) && s.playoffSeries.some((n) => n > 1) ? s.playoffSeries : null
  return compact([
    line('playoffs-field', isPosInt(s.playoffStartWeek) ? text('playoffs.field', { teams: s.playoffTeams, week: s.playoffStartWeek }) : plural('playoffs.fieldNoWeek', s.playoffTeams)),
    line('playoffs-byes', isPosInt(s.playoffByes) ? plural('playoffs.byes', s.playoffByes) : null),
    line('playoffs-round-length', !series && isPosInt(s.playoffWeeksPerRound) && s.playoffWeeksPerRound > 1 ? text('playoffs.roundWeeks', { n: s.playoffWeeksPerRound }) : null),
    line(
      'playoffs-final-length',
      !series && isPosInt(s.championshipLength) && s.championshipLength > 1 && s.championshipLength !== s.playoffWeeksPerRound
        ? text('playoffs.finalWeeks', { n: s.championshipLength })
        : null,
    ),
    line('playoffs-series', series ? text('playoffs.series', { list: describeValue('playoffSeries', series, s)!.vars!.list }) : null),
    line('playoffs-third', s.thirdPlaceGame === true ? text('playoffs.thirdPlace') : null),
  ])
}

function tradeLines(s: RuleSnapshot): RuleLine[] {
  const review = s.tradeReview && TRADE_REVIEWS.has(s.tradeReview) ? s.tradeReview : null
  if (review === 'none') return [{ id: 'trades-review', text: text('trades.review.none') }]
  const deadlineAt = typeof s.tradeDeadlineAt === 'string' && !Number.isNaN(Date.parse(s.tradeDeadlineAt)) ? s.tradeDeadlineAt : null
  return compact([
    line(
      'trades-deadline',
      deadlineAt ? text('trades.deadlineAt', { date: { date: deadlineAt } }) : isPosInt(s.tradeDeadlineWeek) ? text('trades.deadlineWeek', { week: s.tradeDeadlineWeek }) : text('trades.noDeadline'),
    ),
    line('trades-review', review ? text(`trades.review.${review}`) : null),
    line(
      'trades-review-hours',
      (review === 'commissioner' || review === 'league_vote') && isNum(s.tradeReviewHours) && s.tradeReviewHours > 0 ? plural('trades.reviewHours', s.tradeReviewHours) : null,
    ),
  ])
}

function waiverLines(s: RuleSnapshot, format: RuleSnapshot['format']): RuleLine[] {
  const type = s.waiverType && WAIVER_TYPES.has(s.waiverType) ? s.waiverType : null
  const days = describeValue('waiverDays', s.waiverDays ?? null, s)
  const hasSchedule = Array.isArray(s.waiverDays) && s.waiverDays.length > 0
  return compact([
    line(
      'waivers-type',
      type === 'faab' ? (isNum(s.waiverBudget) ? text('waivers.faab', { budget: s.waiverBudget }) : text('waivers.faabNoBudget')) : type ? text(`waivers.${type}`) : null,
    ),
    line('waivers-min-bid', type === 'faab' && isNum(s.waiverMinBid) && s.waiverMinBid > 0 ? text('waivers.minBid', { n: s.waiverMinBid }) : null),
    line('waivers-hours', isNum(s.waiverHours) && s.waiverHours > 0 ? plural('waivers.hours', s.waiverHours) : null),
    line(
      'waivers-schedule',
      hasSchedule && days && isNum(s.waiverProcessHour) ? text('waivers.schedule', { days: days.vars!.list, h: s.waiverProcessHour }) : null,
    ),
    line('waivers-chopped', format === 'guillotine' && s.releaseTiming && RELEASES.has(s.releaseTiming) ? text(`guillotine.release.${s.releaseTiming}`) : null),
  ])
}

function guillotineLines(s: RuleSnapshot): RuleLine[] {
  const perWeek = isPosInt(s.teamsPerChop) ? s.teamsPerChop : 1
  const overrides = overrideItems(s.chopOverrides) ?? []
  const steps = Array.isArray(s.chopSteps) ? s.chopSteps.filter((st) => isPosInt(st?.fromWeek) && isPosInt(st?.chops)) : []
  const endgame = s.endgame && ENDGAMES.has(s.endgame) ? s.endgame : null
  const firstTiebreak = Array.isArray(s.tiebreakers) ? s.tiebreakers.find((t) => typeof t === 'string' && TIEBREAKS.has(t)) : undefined
  return compact([
    line(
      'guillotine-chop',
      isPosInt(s.chopStartWeek) && isPosInt(s.chopEndWeek)
        ? plural('guillotine.chop', perWeek, { start: s.chopStartWeek, end: s.chopEndWeek })
        : plural('guillotine.chopNoWeeks', perWeek),
    ),
    line('guillotine-steps', steps.length ? text('guillotine.steps', { list: { list: steps.map((st) => text('v.chopStep', { week: st.fromWeek, n: st.chops })) } }) : null),
    line('guillotine-special', overrides.length ? text('guillotine.specialWeeks', { list: { list: overrides } }) : null),
    line('guillotine-immunity', s.chopImmunity === 'top_scorer' ? text('guillotine.immunity') : null),
    line('guillotine-endgame', endgame === 'last_team_standing' ? text('guillotine.endgame.last') : endgame ? text('guillotine.endgame.final', { n: ENDGAME_TEAMS[endgame]! }) : null),
    line('guillotine-tiebreak', firstTiebreak ? text('guillotine.tiebreak', { rule: text(`tiebreak.${firstTiebreak}`) }) : null),
    line('guillotine-stat-correction', isNum(s.statCorrectionHours) && s.statCorrectionHours > 0 ? plural('guillotine.statCorrection', s.statCorrectionHours) : null),
    line('guillotine-danger', isNum(s.dangerMarginPoints) && s.dangerMarginPoints > 0 ? plural('guillotine.danger', s.dangerMarginPoints) : null),
    line('guillotine-faab', s.faabOnChop && FAAB_ON_CHOP.has(s.faabOnChop) ? text(`guillotine.faab.${s.faabOnChop}`) : null),
    line('guillotine-blind-auction', s.blindAuction === true ? text('guillotine.blindAuction') : null),
  ])
}

function keeperLines(s: RuleSnapshot): RuleLine[] {
  const cost = s.keeperCost && KEEPER_COSTS.has(s.keeperCost) ? s.keeperCost : null
  return compact([
    line('keeper-count', isNum(s.keeperCount) && Number.isInteger(s.keeperCount) && s.keeperCount >= 0 ? plural('keeper.count', s.keeperCount) : null),
    line('keeper-cost', cost ? text(`keeper.cost.${cost}`) : null),
    line('keeper-years', isPosInt(s.keeperMaxYears) ? plural('keeper.maxYears', s.keeperMaxYears) : null),
  ])
}

function dynastyLines(s: RuleSnapshot): RuleLine[] {
  const slots = isNum(s.taxiSlots) && Number.isInteger(s.taxiSlots) ? s.taxiSlots : null
  const steal = isTaxiSteal(s.taxiStealing) ? s.taxiStealing : null
  return compact([
    line('dynasty-carryover', text('dynasty.carryover')),
    line('dynasty-taxi', slots == null ? null : slots > 0 ? plural('dynasty.taxi', slots) : text('dynasty.noTaxi')),
    line('dynasty-taxi-eligible', slots && isPosInt(s.taxiEligibilityYears) ? plural('dynasty.taxiEligible', s.taxiEligibilityYears) : null),
    line('dynasty-taxi-years', slots && isPosInt(s.taxiMaxYears) ? plural('dynasty.taxiMaxYears', s.taxiMaxYears) : null),
    line('dynasty-taxi-deadline', slots && isPosInt(s.taxiDeadlineWeek) ? text('dynasty.taxiDeadline', { week: s.taxiDeadlineWeek }) : null),
    line(
      'dynasty-taxi-stealing',
      slots && steal ? (steal.claims > 0 ? plural('dynasty.taxiStealing', steal.claims, { hours: steal.hours }) : text('dynasty.taxiStealingUnlimited', { hours: steal.hours })) : null,
    ),
    line('dynasty-rookie-order', s.rookieDraftOrder && ROOKIE_ORDERS.has(s.rookieDraftOrder) ? text(`dynasty.order.${s.rookieDraftOrder}`) : null),
    // The lottery's own settings, only while it is what orders the rookie draft.
    ...lotteryLines(s.rookieDraftOrder === 'weighted_lottery' ? lotteryOf(s.rookieDraftLottery) : null),
    line(
      'dynasty-rookie-rounds',
      isPosInt(s.rookieDraftRounds)
        ? plural(`dynasty.rounds.${s.rookieDraftType && DRAFT_TYPES.has(s.rookieDraftType) ? s.rookieDraftType : 'generic'}`, s.rookieDraftRounds)
        : null,
    ),
    line('dynasty-rookie-start', isPosInt(s.rookieDraftAutoStartDays) ? text('dynasty.autoStart', { n: s.rookieDraftAutoStartDays }) : null),
    line('dynasty-tanking', tankingLine(s.tankingPenalty)),
  ])
}

function lotteryLines(l: RookieDraftLotteryRule | null): Array<RuleLine | null> {
  if (!l) return []
  return [
    line('dynasty-lottery-draw', lotteryDraw(l)),
    line('dynasty-lottery-odds', text(`dynasty.lottery.odds.${l.odds}`)),
    line('dynasty-lottery-rest', text(`dynasty.lottery.rest.${l.rest}`)),
    line('dynasty-lottery-tiebreak', l.tiebreak ? text(`dynasty.lottery.tiebreak.${l.tiebreak}`) : null),
  ]
}

/** A stored college-round list this module can state: whole rounds, sorted, no repeats — else null. */
function roundsOf(value: unknown): number[] | null {
  if (!Array.isArray(value) || !value.every(isPosInt)) return null
  return [...new Set(value)].sort((a, b) => a - b)
}

/** [1, 2, 3, 4, 7, 9, 10] -> "1–4, 7, 9 and 10" (a run of three or more reads as a range). */
function roundList(rounds: number[]): RuleVar {
  const items: RuleVar[] = []
  for (let i = 0; i < rounds.length; ) {
    let j = i
    while (j + 1 < rounds.length && rounds[j + 1] === rounds[j]! + 1) j++
    if (j - i >= 2) items.push(text('v.roundRange', { from: rounds[i]!, to: rounds[j]! }))
    else for (let k = i; k <= j; k++) items.push(rounds[k]!)
    i = j + 1
  }
  return { list: items }
}

/**
 * The devy / college rounds of the main draft, as the pick check enforces them (RuleSnapshot
 * `draftDevyRounds` / `draftCollegeRounds`): which rounds take only college players, that every other
 * round refuses them, or — with the rule on and no round listed — that no college player can be
 * picked. A round list that covers the whole draft says so.
 */
function collegeRoundsLine(s: RuleSnapshot): RuleText | null {
  const kind = s.draftCollegeRounds != null ? 'collegeRounds' : s.draftDevyRounds != null ? 'devyRounds' : null
  if (!kind) return null
  const rounds = roundsOf(kind === 'collegeRounds' ? s.draftCollegeRounds : s.draftDevyRounds)
  if (!rounds) return null
  if (!rounds.length) return text(`draft.${kind}.none`)
  if (isPosInt(s.draftRounds) && rounds.length === s.draftRounds && rounds[rounds.length - 1] === s.draftRounds) return text(`draft.${kind}.all`)
  return plural(`draft.${kind}`, rounds.length, { rounds: roundList(rounds) })
}

/**
 * The main draft. Once it is complete the section stays, titled and opened as complete: its settings
 * no longer change anything this season, so nothing here reads as a rule still to come (no schedule
 * line), and a save after that publishes no change (./loadDraftRules.ts `draftRuleChanges`).
 */
function draftLines(s: RuleSnapshot): RuleLine[] {
  const type = s.draftType && MAIN_DRAFT_TYPES.has(s.draftType) ? s.draftType : null
  const status = s.draftStatus ?? null
  const seconds = isPosInt(s.draftPickSeconds) ? s.draftPickSeconds : null
  const pause = seconds && isOvernightPause(s.draftOvernightPause) ? s.draftOvernightPause : null
  const timeout = s.draftOnTimeout && DRAFT_TIMEOUTS.has(s.draftOnTimeout) ? s.draftOnTimeout : null
  const order = s.draftOrderMethod && MAIN_DRAFT_ORDERS.has(s.draftOrderMethod) ? s.draftOrderMethod : null
  const orphan = s.draftOrphanPicks && ORPHAN_DRAFTERS.has(s.draftOrphanPicks) ? s.draftOrphanPicks : null
  const startAt = typeof s.draftStartAt === 'string' && !Number.isNaN(Date.parse(s.draftStartAt)) ? s.draftStartAt : null
  return compact([
    line('draft-status', status === 'completed' ? text('draft.completed') : status === 'in_progress' ? text('draft.inProgress') : null),
    line('draft-type', type && isPosInt(s.draftRounds) ? plural(`draft.type.${type}`, s.draftRounds) : null),
    line('draft-3rr', type === 'snake' && s.draftThirdRoundReversal === true ? text('draft.thirdRoundReversal') : null),
    line('draft-college-rounds', type === 'snake' || type === 'linear' ? collegeRoundsLine(s) : null),
    line(
      'draft-auction',
      type === 'auction' && isPosInt(s.draftAuctionBudget) && isPosInt(s.draftAuctionMinBid)
        ? text('draft.auctionBudget', { budget: s.draftAuctionBudget, min: s.draftAuctionMinBid })
        : null,
    ),
    line(
      'draft-clock',
      type && seconds ? text(type === 'auction' ? 'draft.bidClock' : 'draft.pickClock', { time: duration(seconds) }) : type && type !== 'auction' ? text('draft.noClock') : null,
    ),
    line('draft-overnight', pause ? text(pause.picksAllowed ? 'draft.overnightPicks' : 'draft.overnight', { from: pause.from, to: pause.to }) : null),
    line('draft-timeout', type && seconds && timeout ? text(`draft.timeout.${timeout}`) : null),
    line('draft-order', type && order ? text(`draft.order.${order}`) : null),
    line(
      'draft-start',
      type && status === 'scheduled' ? (startAt ? text(s.draftAutostart === true ? 'draft.start.auto' : 'draft.start.manual', { date: { date: startAt } }) : text('draft.start.none')) : null,
    ),
    line('draft-orphan', type && orphan ? text(`draft.orphan.${orphan}`) : null),
  ])
}

/** Pick rules, in the trades section of a keeper or dynasty league. */
function pickLines(s: RuleSnapshot): RuleLine[] {
  if (s.format !== 'keeper' && s.format !== 'dynasty') return []
  if (s.pickTrading !== true) return compact([line('trades-picks', s.pickTrading === false ? text('trades.picks.off') : null)])
  const pd = s.pickTradeDeadline
  return compact([
    line('trades-picks', text('trades.picks.on')),
    line('trades-pick-deadline', pd === 'open' ? text('trades.pickDeadline.open') : isPosInt(pd) ? text('trades.pickDeadline.week', { week: pd }) : null),
    line('trades-pick-terms', s.pickTerms === true ? text('trades.pickTerms') : null),
  ])
}

function overviewFormat(s: RuleSnapshot): RuleText | null {
  // A named concept (Devy, C2C, Survivor…) says more than its format; the format sentence otherwise.
  if (s.concept) return text(`overview.concept.${s.concept}`)
  return s.format ? text(`overview.format.${s.format}`) : null
}

function overviewImported(s: RuleSnapshot): RuleText | null {
  if (!s.importedFrom) return null
  return PLATFORMS.has(s.importedFrom) ? text('overview.imported', { platform: text(`platform.${s.importedFrom}`) }) : text('overview.importedGeneric')
}

const FEEDER_KEYS: RuleKey[] = [
  'feederScoring', 'feederRosterSize', 'feederBenchSize', 'feederWaiverType',
  'feederFaabBudget', 'feederFaabReset', 'feederTradeDeadline', 'feederTradeLockHours',
]

function feederLines(s: RuleSnapshot): RuleLine[] {
  return FEEDER_KEYS.flatMap((key) => {
    const value = describeValue(key, s[key], s)
    return value ? [{ id: key, text: text('feeder.entry', { label: text(`label.${key}`), value }) }] : []
  })
}

/**
 * The full rules popup: one section per area, empty sections dropped.
 *
 * ⚠ WHAT A FORMAT HAS DECIDES WHAT IS SAID. A specialty game (Survivor, Big Brother…) plays its own
 * trades, waivers and finale, so it gets the basics, scoring and roster only; best ball sets no
 * lineups; an imported league states only what its import carries. Saying "no trade deadline" for a
 * league whose deadline simply is not read here would be a rule nobody set.
 */
export function explainLeagueRules(s: RuleSnapshot, ctx: ExplainContext = {}): RuleSection[] {
  const format = s.format
  const imported = Boolean(s.importedFrom)
  const seasonal = format === 'redraft' || format === 'keeper' || format === 'dynasty'
  const overview = compact([
    line('overview-commissioner', ctx.isCommissioner && !imported ? text('overview.commissionerPreview') : null),
    line('overview-imported', overviewImported(s)),
    line('overview-teams', isPosInt(s.teamCount) ? plural('overview.teams', s.teamCount) : null),
    line('overview-format', overviewFormat(s)),
    line('overview-median', seasonal && s.medianGame === true ? text('overview.median') : null),
  ])
  const lineups: RuleLine[] =
    !imported && format !== 'best_ball' && s.lineupMode && LINEUP_MODES.has(s.lineupMode)
      ? [{ id: 'lineups-mode', text: text(`lineups.${s.lineupMode}`) }]
      : []
  // When a weekly lineup locks. Every football league gets this line too, which had none.
  // Daily lineups carry no lock here: the lock reads as 'daily' and their own line explains it.
  if (!imported && format !== 'best_ball' && format !== 'specialty' && s.lineupLock && LINEUP_LOCKS.has(s.lineupLock)) {
    lineups.push({ id: 'lineups-lock', text: text(`lineups.lock.${s.lineupLock}`) })
  }
  const ownRules = !imported && format !== 'specialty' && format !== 'best_ball'
  const sections: RuleSection[] = [
    { id: 'overview', title: text('section.overview'), lines: overview },
    ...(s.concept === 'tournament' && !imported ? [{ id: 'feeder' as const, title: text('section.feeder'), lines: feederLines(s) }] : []),
    ...(format === 'guillotine' && !imported ? [{ id: 'guillotine' as const, title: text('section.guillotine'), lines: guillotineLines(s) }] : []),
    { id: 'scoring', title: text('section.scoring'), lines: scoringLines(s) },
    { id: 'roster', title: text('section.roster'), lines: rosterLines(s) },
    { id: 'lineups', title: text('section.lineups'), lines: lineups },
    ...(!imported ? [{ id: 'draft' as const, title: text(s.draftStatus === 'completed' ? 'section.draftComplete' : 'section.draft'), lines: draftLines(s) }] : []),
    ...(format === 'keeper' && !imported ? [{ id: 'keeper' as const, title: text('section.keeper'), lines: keeperLines(s) }] : []),
    ...(format === 'dynasty' && !imported ? [{ id: 'dynasty' as const, title: text('section.dynasty'), lines: dynastyLines(s) }] : []),
    ...(seasonal && (!imported || isPosInt(s.playoffTeams)) ? [{ id: 'playoffs' as const, title: text('section.playoffs'), lines: playoffLines(s) }] : []),
    ...(ownRules ? [{ id: 'trades' as const, title: text('section.trades'), lines: [...tradeLines(s), ...pickLines(s)] }] : []),
    ...(ownRules ? [{ id: 'waivers' as const, title: text('section.waivers'), lines: waiverLines(s, format) }] : []),
  ]
  return sections.filter((section) => section.lines.length > 0)
}

/* ------------------------------------------------------------------ changes */

function delta(before: unknown, after: unknown): number | null {
  return isNum(before) && isNum(after) ? after - before : null
}

function consequenceFor(key: RuleKey, before: unknown, after: unknown): RuleText | null {
  const d = delta(before, after)
  switch (key) {
    case 'tradeDeadlineWeek':
      if (d != null && d > 0) return plural('change.tradeDeadline.later', d)
      if (d != null && d < 0) return plural('change.tradeDeadline.earlier', -d)
      if (before == null && isPosInt(after)) return text('change.tradeDeadline.added', { week: after })
      if (isPosInt(before) && after == null) return text('change.tradeDeadline.removed')
      return null
    case 'playoffTeams':
      if (d != null && d > 0) return plural('change.playoffTeams.more', d)
      if (d != null && d < 0) return plural('change.playoffTeams.fewer', -d)
      return null
    case 'playoffStartWeek':
      if (d != null && d > 0) return plural('change.playoffStart.later', d)
      if (d != null && d < 0) return plural('change.playoffStart.earlier', -d)
      return null
    case 'teamCount':
      if (d != null && d > 0) return plural('change.teamCount.more', d)
      if (d != null && d < 0) return plural('change.teamCount.fewer', -d)
      return null
    case 'waiverBudget':
      if (d != null && d > 0) return text('change.waiverBudget.more', { n: d })
      if (d != null && d < 0) return text('change.waiverBudget.less', { n: -d })
      return null
    case 'waiverHours':
      if (d != null && d > 0) return plural('change.waiverHours.longer', d)
      if (d != null && d < 0) return plural('change.waiverHours.shorter', -d)
      return null
    case 'teamsPerChop':
      if (d != null && d > 0) return plural('change.teamsPerChop.more', d)
      if (d != null && d < 0) return plural('change.teamsPerChop.fewer', -d)
      return null
    case 'chopEndWeek':
      if (d != null && d > 0) return plural('change.chopEnd.later', d)
      if (d != null && d < 0) return plural('change.chopEnd.earlier', -d)
      return null
    case 'chopStartWeek':
      if (d != null && d > 0) return plural('change.chopStart.later', d)
      if (d != null && d < 0) return plural('change.chopStart.earlier', -d)
      return null
    case 'waiverType':
      return typeof after === 'string' && WAIVER_TYPES.has(after) ? text(`change.waiverType.${after}`) : null
    case 'lineupMode':
      return typeof after === 'string' && LINEUP_MODES.has(after) ? text(`change.lineupMode.${after}`) : null
    case 'medianGame':
      return typeof after === 'boolean' ? text(after ? 'change.median.on' : 'change.median.off') : null
    case 'faabOnChop':
      return typeof after === 'string' && FAAB_ON_CHOP.has(after) ? text(`guillotine.faab.${after}`) : null
    case 'releaseTiming':
      return typeof after === 'string' && RELEASES.has(after) ? text(`guillotine.release.${after}`) : null
    case 'chopImmunity':
      return after === 'top_scorer' ? text('guillotine.immunity') : after === 'off' ? text('change.immunity.off') : null
    case 'endgame':
      return after === 'last_team_standing' ? text('guillotine.endgame.last') : typeof after === 'string' && ENDGAME_TEAMS[after] ? text('guillotine.endgame.final', { n: ENDGAME_TEAMS[after]! }) : null
    case 'tradeReview':
      return typeof after === 'string' && TRADE_REVIEWS.has(after) ? text(`trades.review.${after}`) : null
    case 'thirdPlaceGame':
      return after === true ? text('playoffs.thirdPlace') : null
    case 'keeperCount':
      if (d != null && d > 0) return plural('change.keeperCount.more', d)
      if (d != null && d < 0) return plural('change.keeperCount.fewer', -d)
      return null
    case 'keeperCost':
      return typeof after === 'string' && KEEPER_COSTS.has(after) ? text(`keeper.cost.${after}`) : null
    case 'pickTrading':
      return typeof after === 'boolean' ? text(after ? 'trades.picks.on' : 'trades.picks.off') : null
    case 'pickTerms':
      return typeof after === 'boolean' ? text(after ? 'trades.pickTerms' : 'change.pickTerms.off') : null
    case 'pickTradeDeadline':
      return after === 'open' ? text('trades.pickDeadline.open') : after === 'same' ? text('change.pickDeadline.same') : isPosInt(after) ? text('trades.pickDeadline.week', { week: after }) : null
    case 'taxiSlots':
      if (d != null && d > 0) return plural('change.taxiSlots.more', d)
      if (d != null && d < 0) return plural('change.taxiSlots.fewer', -d)
      return null
    case 'taxiStealing':
      if (isTaxiSteal(after)) return after.claims > 0 ? plural('dynasty.taxiStealing', after.claims, { hours: after.hours }) : text('dynasty.taxiStealingUnlimited', { hours: after.hours })
      return after === null ? text('change.taxiStealing.off') : null
    case 'rookieDraftOrder':
      return typeof after === 'string' && ROOKIE_ORDERS.has(after) ? text(`dynasty.order.${after}`) : null
    case 'rookieDraftAutoStartDays':
      return isPosInt(after) ? text('dynasty.autoStart', { n: after }) : after == null ? text('change.autoStart.off') : null
    case 'rookieDraftLottery': {
      // The one part that moved, as its popup sentence; several at once read best from the values.
      const b = lotteryOf(before)
      const a = lotteryOf(after)
      if (!b || !a) return null
      const drawMoved = b.teams !== a.teams || b.picks !== a.picks || b.pool !== a.pool
      const tiebreakMoved = b.tiebreak !== a.tiebreak
      const moved = [drawMoved, b.odds !== a.odds, b.rest !== a.rest, tiebreakMoved].filter(Boolean).length
      if (moved !== 1) return null
      if (drawMoved) return lotteryDraw(a)
      if (tiebreakMoved) return a.tiebreak ? text(`dynasty.lottery.tiebreak.${a.tiebreak}`) : null
      return b.odds !== a.odds ? text(`dynasty.lottery.odds.${a.odds}`) : text(`dynasty.lottery.rest.${a.rest}`)
    }
    case 'tankingPenalty':
      return tankingLine(after)
    case 'draftType':
      return typeof after === 'string' && MAIN_DRAFT_TYPES.has(after) ? text(`change.draftType.${after}`) : null
    case 'draftRounds':
      if (d != null && d > 0) return plural('change.draftRounds.more', d)
      if (d != null && d < 0) return plural('change.draftRounds.fewer', -d)
      return null
    case 'draftOnTimeout':
      return typeof after === 'string' && DRAFT_TIMEOUTS.has(after) ? text(`draft.timeout.${after}`) : null
    case 'draftOrderMethod':
      return typeof after === 'string' && MAIN_DRAFT_ORDERS.has(after) ? text(`draft.order.${after}`) : null
    case 'draftThirdRoundReversal':
      return after === true ? text('draft.thirdRoundReversal') : after === false ? text('change.thirdRoundReversal.off') : null
    case 'draftAutostart':
      return after === true ? text('change.autostart.on') : after === false ? text('change.autostart.off') : null
    case 'draftOrphanPicks':
      return typeof after === 'string' && ORPHAN_DRAFTERS.has(after) ? text(`draft.orphan.${after}`) : after == null ? text('change.orphan.off') : null
    case 'draftDevyRounds':
    case 'draftCollegeRounds': {
      if (after == null) return text('change.collegeRounds.off')
      const rounds = roundsOf(after)
      if (!rounds) return null
      return rounds.length ? plural('change.collegeRounds.set', rounds.length, { rounds: roundList(rounds) }) : text('change.collegeRounds.none')
    }
    default:
      return null
  }
}

/**
 * One change, explained — or null when it cannot be (an unknown key, or a value with no sentence).
 * A dropped change is never shown, so a member never sees "teamsPerChop: 2".
 */
export function explainRuleChange(change: RuleChange, snapshot: Pick<RuleSnapshot, 'sport'> = { sport: '' }): ChangeLine | null {
  const key = change.key as RuleKey
  if (!isChangeableRuleKey(key)) return null
  const before = describeValue(key, change.before ?? null, snapshot)
  const after = describeValue(key, change.after ?? null, snapshot)
  if (!before || !after) return null
  // A change that reads the same on both sides tells members nothing — e.g. roster slots that differ
  // only in a taxi / devy stash, which the roster sentence leaves to its own line.
  if (sameRuleValue(before, after)) return null
  return { key, label: text(`label.${key}`), before, after, consequence: consequenceFor(key, change.before ?? null, change.after ?? null) }
}

/** Changes this close together form one card (owner's spec: "within ~10 minutes of each other"). */
export const CHANGE_GROUP_WINDOW_MS = 10 * 60 * 1000

/**
 * Group events into cards. An event joins the current group when it is within the window of the
 * group's PREVIOUS event, so a commissioner saving five pages over twelve minutes gets one card. Within
 * a group a key changed twice shows first-before → last-after, and a change that was undone inside the
 * group disappears. Groups come back newest first.
 */
export function groupSettingsChanges(
  events: readonly SettingsChangeEvent[],
  snapshot: Pick<RuleSnapshot, 'sport'>,
  windowMs: number = CHANGE_GROUP_WINDOW_MS,
): ChangeGroup[] {
  const sorted = [...events]
    .filter((e) => Number.isFinite(Date.parse(e.createdAt)))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
  const raw: SettingsChangeEvent[][] = []
  for (const ev of sorted) {
    const current = raw[raw.length - 1]
    const prev = current?.[current.length - 1]
    if (current && prev && Date.parse(ev.createdAt) - Date.parse(prev.createdAt) <= windowMs) current.push(ev)
    else raw.push([ev])
  }
  const groups: ChangeGroup[] = []
  for (const evs of raw) {
    const merged = new Map<string, { before: unknown; after: unknown }>()
    for (const ev of evs) {
      for (const c of ev.changes) {
        const seen = merged.get(c.key)
        if (seen) seen.after = c.after
        else merged.set(c.key, { before: c.before, after: c.after })
      }
    }
    const lines: ChangeLine[] = []
    for (const [key, v] of merged) {
      if (sameRuleValue(v.before, v.after)) continue
      const explained = explainRuleChange({ key, before: v.before, after: v.after }, snapshot)
      if (explained) lines.push(explained)
    }
    if (!lines.length) continue
    const last = evs[evs.length - 1]!
    groups.push({ lastEventId: last.id, firstAt: evs[0]!.createdAt, lastAt: last.createdAt, eventIds: evs.map((e) => e.id), lines })
  }
  return groups.reverse()
}
