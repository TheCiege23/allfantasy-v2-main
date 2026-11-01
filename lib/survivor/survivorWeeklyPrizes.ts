/**
 * Weekly tribe prizes and house rules — commissioner settings, pure (no I/O; safe on the client).
 *
 * The owner's original league paid, every week before the merge:
 *  - "Total point winner will win another $100 FAAB per player for their tribe"
 *      → `winningTribeFaabPerPlayer` (0 = off, today's behaviour),
 *  - "The highest scorer on the winning tribe will receive a reward/advantage along with FAAB"
 *      → `topScorerReward` none | faab | advantage | score_boost, with `topScorerAmount`,
 *  - "Tie Breaker will be the tribe with the highest scoring QB"
 *      → `tribeTieBreakPosition` ('none' = today's tie-break on tribe id).
 *
 * Stored in `League.settings.survivorWeeklyPrizes`; the free-text house rules in
 * `League.settings.survivorHouseRules`. The season runner pays the prizes once the week's scores are
 * final (`survivorWeeklyPrizeRunner.ts`), through `applySurvivorReward`, idempotently.
 */

import { SURVIVOR_REWARD_ADVANTAGE_POWERS, type SurvivorRewardAdvantagePower, type SurvivorRewardSpec } from './survivorRewardModel'
import { settingsErrorMessages, type SettingsError, type SettingsErrorCopy } from './survivorSettingsScreenCopy'

export const SURVIVOR_WEEKLY_PRIZES_KEY = 'survivorWeeklyPrizes'
export const SURVIVOR_HOUSE_RULES_KEY = 'survivorHouseRules'
export const SURVIVOR_HOUSE_RULES_MAX = 4000

export const SURVIVOR_TOP_SCORER_REWARDS = ['none', 'faab', 'advantage', 'score_boost'] as const
export type SurvivorTopScorerReward = (typeof SURVIVOR_TOP_SCORER_REWARDS)[number]

export interface SurvivorWeeklyPrizeSettings {
  /** FAAB each active member of the week's top-scoring tribe receives. 0 = off. */
  winningTribeFaabPerPlayer: number
  /** What the top scorer on the winning tribe receives on top. */
  topScorerReward: SurvivorTopScorerReward
  /** FAAB dollars (faab) or points (score_boost, paid on NEXT week's score). */
  topScorerAmount: number
  topScorerPowerType: SurvivorRewardAdvantagePower
  /** Break a tribe-total tie by the tribe's highest-scoring starter at this position. 'none' = tribe id. */
  tribeTieBreakPosition: string
  /**
   * Also pay the prizes in a post-merge week where tribes are actually competing (a surprise
   * two-tribe week). Off by default: today's behaviour is "before the merge only".
   */
  payInTribeWeeksAfterMerge: boolean
}

export const SURVIVOR_WEEKLY_PRIZE_DEFAULTS: SurvivorWeeklyPrizeSettings = {
  winningTribeFaabPerPlayer: 0,
  topScorerReward: 'none',
  topScorerAmount: 0,
  topScorerPowerType: 'extra_vote',
  tribeTieBreakPosition: 'none',
  payInTribeWeeksAfterMerge: false,
}

export const SURVIVOR_WEEKLY_PRIZE_LIMITS = { faabPerPlayer: 1000, topScorerFaab: 1000, topScorerPoints: 200 } as const

const TIEBREAK_POSITIONS: Record<string, readonly string[]> = {
  NFL: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'],
  NBA: ['PG', 'SG', 'SF', 'PF', 'C'],
  NHL: ['C', 'LW', 'RW', 'D', 'G'],
  MLB: ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP'],
}

