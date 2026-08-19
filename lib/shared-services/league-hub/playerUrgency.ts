/**
 * Player Command Center — deterministic per-league urgency (Slice 3 of the
 * Decision OS unification follow-ons; see AF_TRADE_UNIFICATION_BRIEF.md).
 *
 * Answers the Sunday-12:05 question for one portfolio item: across every
 * league this user rosters the player in, WHICH leagues need action and HOW
 * much time is left. Pure function over the already-assembled
 * CrossLeaguePlayerPortfolioItem — no I/O, no invented data. Time pressure
 * comes only from the real next-game kickoff (item.schedule.nextGameAt);
 * when that is unknown the time dimension honestly stays null and urgency is
 * driven by injury severity + lineup exposure + existing recommendation
 * priority alone.
 */
import type {
  CrossLeaguePlayerAppearance,
  CrossLeaguePlayerPortfolioItem,
  InjuryStatus,
} from './crossLeaguePlayerPortfolio'

export type UrgencyLevel = 'critical' | 'high' | 'medium' | 'low' | 'none'

const LEVEL_RANK: Record<UrgencyLevel, number> = { critical: 4, high: 3, medium: 2, low: 1, none: 0 }

export function maxUrgency(a: UrgencyLevel, b: UrgencyLevel): UrgencyLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b
}

type InjurySeverity = 'unavailable' | 'risky' | 'watch' | 'none'

function injurySeverity(status: InjuryStatus | undefined): InjurySeverity {
  switch (status) {
    case 'out':
    case 'ir':
    case 'suspended':
      return 'unavailable'
    case 'doubtful':
      return 'risky'
    case 'questionable':
    case 'day_to_day':
      return 'watch'
    default:
      return 'none'
  }
}

export interface AppearanceUrgency {
  canonicalLeagueId: string
  leagueName: string
  level: UrgencyLevel
  /** Plain-language reasons, in priority order — real signals only. */
  reasons: string[]
  /** True when the user should act before the next lock (level critical/high). */
  actionRequired: boolean
}

export interface PlayerUrgencySummary {
  overall: UrgencyLevel
  urgentLeagueCount: number
  /** ISO time of the next relevant game lock, when known. */
  nextLockAt: string | null
  minutesToLock: number | null
  appearances: AppearanceUrgency[]
}

const HOURS = 60

function minutesUntil(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.round((t - now.getTime()) / 60_000)
}

function timePressure(minsToLock: number | null): 'imminent' | 'today' | 'ample' | 'unknown' {
  if (minsToLock == null) return 'unknown'
  if (minsToLock <= 0) return 'ample' // already locked/past — nothing can be done for this game
  if (minsToLock <= 2 * HOURS) return 'imminent'
  if (minsToLock <= 36 * HOURS) return 'today'
  return 'ample'
}

function appearanceUrgency(
  appearance: CrossLeaguePlayerAppearance,
  severity: InjurySeverity,
  pressure: ReturnType<typeof timePressure>,
): { level: UrgencyLevel; reasons: string[] } {
  const reasons: string[] = []
  let level: UrgencyLevel = 'none'

  const starting = appearance.rosterStatus === 'starter'
  const protectedSlot = appearance.rosterStatus === 'ir' || appearance.rosterStatus === 'taxi'

  if (starting && severity === 'unavailable') {
    level = pressure === 'imminent' ? 'critical' : pressure === 'today' ? 'high' : 'medium'
    reasons.push('In your starting lineup but not expected to play')
  } else if (starting && severity === 'risky') {
    level = pressure === 'imminent' || pressure === 'today' ? 'high' : 'medium'
    reasons.push('Starting with a doubtful designation')
  } else if (starting && severity === 'watch') {
    level = pressure === 'imminent' || pressure === 'today' ? 'medium' : 'low'
    reasons.push('Starting with a questionable designation')
  } else if (appearance.rosterStatus === 'bench' && severity === 'unavailable') {
    level = 'low'
    reasons.push('On your bench and unavailable — an IR/roster spot may be recoverable')
  } else if (protectedSlot) {
    level = 'none'
  }

  // Fold in the league's own recommendation priority (never downgrade).
  const recPriority = appearance.recommendation?.priority
  if (recPriority === 'critical') {
    level = maxUrgency(level, pressure === 'imminent' ? 'critical' : 'high')
    reasons.push('League recommendation flagged critical')
  } else if (recPriority === 'high') {
    level = maxUrgency(level, 'medium')
    reasons.push('League recommendation flagged high priority')
  }

  if (pressure === 'imminent' && LEVEL_RANK[level] >= LEVEL_RANK.medium) {
    reasons.push('Lineup locks within 2 hours')
  }

  return { level, reasons }
}

/**
 * Compute per-league urgency for one portfolio item. `now` is injected for
 * determinism (tests) — production callers pass the request time.
 */
export function computePlayerUrgency(item: CrossLeaguePlayerPortfolioItem, now: Date): PlayerUrgencySummary {
  const severity = injurySeverity(item.injury?.status)
  const minsToLock = minutesUntil(item.schedule?.nextGameAt, now)
  const pressure = timePressure(minsToLock)

  const appearances: AppearanceUrgency[] = item.leagueAppearances.map((a) => {
    const { level, reasons } = appearanceUrgency(a, severity, pressure)
    return {
      canonicalLeagueId: a.canonicalLeagueId,
      leagueName: a.leagueName,
      level,
      reasons,
      actionRequired: LEVEL_RANK[level] >= LEVEL_RANK.high,
    }
  })

  const overall = appearances.reduce<UrgencyLevel>((acc, a) => maxUrgency(acc, a.level), 'none')
  return {
    overall,
    urgentLeagueCount: appearances.filter((a) => a.actionRequired).length,
    nextLockAt: minsToLock != null && minsToLock > 0 ? item.schedule?.nextGameAt ?? null : null,
    minutesToLock: minsToLock != null && minsToLock > 0 ? minsToLock : null,
    appearances,
  }
}

export function urgencyRank(level: UrgencyLevel): number {
  return LEVEL_RANK[level]
}
