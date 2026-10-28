/**
 * League rules explainer — shared types. Pure and client-safe.
 *
 * Every explanation is DETERMINISTIC, HAND-WRITTEN TEXT: a line is an i18n key from
 * `lib/i18n/league-rules-copy.ts` plus the values it interpolates. Nothing here is generated, and
 * nothing here ever renders a raw settings value it does not have a sentence for — an unknown key
 * is omitted, never shown as JSON.
 */

/** The scope of this feature (owner's decision): these three sports, these two formats. */
export const RULES_EXPLAINER_SPORTS = ['NFL', 'NBA', 'NHL'] as const
export type RulesSport = (typeof RULES_EXPLAINER_SPORTS)[number]
export type RulesFormat = 'redraft' | 'guillotine'

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
}

/** Every snapshot key that can appear in a change. */
export type RuleKey = Exclude<keyof RuleSnapshot, 'sport' | 'format'>

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

export type RuleSectionId = 'overview' | 'scoring' | 'roster' | 'lineups' | 'playoffs' | 'trades' | 'waivers' | 'guillotine'

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
