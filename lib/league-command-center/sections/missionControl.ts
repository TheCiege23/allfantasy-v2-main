import 'server-only'

/**
 * League Mission Control — the five-tile strip directly under the hero.
 *
 * Five live indicators that summarize the league before the user scrolls:
 * League Status, Next Deadline, Data Freshness, Platform Status, Attention
 * Required. Every tile is a projection of an engine that already exists; this
 * module derives no new intelligence.
 *
 * The pure rules — including the withheld-score gate, which is the most
 * important behaviour on this surface — live in `../missionControlRules` so they
 * are testable without `server-only`. This module is only the I/O around them.
 *
 * Two properties are deliberate and load-bearing:
 *
 *  1. **Exactly one league-health resolve per page load.** `resolveMissionControlSnapshot`
 *     and `loadOverviewSection` both wrap `resolveDecisionOsLeagueHealth`, which
 *     federates league events and loops every manager. So this loader does NOT
 *     resolve it — the caller resolves once and passes the snapshot to both.
 *     Two tiles (`freshness`, `platform`) are pure projections of
 *     `CommandCenterSource` and cost no queries at all.
 *
 *  2. **Week-based milestones are never rendered as clock times.** `tradeDeadlineWeek`
 *     and `playoffStartWeek` are week numbers with no timestamp; converting them to
 *     "in 4d 6h" would invent precision the column does not carry. They render as
 *     weeks, and are only converted to days internally to order them against real
 *     timestamps.
 */
import type { CommandCenterSectionId, CommandCenterSource } from '../types'
import type { MissionControlSnapshot } from '@/lib/decision-os/missionControl'
import {
  buildAttentionTile,
  buildFreshnessTile,
  buildPlatformTile,
  buildStatusTile,
  formatDuration,
  sectionHref,
  type MissionControlData,
  type MissionControlTile,
} from '../missionControlRules'

export type {
  MissionControlData,
  MissionControlTile,
  MissionControlTileId,
  MissionControlTone,
  WithheldReason,
} from '../missionControlRules'

// ── Deadline tile (async) ─────────────────────────────────────────────────────

interface DeadlineCandidate {
  label: string
  /** Display string, e.g. "in 6h 42m" or "Week 11 · in 3w". */
  display: string
  /** Ordering key in milliseconds from now. Approximate for week-based milestones. */
  orderMs: number
  section: CommandCenterSectionId
}

async function resolveDeadlineTile(args: {
  leagueId: string
  userId: string
  now: Date
  warnings: string[]
}): Promise<MissionControlTile> {
  const base = {
    id: 'deadline' as const,
    label: 'Next Deadline',
    coverage: null,
  }

  const candidates: DeadlineCandidate[] = []

  /*
   * Waivers come from `computeWaiverTimingForLeague`, not from
   * `deriveLeagueDeadlineIntelligence`. Both can produce a waiver time, but the
   * deadline module interprets `waiverProcessTime` as UTC by its own admission,
   * while this one resolves it against `League.timezone` and returns
   * `nextWaiverProcessKnown: false` rather than guessing. A deadline that is
   * silently off by the league's UTC offset is worse than no deadline.
   */
  try {
    const { computeWaiverTimingForLeague } = await import(
      '@/lib/today-actions-engine/waiverTimingFromLeague'
    )
    const waiver = await computeWaiverTimingForLeague(args.leagueId, args.userId)
    if (waiver.nextWaiverProcessKnown && waiver.nextWaiverProcessIsoUtc) {
      const deltaMs = new Date(waiver.nextWaiverProcessIsoUtc).getTime() - args.now.getTime()
      if (deltaMs > 0) {
        candidates.push({
          label: 'Waivers',
          display: `in ${formatDuration(deltaMs)}`,
          orderMs: deltaMs,
          section: 'players',
        })
      }
    }
  } catch (error) {
    console.error('[command-center/mission-control] waiver timing failed', {
      leagueId: args.leagueId,
      error,
    })
    args.warnings.push('Waiver timing could not be resolved.')
  }

  try {
    const { deriveLeagueDeadlineIntelligence } = await import(
      '@/lib/decision-os/behavioral/deadlines/deadlineIntelligence'
    )
    const deadlines = await deriveLeagueDeadlineIntelligence(args.leagueId, undefined, args.now)

    if (deadlines?.draft && !deadlines.draft.hasPassed) {
      const deltaMs = new Date(deadlines.draft.at).getTime() - args.now.getTime()
      if (deltaMs > 0) {
        candidates.push({
          label: 'Draft',
          display: `in ${formatDuration(deltaMs)}`,
          orderMs: deltaMs,
          section: 'draft',
        })
      }
    }

    /*
     * Week milestones carry no timestamp. `weeksAway * 7 days` is used ONLY to
     * order them against real timestamps — it is never displayed, because the
     * underlying column cannot support that precision.
     */
    const weekMs = 7 * 24 * 60 * 60 * 1000
    const weekMilestones = [
      { milestone: deadlines?.tradeDeadline, label: 'Trade deadline', section: 'trades' as const },
      { milestone: deadlines?.playoffsStart, label: 'Playoffs start', section: 'standings' as const },
    ]

    for (const { milestone, label, section } of weekMilestones) {
      if (!milestone || milestone.hasPassed) continue
      const { week, weeksAway } = milestone
      candidates.push({
        label,
        display: weeksAway <= 0 ? `Week ${week} · this week` : `Week ${week} · in ${weeksAway}w`,
        orderMs: Math.max(weeksAway, 0) * weekMs,
        section,
      })
    }
  } catch (error) {
    console.error('[command-center/mission-control] deadline intelligence failed', {
      leagueId: args.leagueId,
      error,
    })
    args.warnings.push('League deadlines could not be resolved.')
  }

  if (candidates.length === 0) {
    return {
      ...base,
      value: '—',
      detail: 'No upcoming deadlines are set for this league.',
      tone: 'neutral',
      href: null,
      withheldReason: 'no_deadlines_set',
    }
  }

  candidates.sort((a, b) => a.orderMs - b.orderMs)
  const next = candidates[0]

  // Under 24h on a real timestamp is the only case that earns an urgency tone.
  const isImminent = next.orderMs < 24 * 60 * 60 * 1000

  return {
    ...base,
    value: next.label,
    detail: next.display,
    tone: isImminent ? 'warn' : 'info',
    href: sectionHref(args.leagueId, next.section),
    withheldReason: null,
  }
}

