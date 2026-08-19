/**
 * G15.9 — Chimmy Commissioner Intelligence grounding adapter.
 *
 * Turns the G15 read models (via the IntelligenceQueryService — the ONLY data source) into a
 * privacy-safe grounding block Chimmy can use to answer commissioner/league-health questions.
 * No raw event payloads, no chat content, no provider tokens, no user ids/names in the output;
 * cautious, non-accusatory framing is baked into the grounding text. Never throws — degrades to
 * an empty/restricted grounding so it can never break a chat turn.
 */
import {
  IntelligenceAccessError,
  type IntelligenceQueryService,
  type CommissionerActionItem,
} from '../IntelligenceQueryService'
import type { FeatureGatePrincipal } from '../featureGate'

/** Intent: does this question want commissioner/league-health intelligence? */
const INTENT_PATTERNS: RegExp[] = [
  /\binactiv/i,
  /\bcommissioner\b/i,
  /\bleague health\b/i,
  /\bpending\b/i,
  /\brecent(ly)?\b/i,
  /\bmost active\b/i,
  /\baction items?\b/i,
  /needs?.{0,20}attention/i,
  /improve.{0,24}(health|league|engagement|activity|participation)/i,
  /\bleague summary\b/i,
  /are there.{0,24}(issue|problem|pending)/i,
  /what.{0,16}happen/i,
]
export function detectCommissionerIntelligenceIntent(question: string | null | undefined): boolean {
  if (!question) return false
  return INTENT_PATTERNS.some((re) => re.test(question))
}

export type CommissionerGroundingStatus = 'ok' | 'empty' | 'restricted'
export interface CommissionerGroundingSummary {
  totalEvents: number
  lastActivityAt: string | null
  openTradeProposals: number
  counts: Record<string, number>
  health: { score: number; status: string; activeManagers: number; totalManagers: number; daysSinceLastActivity: number | null }
  actionItems: { kind: string; severity: string; message: string }[]
  recent: { type: string; summary: string; occurredAt: string }[]
}
export interface CommissionerGrounding {
  available: boolean
  status: CommissionerGroundingStatus
  /** Privacy-safe grounding text for the LLM. */
  text: string
  /** Privacy-safe structured summary (no user ids / names / payloads). */
  summary?: CommissionerGroundingSummary
}

const SAFETY_PREAMBLE =
  'COMMISSIONER INTELLIGENCE (read-only, derived from recorded in-app activity only). ' +
  'Use cautious, non-accusatory language. Do NOT allege collusion, tanking, or bad faith — ' +
  'describe engagement/activity as observations, not accusations. Frame inactivity as "appears ' +
  'inactive based on recorded activity".'

const EMPTY_TEXT =
  SAFETY_PREAMBLE +
  ' There is not enough recorded league activity yet to assess league health. ' +
  'Suggest safe next steps: confirm the season has started, encourage members to set lineups / make ' +
  'moves, and check back once activity accumulates.'

const RESTRICTED_TEXT =
  'Commissioner intelligence for this league is not available to this user (insufficient access).'

/** Pure: privacy-safe grounding text from already-fetched DTOs (no user ids / payloads). */
export function formatCommissionerGroundingText(s: CommissionerGroundingSummary): string {
  const lines: string[] = [SAFETY_PREAMBLE, '', 'League activity:']
  lines.push(`- total recorded events: ${s.totalEvents}`)
  lines.push(`- last activity: ${s.lastActivityAt ?? 'unknown'}`)
  lines.push(`- open trade proposals: ${s.openTradeProposals}`)
  const cats = Object.entries(s.counts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}=${v}`)
  if (cats.length) lines.push(`- activity by type: ${cats.join(', ')}`)
  lines.push('', 'League health:')
  lines.push(`- health score: ${s.health.score}/100 (${s.health.status})`)
  lines.push(`- active managers: ${s.health.activeManagers}/${s.health.totalManagers}`)
  lines.push(`- days since last activity: ${s.health.daysSinceLastActivity ?? 'unknown'}`)
  if (s.actionItems.length) {
    lines.push('', 'Action items (observations, not accusations):')
    for (const it of s.actionItems) lines.push(`- [${it.severity}] ${it.message}`)
  } else {
    lines.push('', 'Action items: none — league looks healthy.')
  }
  if (s.recent.length) {
    lines.push('', 'Recent timeline:')
    for (const r of s.recent) lines.push(`- ${r.summary} (${r.occurredAt})`)
  }
  return lines.join('\n')
}

function stripActionItems(items: CommissionerActionItem[]): { kind: string; severity: string; message: string }[] {
  // Drop meta (may contain league-internal user ids) — keep only safe label fields.
  return items.map((i) => ({ kind: i.kind, severity: i.severity, message: i.message }))
}

type GroundingService = Pick<
  IntelligenceQueryService,
  'getLeagueActivitySummary' | 'getLeagueHealthSnapshot' | 'getCommissionerActionItems' | 'getLeagueAuditFeed'
>

/**
 * Build the commissioner grounding for a league. Never throws: feature-gate / access errors
 * degrade to a 'restricted' grounding; empty data degrades to an 'empty' grounding.
 */
export async function buildCommissionerGrounding(args: {
  service: GroundingService
  leagueId: string
  principal?: FeatureGatePrincipal
  recentLimit?: number
}): Promise<CommissionerGrounding> {
  const { service, leagueId, principal } = args
  try {
    const [activity, health, actionItems, feed] = await Promise.all([
      service.getLeagueActivitySummary(leagueId, principal),
      service.getLeagueHealthSnapshot(leagueId, principal),
      service.getCommissionerActionItems(leagueId, principal),
      service.getLeagueAuditFeed(leagueId, { limit: args.recentLimit ?? 8 }, principal),
    ])

    if (activity.totalEvents === 0) {
      return { available: true, status: 'empty', text: EMPTY_TEXT }
    }

    const summary: CommissionerGroundingSummary = {
      totalEvents: activity.totalEvents,
      lastActivityAt: activity.lastActivityAt,
      openTradeProposals: activity.openTradeProposals,
      counts: activity.counts as unknown as Record<string, number>,
      health: {
        score: health.healthScore,
        status: health.status,
        activeManagers: health.activeManagers,
        totalManagers: health.totalManagers,
        daysSinceLastActivity: health.daysSinceLastActivity,
      },
      actionItems: stripActionItems(actionItems),
      recent: feed.items.map((i) => ({ type: i.type, summary: i.summary, occurredAt: i.occurredAt })),
    }
    return { available: true, status: 'ok', text: formatCommissionerGroundingText(summary), summary }
  } catch (err) {
    if (err instanceof IntelligenceAccessError) {
      return { available: false, status: 'restricted', text: RESTRICTED_TEXT }
    }
    // Any other failure must not break the chat turn.
    return { available: false, status: 'empty', text: EMPTY_TEXT }
  }
}
