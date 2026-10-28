/**
 * League rules explainer — shared types. Pure and client-safe.
 *
 * Every explanation is DETERMINISTIC, HAND-WRITTEN TEXT: a line is an i18n key from
 * `lib/i18n/league-rules-copy.ts` plus the values it interpolates. Nothing here is generated, and
 * nothing here ever renders a raw settings value it does not have a sentence for — an unknown key
 * is omitted, never shown as JSON.
 */

/**
 * The scope of this feature (owner's decision, widened 2026-10-28 from NFL/NBA/NHL redraft and
 * guillotine): every sport AllFantasy hosts, and every format. A format whose own rules this module has
 * no sentences for (`specialty`: Survivor, Big Brother, Zombie, tournaments, salary cap…) gets the
 * basics, scoring and roster only — never a trades, waivers or playoffs line that may not apply to it.
 */
export const RULES_EXPLAINER_SPORTS = ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'] as const
export type RulesSport = (typeof RULES_EXPLAINER_SPORTS)[number]
export type RulesFormat = 'redraft' | 'guillotine' | 'keeper' | 'dynasty' | 'best_ball' | 'specialty'

/** The concepts the overview names, beyond the format itself (`overview.concept.*`). */
export const RULES_CONCEPTS = [
  'devy',
  'c2c',
  'survivor',
  'survivor_guillotine',
  'big_brother',
  'zombie',
  'tournament',
  'salary_cap',
  'king_of_the_hill',
  'pirate_vampire',
  'royal',
] as const
export type RulesConcept = (typeof RULES_CONCEPTS)[number]

export type GuillotineChopStep = { fromWeek: number; chops: number }

/**
 * A league's explainable rules, in one canonical shape. Built from the league row (and, on the
 * read path, the roster / scoring / guillotine config tables) by ./snapshot.ts.
 *
 * ⚠ THIS IS ALSO WHAT `settings_changed` EVENTS CARRY as `ruleChanges[].before/after`. Every field is
 * a non-secret league rule a member can already read on the settings page; nothing else may be added
 * here, because whatever is here is written into `league_events.payload` for every member.
 */
export type RuleSnapshot = {
  sport: string
  format: RulesFormat | null
  /** A named concept within the format (Devy within dynasty, Survivor within specialty). */
  concept?: RulesConcept | null
  /**
   * The host platform of an imported league (`sleeper`, `espn`…). Its rules are the platform's: only
   * the values an import carries are read, and nothing an import does not carry is stated.
   */
  importedFrom?: string | null
  teamCount?: number | null
  /** `settings.scoring_mode`: points, h2h_category or roto. */
  scoringMode?: string | null
  /** `League.scoring` (e.g. ppr, half_ppr, standard). */
  scoringPreset?: string | null
  /** `settings.category_record_mode`: each / most / roto. */
  categoryRecordMode?: string | null
  /** Category labels, category leagues only (read path). */
  categories?: string[] | null
  /** Effective points per stat for the sport's headline stats (read path). */
  scoringValues?: Record<string, number> | null
  /** Roster slot counts by slot key (read path, and the roster settings save). */
  rosterSlots?: Record<string, number> | null
  medianGame?: boolean | null
  playoffTeams?: number | null
  playoffStartWeek?: number | null
  playoffWeeksPerRound?: number | null
  championshipLength?: number | null
  /** Best-of lengths per round; null = cumulative (no series). NBA / NHL. */
  playoffSeries?: number[] | null
  /** Seeds that skip the first round. */
  playoffByes?: number | null
  thirdPlaceGame?: boolean | null
  tradeDeadlineWeek?: number | null
  /** ISO timestamp of a time-of-day trade deadline (`settings.trade_deadline_at`). */
  tradeDeadlineAt?: string | null
  tradeReview?: string | null
  tradeReviewHours?: number | null
  waiverType?: string | null
  waiverBudget?: number | null
  waiverMinBid?: number | null
  waiverHours?: number | null
  /** Processing days of an enabled daily claim schedule (mon…sun). */
  waiverDays?: string[] | null
  waiverProcessHour?: number | null
  /** NBA / NHL only. */
  lineupMode?: 'daily' | 'weekly' | null
  teamsPerChop?: number | null
  chopStartWeek?: number | null
  chopEndWeek?: number | null
  chopSteps?: GuillotineChopStep[] | null
  /** Week (as a string key) -> chops that week; 0 = no chop. */
  chopOverrides?: Record<string, number> | null
  chopImmunity?: string | null
  endgame?: string | null
  tiebreakers?: string[] | null
  statCorrectionHours?: number | null
  dangerMarginPoints?: number | null
  releaseTiming?: string | null
  faabOnChop?: string | null
  /** Keeper leagues: `League.keeperCount`, `keeperCostSystem`, `keeperMaxYears`. */
  keeperCount?: number | null
  keeperCost?: string | null
  keeperMaxYears?: number | null
  /** Dynasty family: whether future picks trade (`isDraftPickTradingAllowed`). */
  pickTrading?: boolean | null
  /**
   * `settings.pick_trade_deadline` (lib/trade-deadline/pickTradeDeadline.ts): `same` (with the trade
   * deadline), `open` (all season), or the week after which pick-only trades close.
   */
  pickTradeDeadline?: 'same' | 'open' | number | null
  /** `settings.pick_terms_rule.enabled` — protected and conditional picks. */
  pickTerms?: boolean | null
  /** Taxi squad (read path: lib/taxi/TaxiSettingsService.ts, the dynasty config). */
  taxiSlots?: number | null
  taxiEligibilityYears?: number | null
  taxiDeadlineWeek?: number | null
  /** `settings.taxi_max_years` — seasons a player may spend on the taxi squad; null = no limit. */
  taxiMaxYears?: number | null
  /** `settings.taxi_stealing` (lib/taxi/taxiStealing.ts): null when off; claims 0 = no limit. */
  taxiStealing?: { hours: number; claims: number } | null
}

/** Every snapshot key that can appear in a change. */
export type RuleKey = Exclude<keyof RuleSnapshot, 'sport' | 'format' | 'concept' | 'importedFrom'>

/**
 * A value inside a line: plain text / number, a nested translated phrase, a date (formatted in the
 * viewer's language), or a list of values (joined in the viewer's language).
 */
export type RuleVar =
  | string
  | number
  | { k: string; vars?: Record<string, RuleVar> }
  | { date: string }
  | { list: RuleVar[] }

export type RuleText = { k: string; vars?: Record<string, RuleVar> }

export type RuleLine = { id: string; text: RuleText }

export type RuleSectionId = 'overview' | 'scoring' | 'roster' | 'lineups' | 'playoffs' | 'trades' | 'waivers' | 'guillotine' | 'keeper' | 'dynasty'

export type RuleSection = { id: RuleSectionId; title: RuleText; lines: RuleLine[] }

/** One changed rule as stored on a `settings_changed` event. */
export type RuleChange = { key: string; before: unknown; after: unknown }

/** One explained change: "Trade deadline: Week 12 → Week 13 — trades are allowed one week longer." */
export type ChangeLine = {
  key: RuleKey
  label: RuleText
  before: RuleText
  after: RuleText
  consequence: RuleText | null
}

/** A `settings_changed` event that carries before/after values. */
export type SettingsChangeEvent = {
  id: string
  createdAt: string
  actorUserId: string | null
  changes: RuleChange[]
}

/** Changes made close together, shown as ONE card. */
export type ChangeGroup = {
  /** The newest event in the group — what "seen" is recorded up to. */
  lastEventId: string
  firstAt: string
  lastAt: string
  eventIds: string[]
  lines: ChangeLine[]
}