// ── Attention tile (async) ────────────────────────────────────────────────────

async function resolveAttentionTile(args: {
  leagueId: string
  userId: string
  snapshot: MissionControlSnapshot | null
  isCommissioner: boolean
  now: Date
  warnings: string[]
}): Promise<MissionControlTile> {
  let managerActionCount: number | null = null

  try {
    const { resolveManagerCommandCenterSnapshot } = await import(
      '@/lib/decision-os/managerCommandCenter'
    )
    const managerSnapshot = await resolveManagerCommandCenterSnapshot(
      args.userId,
      [args.leagueId],
      args.now,
    )
    // The attention queue already includes one signal per outstanding
    // recommendation plus retention/inactivity signals, so it is the honest
    // total on its own — adding `recommendations.length` would double-count.
    managerActionCount = managerSnapshot.attentionQueue.length
  } catch (error) {
    console.error('[command-center/mission-control] manager snapshot failed', {
      leagueId: args.leagueId,
      error,
    })
    args.warnings.push('Your outstanding actions could not be resolved.')
  }

  /*
   * Commissioner actions are additive, never a replacement — a commissioner is
   * still a manager with their own lineup to set. Same three-layer rule the
   * section components enforce via `LayerSection`.
   */
  const commissionerActionCount =
    args.isCommissioner && args.snapshot ? args.snapshot.recommendedActions.length : 0

  return buildAttentionTile({
    leagueId: args.leagueId,
    managerActionCount,
    commissionerActionCount,
    isCommissioner: args.isCommissioner,
  })
}

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loadMissionControlSection(args: {
  leagueId: string
  userId: string
  source: CommandCenterSource
  /**
   * Pre-resolved by the caller so this page makes exactly one
   * `resolveDecisionOsLeagueHealth` call. Null when the viewer is not entitled
   * to league intelligence — in which case it is never resolved at all, so the
   * gated payload never reaches the client bundle.
   */
  snapshot: MissionControlSnapshot | null
  entitledToHealth: boolean
  isCommissioner: boolean
  now?: Date
}): Promise<MissionControlData> {
  const now = args.now ?? new Date()
  const warnings: string[] = []

  // Tiles 3 and 4 are pure projections of an already-resolved view model and
  // issue no queries, so only the two genuinely async tiles are awaited here.
  const [deadline, attention] = await Promise.all([
    resolveDeadlineTile({ leagueId: args.leagueId, userId: args.userId, now, warnings }),
    resolveAttentionTile({
      leagueId: args.leagueId,
      userId: args.userId,
      snapshot: args.snapshot,
      isCommissioner: args.isCommissioner,
      now,
      warnings,
    }),
  ])

  const tiles: MissionControlTile[] = [
    buildStatusTile({
      leagueId: args.leagueId,
      source: args.source,
      snapshot: args.snapshot,
      entitledToHealth: args.entitledToHealth,
      isCommissioner: args.isCommissioner,
    }),
    deadline,
    buildFreshnessTile({ source: args.source }),
    buildPlatformTile({ source: args.source }),
    attention,
  ]

  return { tiles, warnings }
}
