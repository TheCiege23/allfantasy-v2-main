/**
 * League Mission Control — the pure rules.
 *
 * Deliberately split from `sections/missionControl.ts`, which is `server-only`.
 * Same reason `adminPreview.ts` is split from `adminPreviewServer.ts`: a module
 * that reaches `server-only` cannot be loaded by a plain script runner, so a
 * rule that lives behind it is effectively untestable. The most important rule
 * on this surface — when a score is withheld — belongs on the testable side of
 * that line.
 *
 * Everything here is a pure function of already-resolved inputs. No I/O.
 */
import type { CommandCenterSource, CommandCenterSectionId } from './types'
import { COMMAND_CENTER_NAV } from './types'
import type { MissionControlSnapshot } from '@/lib/decision-os/missionControl'

// ── Tile contract ─────────────────────────────────────────────────────────────

export type MissionControlTone = 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'unknown'

export type MissionControlTileId = 'status' | 'deadline' | 'freshness' | 'platform' | 'attention'

export interface MissionControlTile {
  id: MissionControlTileId
  label: string
  /**
   * The headline value. An em dash when the value is genuinely unknown — never
   * a zero, and never a default dressed up as a measurement.
   */
  value: string
  detail: string
  tone: MissionControlTone
  /** Same-route section link. Null when the target section is not built yet. */
  href: string | null
  /**
   * Signal coverage behind a displayed score. Non-null **only** when the tile is
   * showing a real measurement, so the UI can state how much of the composite is
   * measured rather than presenting a partly-defaulted score as a whole one.
   */
  coverage: { real: number; total: number } | null
  /**
   * Set when the tile is deliberately declining to show a value it could have
   * rendered. The UI must surface this rather than falling back to a neutral
   * empty state — "we are not measuring this" and "this is zero" are different
   * claims and must read differently.
   */
  withheldReason: WithheldReason | null
}

export type WithheldReason =
  | 'not_entitled'
  | 'health_unavailable'
  | 'no_recorded_activity'
  | 'no_deadlines_set'
  | 'never_synced'
  | 'attention_unavailable'

export interface MissionControlData {
  tiles: MissionControlTile[]
  warnings: string[]
}

// ── Section links ─────────────────────────────────────────────────────────────

const IMPLEMENTED_SECTIONS = new Set<CommandCenterSectionId>(
  COMMAND_CENTER_NAV.filter((item) => item.implemented).map((item) => item.id),
)

/**
 * Link to a section only when it is actually built. Linking an unbuilt section
 * from a summary tile turns a helpful indicator into a dead end.
 */
export function sectionHref(leagueId: string, section: CommandCenterSectionId): string | null {
  if (!IMPLEMENTED_SECTIONS.has(section)) return null
  return `/league/${leagueId}/command-center?section=${section}`
}

// ── Formatting ────────────────────────────────────────────────────────────────

/** "6h 42m", "2d 4h", "12m". Never rounds up to a unit that hides urgency. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return `${minutes}m`
}

export function toneFromHealthStatus(status: string): MissionControlTone {
  switch (status) {
    case 'excellent':
    case 'healthy':
      return 'good'
    case 'watch':
      return 'warn'
    case 'at_risk':
    case 'critical':
      return 'bad'
    default:
      return 'neutral'
  }
}

export function healthStatusLabel(status: string): string {
  switch (status) {
    case 'excellent':
      return 'Excellent'
    case 'healthy':
      return 'Healthy'
    case 'watch':
      return 'Needs attention'
    case 'at_risk':
      return 'At risk'
    case 'critical':
      return 'Critical'
    default:
      return 'Unknown'
  }
}

// ── The honesty gate ──────────────────────────────────────────────────────────

/**
 * **The honesty gate for every behavioral score on this page.**
 *
 * The league-health engine cannot distinguish "a league with no trades" from "a
 * league whose trades were never recorded", because both arrive as a count of
 * zero. For imported leagues that difference is not hypothetical: the only
 * writer for `DecisionOsImportedActivity` is a manual non-prod script
 * (`scripts/decision-os-ingest-sleeper-activity-nonprod.ts`) with no cron behind
 * it, so in production an imported league has **no** behavioral rows at all.
 *
 * Worse, the engine's schema defaults are flattering — `lineupSubmissionRate: 1.0`,
 * `abandonedTeams: 0`, `disputeCount: 0` — so a league we know nothing about
 * scores a confident, green "Healthy". That is the single most misleading thing
 * this page could render, and it would render it on the exact league in the
 * design mockup.
 *
 * So: trust the counts when the app itself writes them (native leagues), or when
 * we can see at least one real recorded event. Otherwise withhold the score.
 */
export function isSignalTrustworthy(isNative: boolean, activityEventCount: number): boolean {
  return isNative || activityEventCount > 0
}

// ── Pure tile builders ────────────────────────────────────────────────────────