/** Positions a commissioner can break tribe ties on for this sport (plus 'none'). */
export function survivorTieBreakPositions(sport: string | null | undefined): readonly string[] {
  return TIEBREAK_POSITIONS[String(sport ?? 'NFL').toUpperCase()] ?? TIEBREAK_POSITIONS.NFL
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** The league's weekly prizes. Junk or missing values read as the defaults (no prizes). */
export function readSurvivorWeeklyPrizes(settings: unknown): SurvivorWeeklyPrizeSettings {
  const raw = rec(rec(settings)[SURVIVOR_WEEKLY_PRIZES_KEY])
  const d = SURVIVOR_WEEKLY_PRIZE_DEFAULTS
  const reward = typeof raw.topScorerReward === 'string' && (SURVIVOR_TOP_SCORER_REWARDS as readonly string[]).includes(raw.topScorerReward)
    ? (raw.topScorerReward as SurvivorTopScorerReward) : d.topScorerReward
  const power = typeof raw.topScorerPowerType === 'string' && (SURVIVOR_REWARD_ADVANTAGE_POWERS as readonly string[]).includes(raw.topScorerPowerType)
    ? (raw.topScorerPowerType as SurvivorRewardAdvantagePower) : d.topScorerPowerType
  const position = typeof raw.tribeTieBreakPosition === 'string' && /^[A-Z0-9]{1,4}$/.test(raw.tribeTieBreakPosition.trim().toUpperCase())
    ? raw.tribeTieBreakPosition.trim().toUpperCase() : 'none'
  return {
    winningTribeFaabPerPlayer: Math.max(0, Math.min(SURVIVOR_WEEKLY_PRIZE_LIMITS.faabPerPlayer, Math.floor(num(raw.winningTribeFaabPerPlayer, d.winningTribeFaabPerPlayer)))),
    topScorerReward: reward,
    topScorerAmount: Math.max(0, num(raw.topScorerAmount, d.topScorerAmount)),
    topScorerPowerType: power,
    tribeTieBreakPosition: position === 'NONE' ? 'none' : position,
    payInTribeWeeksAfterMerge: raw.payInTribeWeeksAfterMerge === true,
  }
}

/**
 * The tribes that actually competed in a week, read from that week's own score rows (each row keeps
 * the tribe its manager scored for): every distinct tribe except the merged tribe(s). Two or more
 * means tribes were competing that week (e.g. a surprise post-merge two-tribe week).
 */
export function competingTribeIdsFromScores(rows: readonly { tribeId: string | null }[], mergedTribeIds: Iterable<string>): string[] {
  const merged = new Set(mergedTribeIds)
  return [...new Set(rows.flatMap((r) => (r.tribeId && !merged.has(r.tribeId) ? [r.tribeId] : [])))].sort()
}

/** Plain-English problems with a prize form (empty = valid). */
export function validateSurvivorWeeklyPrizes(p: SurvivorWeeklyPrizeSettings, sport: string | null | undefined): string[] {
  return survivorWeeklyPrizeErrors(p, sport).map((e) => e.message)
}

/** The same problems with stable codes, in the reader's language (`settingsErrorMessages`). */
export function survivorWeeklyPrizeErrors(p: SurvivorWeeklyPrizeSettings, sport: string | null | undefined, t: SettingsErrorCopy = settingsErrorMessages.en): SettingsError[] {
  const errors: SettingsError[] = []
  const L = SURVIVOR_WEEKLY_PRIZE_LIMITS
  if (!Number.isInteger(p.winningTribeFaabPerPlayer) || p.winningTribeFaabPerPlayer < 0 || p.winningTribeFaabPerPlayer > L.faabPerPlayer) errors.push({ code: 'tribeFaab', message: t.tribeFaab(L.faabPerPlayer) })
  if (!(SURVIVOR_TOP_SCORER_REWARDS as readonly string[]).includes(p.topScorerReward)) errors.push({ code: 'topReward', message: t.topReward })
  if (p.topScorerReward === 'faab' && (!Number.isInteger(p.topScorerAmount) || p.topScorerAmount < 1 || p.topScorerAmount > L.topScorerFaab)) errors.push({ code: 'topFaab', message: t.topFaab(L.topScorerFaab) })
  if (p.topScorerReward === 'score_boost' && (!Number.isFinite(p.topScorerAmount) || p.topScorerAmount <= 0 || p.topScorerAmount > L.topScorerPoints)) errors.push({ code: 'topPoints', message: t.topPoints(L.topScorerPoints) })
  if (p.topScorerReward === 'advantage' && !(SURVIVOR_REWARD_ADVANTAGE_POWERS as readonly string[]).includes(p.topScorerPowerType)) errors.push({ code: 'topAdvantage', message: t.topAdvantage })
  if (p.tribeTieBreakPosition !== 'none' && !survivorTieBreakPositions(sport).includes(p.tribeTieBreakPosition)) errors.push({ code: 'tieBreak', message: t.tieBreak })
  return errors
}

export function weeklyPrizesActive(p: SurvivorWeeklyPrizeSettings): boolean {
  return p.winningTribeFaabPerPlayer > 0 || p.topScorerReward !== 'none'
}

/** The commissioner's house rules (trimmed, capped). Empty string when none. */
export function readSurvivorHouseRules(settings: unknown): string {
  const raw = rec(settings)[SURVIVOR_HOUSE_RULES_KEY]
  return typeof raw === 'string' ? raw.replace(/\r\n/g, '\n').trim().slice(0, SURVIVOR_HOUSE_RULES_MAX) : ''
}

export interface WeeklyPrizeMember {
  rosterId: string
  userId: string
  finalScore: number
}

export interface PlannedWeeklyPrize {
  idempotencyKey: string
  spec: SurvivorRewardSpec
}

/**
 * The rewards one week's prizes pay: FAAB to each member of the winning tribe, and the top-scorer
 * reward (highest final score; a tie breaks on user id, so it is reproducible). Deterministic keys
 * make the runner's every-tick call pay each prize once.
 */
export function planWeeklyTribePrizes(args: {
  leagueId: string
  week: number
  prizes: SurvivorWeeklyPrizeSettings
  winningTribeId: string
  members: readonly WeeklyPrizeMember[]
}): PlannedWeeklyPrize[] {
  const { leagueId, week, prizes, winningTribeId } = args
  const members = [...args.members].sort((a, b) => a.rosterId.localeCompare(b.rosterId))
  const out: PlannedWeeklyPrize[] = []
  if (!members.length) return out
  if (prizes.winningTribeFaabPerPlayer > 0) {
    for (const m of members) {
      out.push({
        idempotencyKey: `weekly_prize:tribe_faab:${leagueId}:${week}:${m.rosterId}`,
        spec: { type: 'faab_grant', rosterId: m.rosterId, amount: prizes.winningTribeFaabPerPlayer },
      })
    }
  }
  if (prizes.topScorerReward !== 'none') {
    const top = [...members].filter((m) => Number.isFinite(m.finalScore)).sort((a, b) => b.finalScore - a.finalScore || a.userId.localeCompare(b.userId))[0]
    if (top) {
      const key = `weekly_prize:top_scorer:${leagueId}:${week}:${winningTribeId}`
      if (prizes.topScorerReward === 'faab' && prizes.topScorerAmount >= 1) {
        out.push({ idempotencyKey: key, spec: { type: 'faab_grant', rosterId: top.rosterId, amount: Math.floor(prizes.topScorerAmount) } })
      } else if (prizes.topScorerReward === 'score_boost' && prizes.topScorerAmount > 0) {
        // This week's scores are final; the boost lands on next week's score.
        out.push({ idempotencyKey: key, spec: { type: 'score_bonus', rosterId: top.rosterId, points: Math.round(prizes.topScorerAmount * 100) / 100, targetWeek: week + 1 } })
      } else if (prizes.topScorerReward === 'advantage') {
        out.push({ idempotencyKey: key, spec: { type: 'advantage', rosterId: top.rosterId, powerType: prizes.topScorerPowerType } })
      }
    }
  }
  return out
}

/**
 * The best starter score at `position` per tribe, from per-player rows. A player listed at several
 * positions ("WR/RB") counts for each. Tribes with no such starter are absent (they lose the tie).
 */
export function tribePositionLeaders(
  rows: readonly { tribeId: string; position: string | null; points: number; isStarter: boolean }[],
  position: string,
): Map<string, number> {
  const want = position.toUpperCase()
  const out = new Map<string, number>()
  for (const row of rows) {
    if (!row.isStarter || !Number.isFinite(row.points) || !row.position) continue
    const positions = row.position.toUpperCase().split(/[\/,\s]+/).filter(Boolean)
    if (!positions.includes(want)) continue
    out.set(row.tribeId, Math.max(out.get(row.tribeId) ?? -Infinity, row.points))
  }
  return out
}
