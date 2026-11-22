/**
 * Resolves draft room config for a league: rounds, timer, order, filters.
 * Reads from League.settings when present; falls back to sport/variant draft defaults.
 */
import { prisma } from '@/lib/prisma'
import { getDraftDefaults } from '@/lib/sport-defaults/SportDefaultsRegistry'
import type { SportType } from '@/lib/sport-defaults/types'
import { toSportType } from '@/lib/sport-defaults/sport-type-utils'

export interface DraftRoomConfig {
  draft_type: 'snake' | 'linear' | 'auction'
  rounds: number
  timer_seconds: number | null
  /** Slow draft timer length in seconds (used when timer mode is slow/overnight). */
  slow_timer_seconds?: number | null
  pick_order_rules: string
  snake_or_linear: string
  third_round_reversal: boolean
  autopick_behavior: string
  queue_size_limit: number | null
  pre_draft_ranking_source: string
  roster_fill_order: string
  position_filter_behavior: string
  sport: string
  variant: string | null
}

function normalizeDraftRuntimeType(value: unknown): DraftRoomConfig['draft_type'] | null {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!raw) return null
  if (raw === 'snake' || raw === 'linear' || raw === 'auction') return raw
  if (
    raw === 'devy_snake' ||
    raw === 'c2c_snake' ||
    raw === 'mock_draft' ||
    raw === 'slow_draft' ||
    raw === 'offline' ||
    raw === 'auto' ||
    raw === 'team'
  ) return 'snake'
  // A devy / C2C league switched to linear stores its format's own id (draftTypeRegistry); without
  // this it read back as the sport default draft type.
  if (raw === 'devy_linear' || raw === 'c2c_linear') return 'linear'
  if (raw === 'devy_auction' || raw === 'c2c_auction') return 'auction'
  return null
}

/**
 * Get draft config for a league (for draft room UI and mock draft).
 * Uses League.settings when draft_rounds is set; otherwise uses sport/variant defaults.
 */
export async function getDraftConfigForLeague(leagueId: string): Promise<DraftRoomConfig | null> {
  const league = await (prisma as any).league.findUnique({
    where: { id: leagueId },
    select: { sport: true, leagueVariant: true, settings: true },
  })
  if (!league) return null

  const settings = (league.settings as Record<string, unknown>) ?? {}
  const nestedDraftSettings =
    settings.draftSettings && typeof settings.draftSettings === 'object' && !Array.isArray(settings.draftSettings)
      ? (settings.draftSettings as Record<string, unknown>)
      : {}
  const sport = (league.sport as string) || 'NFL'
  const variant = league.leagueVariant ?? null
  const sportType = toSportType(sport) as SportType
  const defaults = getDraftDefaults(sportType, variant ?? undefined)
  const fromSettings = <T>(key: string, fallback: T, nestedKey?: string): T => {
    const value = settings[key]
    if (value !== undefined && value !== null) return value as T
    const nestedValue = nestedKey ? nestedDraftSettings[nestedKey] : undefined
    return (nestedValue === undefined || nestedValue === null ? fallback : (nestedValue as T))
  }

  return {
    draft_type: normalizeDraftRuntimeType(settings.draft_type ?? nestedDraftSettings.draftType ?? settings.requested_draft_type) ?? defaults.draft_type,
    rounds: fromSettings<number>('draft_rounds', defaults.rounds_default, 'rounds'),
    timer_seconds: fromSettings<number | null>('draft_timer_seconds', defaults.timer_seconds_default, 'timerSeconds'),
    slow_timer_seconds: fromSettings<number | null>(
      'draft_slow_timer_seconds',
      Math.max(3600, Number(fromSettings<number | null>('draft_timer_seconds', defaults.timer_seconds_default, 'timerSeconds') ?? 90)),
      'slowTimerSeconds',
    ),
    pick_order_rules: fromSettings<string>('draft_pick_order_rules', defaults.pick_order_rules, 'pickOrderRules'),
    snake_or_linear: fromSettings<string>('draft_snake_or_linear', defaults.snake_or_linear_behavior ?? defaults.pick_order_rules, 'snakeOrLinear'),
    third_round_reversal: fromSettings<boolean>('draft_third_round_reversal', defaults.third_round_reversal ?? false, 'thirdRoundReversal'),
    autopick_behavior: fromSettings<string>('draft_autopick_behavior', defaults.autopick_behavior ?? 'queue-first', 'autopickBehavior'),
    queue_size_limit: fromSettings<number | null>('draft_queue_size_limit', defaults.queue_size_limit ?? null, 'queueSizeLimit'),
    pre_draft_ranking_source: fromSettings<string>('draft_pre_draft_ranking_source', defaults.pre_draft_ranking_source ?? 'adp', 'preDraftRankingSource'),
    roster_fill_order: fromSettings<string>('draft_roster_fill_order', defaults.roster_fill_order ?? 'starter_first', 'rosterFillOrder'),
    position_filter_behavior: fromSettings<string>('draft_position_filter_behavior', defaults.position_filter_behavior ?? 'by_eligibility', 'positionFilterBehavior'),
    sport,
    variant,
  }
}
