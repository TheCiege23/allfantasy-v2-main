/**
 * Calculate the total badge count for Draft Helper floating bubble.
 * Counts active recommendations, insights, and alerts across all sections.
 */

interface DraftHelperBadgeCountInput {
  recommendation: { player?: { name?: string } } | null | undefined
  warRoom: { snapshot?: unknown } | null | undefined
  aiFeatureStatus?: {
    chimmyReady?: boolean
    liveBrainReady?: boolean
    aiAdpEnabled?: boolean
    queueReorderEnabled?: boolean
    draftExplanationEnabled?: boolean
    orphanAiEnabled?: boolean
    commissionerAiManagersCount?: number
  } | null
  sportsFeed?: {
    available?: boolean
    headlines?: Array<{ id?: string }>
    injuries?: Array<{ playerName?: string }>
  } | null
  insights?: {
    reachWarning?: string | null
    valueWarning?: string | null
    scarcityInsight?: string | null
    stackInsight?: string | null
    correlationInsight?: string | null
    formatInsight?: string | null
  } | null
}

/** War Room payload may be `{ bestPick: { name } }` (DraftWarRoomSnapshot) or nested `bestPick.player`. */
function warRoomPickName(warRoom: DraftHelperBadgeCountInput['warRoom']): string | undefined {
  const snap = warRoom?.snapshot as
    | {
        bestPick?:
          | { player?: { name?: string }; name?: string }
          | null
      }
    | null
    | undefined
  const bp = snap?.bestPick
  if (!bp || typeof bp !== 'object') return undefined
  if ('player' in bp && bp.player && typeof bp.player === 'object') {
    const n = (bp.player as { name?: string }).name
    if (typeof n === 'string' && n.trim()) return n
  }
  const direct = (bp as { name?: string }).name
  return typeof direct === 'string' && direct.trim() ? direct : undefined
}

export function calculateDraftHelperBadgeCount(input: DraftHelperBadgeCountInput): number {
  let count = 0

  // Copilot: +1 if recommendation available with player
  if (input.recommendation?.player?.name) {
    count++
  }

  // War Room: +1 if has active snapshot with best pick (flat or nested player)
  if (warRoomPickName(input.warRoom)) {
    count++
  }

  // Intelligence: +1 per active AI feature
  if (input.aiFeatureStatus) {
    if (input.aiFeatureStatus.chimmyReady) count++
    if (input.aiFeatureStatus.liveBrainReady) count++
    if (input.aiFeatureStatus.aiAdpEnabled) count++
    if (input.aiFeatureStatus.queueReorderEnabled) count++
    if (input.aiFeatureStatus.draftExplanationEnabled) count++
    if (input.aiFeatureStatus.orphanAiEnabled) count++
  }

  // Sports Feed: +1 if has headlines, +1 if has injuries (max +2)
  if (input.sportsFeed?.available) {
    if (input.sportsFeed.headlines && input.sportsFeed.headlines.length > 0) {
      count++
    }
    if (input.sportsFeed.injuries && input.sportsFeed.injuries.length > 0) {
      count++
    }
  }

  // Insights: +1 per active insight (these appear in Copilot, so don't duplicate)
  // Already counted in copilot +1

  // Cap at 9 to fit nicely in badge UI
  return Math.min(count, 9)
}

/**
 * Determine if Draft Helper has any content to show
 */
export function hasDraftHelperContent(input: DraftHelperBadgeCountInput): boolean {
  return calculateDraftHelperBadgeCount(input) > 0
}
