/**
 * Commissioner Daily Brief — pure, deterministic projection of an already
 * resolved `MissionControlSnapshot`.
 *
 * This module derives NO new intelligence. Every line is a restatement of a
 * number that already lives on the snapshot, so this brief can never disagree
 * with Mission Control (which reads the same snapshot) or with
 * `buildCommissionerBrief` (whose facts also come from `context.missionControl`).
 * That shared-source guarantee is the whole point of deriving here rather than
 * assembling a second data path.
 *
 * It is deliberately distinct from the two briefs that already exist, matching
 * the same scope-split those two already establish between themselves:
 *   - `lib/decision-os/dailyBrief.ts#composeDailyBrief` — CROSS-league daily brief.
 *   - `lib/shared-services/commissioner/CommissionerBriefService#buildCommissionerBrief`
 *     — SINGLE-league WEEKLY structured brief.
 * This is the SINGLE-league DAILY narrative brief for the Command Center's
 * Attention section — a short "what changed / what needs you" summary, not a
 * structured weekly report.
 *
 * No `server-only` import: it is a pure function so it is unit-testable without
 * a server context, the same reason `missionControlRules.ts` is split out from
 * its loader.
 */
import type { MissionControlSnapshot } from '@/lib/decision-os/missionControl'

export type DailyBriefTone = 'good' | 'warn' | 'bad' | 'info'

export interface DailyBriefLine {
  id: string
  tone: DailyBriefTone
  /** Phosphor icon name. */
  icon: string
  text: string
}

export interface CommandCenterDailyBrief {
  /** False when no snapshot was available (not entitled, or resolve failed). */
  available: boolean
  greeting: string
  lines: DailyBriefLine[]
  /** True when nothing needs the commissioner's attention — an honest all-clear. */
  allClear: boolean
  /** e.g. "Updated just now", "Updated 4 minutes ago". */
  freshnessLabel: string
}

export interface DailyBriefDeadline {
  /** e.g. "Waivers", "Trade deadline". */
  label: string
  /** e.g. "in 6h 42m", "Week 11 · in 3w". */
  display: string
}

export interface BuildDailyBriefArgs {
  snapshot: MissionControlSnapshot | null
  /**
   * Whether the league is AllFantasy-native. Gates the health headline by the
   * same trustworthiness rule the Mission Control status tile uses, so an
   * imported league with no synced activity never has a flattering default
   * score stated as fact.
   */
  sourceIsNative: boolean
  /** Head commissioner's display name. Used only to personalize the greeting. */
  commissionerName: string | null
  /** True only when the viewer IS the head commissioner — gates greeting by name. */
  viewerIsHeadCommissioner: boolean
  /** The single nearest upcoming deadline, already formatted by the caller. */
  nextDeadline: DailyBriefDeadline | null
  now: Date
}

function plural(n: number, singular: string, pluralForm: string): string {
  return n === 1 ? singular : pluralForm
}

