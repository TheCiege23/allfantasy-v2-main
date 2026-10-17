import { z } from 'zod'
import { TIEBREAK_RULES, WAIVER_TYPES } from './types'

const integer = z.number().int().min(0).max(2_147_483_647)
const days = z.array(z.number().int().min(0).max(7)).max(7)
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
const text = z.string().trim().min(1).max(200)
const date = z.string().refine(value => {
  const parsed = new Date(value)
  const day = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  return Boolean(day && Number.isFinite(parsed.getTime()) && new Date(day).toISOString().slice(0, 10) === day)
}, 'Invalid date')
const object = z.record(z.unknown())
const windowRules = z.object({
  submissionLocked: z.boolean().optional(), submissionLockedUntil: date.optional(),
  allowedSubmissionWeekdaysUtc: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  restrictSubmissionsToProcessingDays: z.boolean().optional(),
}).passthrough()
const engine = z.object({
  waiver_type: text.optional(), waiver_days: days.optional(), waiver_process_time: time.optional(),
  custom_daily_waivers: z.boolean().optional(), after_game_waivers: z.boolean().optional(),
  lock_dropped_players_until: text.optional(), waivers_after_add_drop: z.boolean().optional(),
  same_day_add_drop_allowed: z.boolean().optional(), can_drop_bench_after_lock: z.boolean().optional(),
  can_drop_starters_after_game_start: z.boolean().optional(), minimum_waiver_time_hours: integer.optional(),
  faab_min_bid: integer.optional(), faab_tiebreaker: text.optional(), faab_reset_date: date.optional(),
  max_claims_per_period: integer.optional(), max_adds_per_week: integer.optional(), max_drops_per_week: integer.optional(),
  commissioner_can_override: z.boolean().optional(), offseason_waiver_rules: text.optional(), playoff_waiver_rules: text.optional(),
  undroppable_player_ids: z.array(text).max(1000).optional(), allow_zero_faab_bid: z.boolean().optional(),
}).passthrough()

/** Partial overrides: omitted fields retain existing settings; null clears nullable fields. */
export const waiverSettingsRequestSchema = z.object({
  waiverType: z.enum(WAIVER_TYPES).optional(),
  processingDayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  processingTimeUtc: time.nullable().optional(),
  claimLimitPerPeriod: integer.nullable().optional(), claimLimitPerWeek: integer.nullable().optional(),
  claimLimitPerRun: integer.nullable().optional(), faabBudget: integer.nullable().optional(),
  faabResetDate: date.nullable().optional(), faabResetType: text.nullable().optional(),
  waiverOrderResetPolicy: text.nullable().optional(), postGameWaiverBehavior: text.nullable().optional(),
  processingDays: days.nullable().optional(), freeAgentWindowRules: windowRules.nullable().optional(),
  dropRestrictions: object.nullable().optional(), commissionerOverrideRules: object.nullable().optional(),
  specialtyConceptOverrides: z.object({ waiverBlocked: z.boolean().optional() }).passthrough().nullable().optional(),
  tiebreakRule: z.enum(TIEBREAK_RULES).nullable().optional(), lockType: text.nullable().optional(),
  instantFaAfterClear: z.boolean().optional(), waiverEngineConfig: engine.nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'No settings supplied')
