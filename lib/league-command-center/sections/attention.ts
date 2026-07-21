import 'server-only'

/**
 * Attention Queue section — the Commissioner HQ home.
 *
 * Composed entirely from the already-resolved `MissionControlSnapshot` plus one
 * bounded resolve of the viewer's OWN manager actions. It derives no new
 * intelligence: the commissioner queue is a severity projection of the
 * snapshot's `recommendedActions` (themselves the federated health engine's
 * `urgentAlerts` + `interventionRecommendations`), and the Daily Brief is a
 * restatement of snapshot counts. Because both read the same snapshot Mission
 * Control reads, none of the three surfaces can disagree.
 */
import type { MissionControlSnapshot } from '@/lib/decision-os/missionControl'
import type { ManagerAtRetentionRisk } from '@/lib/decision-os/leagueHealthAlignment'
import { buildCommandCenterDailyBrief, type CommandCenterDailyBrief } from '../dailyBrief'

/** Severity projection of `RecommendedCommissionerAction.priority`. */
export type AttentionSeverity = 'critical' | 'medium'

export interface AttentionItem {
  id: string
  severity: AttentionSeverity
  message: string
}

export interface AttentionSectionData {
  brief: CommandCenterDailyBrief
  /** Commissioner attention items, urgent first. */
  items: AttentionItem[]
  managersAtRetentionRisk: ManagerAtRetentionRisk[]
  /**
   * The viewer's OWN outstanding manager actions. Additive, never a
   * replacement: a commissioner is still a manager, and this keeps their
   * personal queue one click away even on the ops surface. `null` when it
   * could not be resolved.
   */
  personalActionCount: number | null
  warnings: string[]
}

export async function loadAttentionSection(args: {
  leagueId: string
  userId: string
  /** Pre-resolved by the page — this loader issues no league-health resolve of its own. */
  snapshot: MissionControlSnapshot | null
  /** Whether the league is AllFantasy-native — gates the brief's health headline. */
  sourceIsNative: boolean
  /** Head commissioner's display name — greeting only. */
  commissionerName: string | null
  /** True only when the viewer is the head commissioner (role === 'commissioner'). */
  viewerIsHeadCommissioner: boolean
  entitledToIntelligence: boolean
  now?: Date
}): Promise<AttentionSectionData> {
  const now = args.now ?? new Date()
  const warnings: string[] = []

  const brief = buildCommandCenterDailyBrief({
    snapshot: args.snapshot,
    sourceIsNative: args.sourceIsNative,
    commissionerName: args.commissionerName,
    viewerIsHeadCommissioner: args.viewerIsHeadCommissioner,
    // Mission Control renders the live "Next Deadline" tile directly above this
    // section, so the brief does not re-resolve it (avoids a second waiver /
    // deadline query on the same page load).
    nextDeadline: null,
    now,
  })

  const items: AttentionItem[] = (args.snapshot?.recommendedActions ?? []).map((action, index) => ({
    id: `rec-${index}`,
    severity: action.priority === 'urgent' ? 'critical' : 'medium',
    message: action.message,
  }))

  /*
   * The viewer's own outstanding actions, resolved once and scoped to THIS
   * single league + user. This is deliberately not the multi-league,
   * every-manager fan-out that caused the production Postgres OOM — it is one
   * bounded call so the commissioner surface can still point the viewer at
   * their personal queue. Skipped entirely when the viewer is not entitled,
   * since the whole section then renders a locked gate.
   */
  let personalActionCount: number | null = null
  if (args.entitledToIntelligence) {
    try {
      const { resolveManagerCommandCenterSnapshot } = await import(
        '@/lib/decision-os/managerCommandCenter'
      )
      const managerSnapshot = await resolveManagerCommandCenterSnapshot(
        args.userId,
        [args.leagueId],
        now,
      )
      // The attention queue is already the superset: `resolveManagerCommandCenterSnapshot`
      // emits one signal per outstanding recommendation AND separately returns those
      // same recommendations, so `recommendations.length + attentionQueue.length` would
      // double-count. The queue length alone (recommendation signals + retention/
      // inactivity signals) is the honest total.
      personalActionCount = managerSnapshot.attentionQueue.length
    } catch (error) {
      console.error('[command-center/attention] manager snapshot failed', {
        leagueId: args.leagueId,
        error,
      })
      warnings.push('Your own outstanding actions could not be resolved right now.')
    }
  }

  return {
    brief,
    items,
    managersAtRetentionRisk: args.snapshot?.managersAtRetentionRisk ?? [],
    personalActionCount,
    warnings,
  }
}