function timeOfDay(now: Date): string {
  const hour = now.getHours()
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

function freshness(now: Date, generatedAtIso: string): string {
  const generated = new Date(generatedAtIso).getTime()
  if (!Number.isFinite(generated)) return 'Freshness unknown'
  const diffMs = now.getTime() - generated
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin <= 0) return 'Updated just now'
  if (diffMin === 1) return 'Updated 1 minute ago'
  if (diffMin < 60) return `Updated ${diffMin} minutes ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr === 1) return 'Updated 1 hour ago'
  if (diffHr < 24) return `Updated ${diffHr} hours ago`
  const diffDay = Math.floor(diffHr / 24)
  return diffDay === 1 ? 'Updated 1 day ago' : `Updated ${diffDay} days ago`
}

function greetingFor(args: BuildDailyBriefArgs): string {
  const base = `Good ${timeOfDay(args.now)}`
  const name =
    args.viewerIsHeadCommissioner && args.commissionerName ? args.commissionerName.trim() : ''
  return name ? `${base}, ${name}.` : `${base}.`
}

/**
 * Build the Command Center daily brief. Never throws; an unavailable snapshot
 * yields an explicit `available: false` brief rather than an empty one.
 */
export function buildCommandCenterDailyBrief(
  args: BuildDailyBriefArgs,
): CommandCenterDailyBrief {
  const greeting = greetingFor(args)

  if (!args.snapshot) {
    return {
      available: false,
      greeting,
      lines: [],
      allClear: false,
      freshnessLabel: 'Freshness unknown',
    }
  }

  const s = args.snapshot
  const lines: DailyBriefLine[] = []

  /*
   * League health headline.
   *
   * Two honesty rules the first version violated, both fixed here:
   *  1. **Trustworthiness gate** — same rule as the Mission Control status tile.
   *     The engine scores mostly-default inputs, so an imported league with no
   *     synced activity scores a flattering "excellent". We only state a numeric
   *     score when it is native OR at least one real event was recorded.
   *  2. **Concern by `overallStatus`, not a raw score band.** The engine's own
   *     classification decides tone/concern, so a `watch` league reads as a
   *     concern (and blocks the all-clear) instead of a neutral "info".
   * `healthKnown` also gates the all-clear below — we never say "operating
   * normally" for a league whose health we could not actually measure.
   */
  let healthKnown = false
  if (s.leagueHealth.available) {
    const engine = s.leagueHealth.result.engine
    const activityEventCount = s.leagueHealth.result.decisionOs?.activityEventCount ?? 0
    const trustworthy = args.sourceIsNative || activityEventCount > 0
    if (trustworthy) {
      healthKnown = true
      const rawStatus = String(engine.overallStatus)
      const tone: DailyBriefTone =
        rawStatus === 'excellent' || rawStatus === 'healthy'
          ? 'good'
          : rawStatus === 'watch'
            ? 'warn'
            : 'bad'
      lines.push({
        id: 'health',
        tone,
        icon: 'ph-heartbeat',
        text: `League health is ${rawStatus.replace(/_/g, ' ')} (${engine.leagueHealthScore}/100).`,
      })
    } else {
      lines.push({
        id: 'health',
        tone: 'info',
        icon: 'ph-heartbeat',
        text: "League health isn't measurable yet — not enough recorded activity has synced.",
      })
    }
  } else {
    lines.push({
      id: 'health',
      tone: 'info',
      icon: 'ph-heartbeat',
      text: "League health couldn't be assessed right now — some signals are unavailable.",
    })
  }

  // Inactive managers.
  const inactive = s.managerCounts.inactiveManagers
  if (inactive > 0) {
    lines.push({
      id: 'inactive',
      tone: 'warn',
      icon: 'ph-user-minus',
      text: `${inactive} ${plural(inactive, 'manager has', 'managers have')} been inactive recently.`,
    })
  }

  // Retention risk.
  const atRisk = s.managersAtRetentionRisk.length
  if (atRisk > 0) {
    lines.push({
      id: 'retention',
      tone: 'bad',
      icon: 'ph-user-circle-minus',
      text: `${atRisk} ${plural(atRisk, 'manager shows', 'managers show')} elevated retention risk.`,
    })
  }

  // Activity trend — signed delta, no invented percentage.
  if (s.trend.available) {
    const { direction, eventCountDelta } = s.trend
    if (direction === 'decreasing') {
      const drop = Math.abs(eventCountDelta)
      lines.push({
        id: 'trend',
        tone: 'warn',
        icon: 'ph-trend-down',
        text: `League activity fell by ${drop} ${plural(drop, 'event', 'events')} vs the previous period.`,
      })
    } else if (direction === 'increasing') {
      lines.push({
        id: 'trend',
        tone: 'good',
        icon: 'ph-trend-up',
        text: `League activity rose by ${eventCountDelta} ${plural(eventCountDelta, 'event', 'events')} vs the previous period.`,
      })
    } else {
      lines.push({
        id: 'trend',
        tone: 'info',
        icon: 'ph-chart-line',
        text: 'League activity is holding steady versus the previous period.',
      })
    }
  }

  // Commissioner attention items — surface the urgent count if any.
  const urgentCount = s.recommendedActions.filter((a) => a.priority === 'urgent').length
  const totalActions = s.recommendedActions.length
  if (urgentCount > 0) {
    lines.push({
      id: 'urgent',
      tone: 'bad',
      icon: 'ph-warning-octagon',
      text: `${urgentCount} urgent ${plural(urgentCount, 'item needs', 'items need')} your review in the attention queue.`,
    })
  } else if (totalActions > 0) {
    lines.push({
      id: 'actions',
      tone: 'info',
      icon: 'ph-list-checks',
      text: `${totalActions} ${plural(totalActions, 'item is', 'items are')} in your attention queue.`,
    })
  }

  // Next deadline.
  if (args.nextDeadline) {
    lines.push({
      id: 'deadline',
      tone: 'info',
      icon: 'ph-clock-countdown',
      text: `${args.nextDeadline.label} ${args.nextDeadline.display}.`,
    })
  }

  /*
   * Honest all-clear. We only declare "operating normally" when we ACTUALLY
   * measured health (`healthKnown` — never a degraded/failed snapshot, never an
   * unmeasurable imported league), nothing is flagged as a concern, AND the
   * attention queue is genuinely empty. The last clause stops the brief from
   * saying "operating normally" while also listing items in the queue.
   */
  const hasConcern = lines.some((line) => line.tone === 'warn' || line.tone === 'bad')
  const allClear = healthKnown && !hasConcern && s.recommendedActions.length === 0
  if (allClear) {
    lines.push({
      id: 'all-clear',
      tone: 'good',
      icon: 'ph-check-circle',
      text: 'No urgent commissioner actions. The league is operating normally.',
    })
  }

  return {
    available: true,
    greeting,
    lines,
    allClear,
    freshnessLabel: freshness(args.now, s.generatedAt),
  }
}