export function buildStatusTile(args: {
  leagueId: string
  source: Pick<CommandCenterSource, 'isNative' | 'label'>
  snapshot: MissionControlSnapshot | null
  entitledToHealth: boolean
  /** Route the tile to the dedicated League Health section for commissioners. */
  isCommissioner?: boolean
}): MissionControlTile {
  const base = {
    id: 'status' as const,
    label: 'League Status',
    // Commissioners get the dedicated League Health section; everyone else lands
    // on the Overview health card (the `health` section is commissioner-gated).
    href: sectionHref(args.leagueId, args.isCommissioner ? 'health' : 'overview'),
    coverage: null,
  }

  if (!args.entitledToHealth) {
    return {
      ...base,
      value: 'Locked',
      detail: 'League health is part of League Intelligence.',
      tone: 'neutral',
      withheldReason: 'not_entitled',
    }
  }

  if (!args.snapshot || !args.snapshot.leagueHealth.available) {
    return {
      ...base,
      value: '—',
      detail: 'League health could not be calculated right now.',
      tone: 'unknown',
      withheldReason: 'health_unavailable',
    }
  }

  const { result } = args.snapshot.leagueHealth
  const eventCount = result.decisionOs.activityEventCount

  if (!isSignalTrustworthy(args.source.isNative, eventCount)) {
    return {
      ...base,
      value: 'Not enough signal',
      detail: `AllFantasy hasn't recorded activity for this ${args.source.label} league yet, so scoring it would be a guess.`,
      tone: 'unknown',
      withheldReason: 'no_recorded_activity',
    }
  }

  const provenance = Object.values(result.fieldProvenance)
  const realSignalCount = provenance.filter((value) => value === 'decision_os').length
  const status = String(result.engine.overallStatus)

  return {
    ...base,
    value: healthStatusLabel(status),
    detail: result.engine.summary,
    tone: toneFromHealthStatus(status),
    coverage: { real: realSignalCount, total: provenance.length },
    withheldReason: null,
  }
}

export function buildFreshnessTile(args: {
  source: Pick<CommandCenterSource, 'trustStatus' | 'trustDetail'>
}): MissionControlTile {
  const toneByTrust: Record<CommandCenterSource['trustStatus'], MissionControlTone> = {
    live: 'good',
    current: 'good',
    delayed: 'warn',
    stale: 'bad',
    unknown: 'unknown',
  }

  const valueByTrust: Record<CommandCenterSource['trustStatus'], string> = {
    live: 'Live',
    current: 'Up to date',
    delayed: 'Delayed',
    stale: 'Stale',
    unknown: '—',
  }

  return {
    id: 'freshness',
    label: 'Data Freshness',
    value: valueByTrust[args.source.trustStatus],
    detail: args.source.trustDetail,
    tone: toneByTrust[args.source.trustStatus],
    href: null,
    coverage: null,
    withheldReason: args.source.trustStatus === 'unknown' ? 'never_synced' : null,
  }
}

export function buildPlatformTile(args: {
  source: Pick<CommandCenterSource, 'label' | 'isNative' | 'capabilityNote'>
}): MissionControlTile {
  return {
    id: 'platform',
    label: 'Platform Status',
    value: args.source.label,
    detail: args.source.capabilityNote,
    // Neither native nor imported is a problem state — this tile reports a fact,
    // so it stays informational rather than borrowing a health colour.
    tone: args.source.isNative ? 'info' : 'neutral',
    href: null,
    coverage: null,
    withheldReason: null,
  }
}

export function buildAttentionTile(args: {
  leagueId: string
  /** Null when the manager snapshot could not be resolved at all. */
  managerActionCount: number | null
  commissionerActionCount: number
  /** Route the tile to the dedicated Attention Queue for commissioners. */
  isCommissioner?: boolean
}): MissionControlTile {
  const base = {
    id: 'attention' as const,
    label: 'Attention Required',
    // Commissioners get the dedicated Attention Queue; everyone else lands on the
    // Overview (the `attention` section is commissioner-gated).
    href: sectionHref(args.leagueId, args.isCommissioner ? 'attention' : 'overview'),
    coverage: null,
  }

  if (args.managerActionCount === null && args.commissionerActionCount === 0) {
    return {
      ...base,
      value: '—',
      detail: 'Outstanding actions could not be resolved right now.',
      tone: 'unknown',
      withheldReason: 'attention_unavailable',
    }
  }

  const managerCount = args.managerActionCount ?? 0
  const total = managerCount + args.commissionerActionCount

  if (total === 0) {
    return {
      ...base,
      value: 'All clear',
      detail: 'Nothing needs you in this league right now.',
      tone: 'good',
      withheldReason: null,
    }
  }

  const parts: string[] = []
  if (managerCount > 0) {
    parts.push(`${managerCount} manager action${managerCount === 1 ? '' : 's'}`)
  }
  if (args.commissionerActionCount > 0) {
    parts.push(
      `${args.commissionerActionCount} commissioner action${args.commissionerActionCount === 1 ? '' : 's'}`,
    )
  }

  return {
    ...base,
    value: String(total),
    detail: parts.join(' · '),
    tone: args.commissionerActionCount > 0 ? 'warn' : 'info',
    withheldReason: null,
  }
}
