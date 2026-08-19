/**
 * Decision OS — Phase 7.0 IPM Badge System.
 *
 * Deterministic badge assignment from identity/archetype/benchmark signals.
 * Every badge is stable-sorted by id for deterministic ordering.
 */

import type { Badge, ColorToken, IconToken } from './types'
import { PRESENTATION_VERSION } from './tokens'

// ── Badge catalog ─────────────────────────────────────────────────────────────

interface CatalogEntry {
  catalogId: string
  label: string
  description: string
  colorToken: ColorToken
  iconToken: IconToken
  tier: Badge['tier']
}

const BADGE_CATALOG: Record<string, CatalogEntry> = {
  top_10_pct: {
    catalogId: 'top_10_pct',
    label: 'Top 10%',
    description: 'League engagement is in the top 10% of the platform.',
    colorToken: 'success',
    iconToken: 'trophy',
    tier: 'league',
  },
  top_25_pct: {
    catalogId: 'top_25_pct',
    label: 'Top 25%',
    description: 'League engagement is in the top 25% of the platform.',
    colorToken: 'positive',
    iconToken: 'star',
    tier: 'league',
  },
  benchmark_leader: {
    catalogId: 'benchmark_leader',
    label: 'Benchmark Leader',
    description: 'Above platform median in all five benchmark dimensions.',
    colorToken: 'success',
    iconToken: 'trophy',
    tier: 'league',
  },
  elite_commissioner: {
    catalogId: 'elite_commissioner',
    label: 'Elite Commissioner',
    description: 'Commissioner efficiency is in the top 10% of the platform.',
    colorToken: 'success',
    iconToken: 'shield',
    tier: 'league',
  },
  trade_heavy: {
    catalogId: 'trade_heavy',
    label: 'Trade Heavy',
    description: 'Trade activity is above the platform 75th percentile.',
    colorToken: 'accent',
    iconToken: 'activity',
    tier: 'league',
  },
  waiver_dominant: {
    catalogId: 'waiver_dominant',
    label: 'Waiver Dominant',
    description: 'Waiver activity is above the platform 75th percentile.',
    colorToken: 'accent',
    iconToken: 'zap',
    tier: 'league',
  },
  highly_engaged: {
    catalogId: 'highly_engaged',
    label: 'Highly Engaged',
    description: 'League is in the elite or active engagement tier.',
    colorToken: 'success',
    iconToken: 'flame',
    tier: 'league',
  },
  retention_risk: {
    catalogId: 'retention_risk',
    label: 'Retention Risk',
    description: 'League has high or critical retention risk.',
    colorToken: 'danger',
    iconToken: 'alert_triangle',
    tier: 'league',
  },
  needs_attention: {
    catalogId: 'needs_attention',
    label: 'Needs Attention',
    description: 'Engagement is in the bottom 25% of the platform.',
    colorToken: 'warning',
    iconToken: 'alert_triangle',
    tier: 'league',
  },
  inactive_or_stale: {
    catalogId: 'inactive_or_stale',
    label: 'Stale League',
    description: 'League shows significant signs of inactivity.',
    colorToken: 'critical',
    iconToken: 'clock',
    tier: 'league',
  },
  high_churn_risk: {
    catalogId: 'high_churn_risk',
    label: 'High Churn Risk',
    description: 'League has elevated manager retention risk.',
    colorToken: 'danger',
    iconToken: 'alert_circle',
    tier: 'league',
  },
  competitive_balanced: {
    catalogId: 'competitive_balanced',
    label: 'Competitive',
    description: 'League has balanced competitive activity with active trading and waivers.',
    colorToken: 'positive',
    iconToken: 'target',
    tier: 'league',
  },
  casual_social: {
    catalogId: 'casual_social',
    label: 'Casual Social',
    description: 'League has a casual, social play style.',
    colorToken: 'neutral',
    iconToken: 'users',
    tier: 'league',
  },
  commissioner_driven: {
    catalogId: 'commissioner_driven',
    label: 'Commissioner Driven',
    description: 'League relies heavily on commissioner oversight.',
    colorToken: 'warning',
    iconToken: 'shield',
    tier: 'league',
  },
  ghost_manager: {
    catalogId: 'ghost_manager',
    label: 'Ghost Manager',
    description: 'Manager has been inactive for an extended period.',
    colorToken: 'critical',
    iconToken: 'ghost',
    tier: 'manager',
  },
  serial_trader: {
    catalogId: 'serial_trader',
    label: 'Serial Trader',
    description: 'Manager is extremely active in the trade market.',
    colorToken: 'accent',
    iconToken: 'activity',
    tier: 'manager',
  },
  waiver_hawk: {
    catalogId: 'waiver_hawk',
    label: 'Waiver Hawk',
    description: 'Manager is highly active on the waiver wire.',
    colorToken: 'accent',
    iconToken: 'zap',
    tier: 'manager',
  },
  committed_grinder: {
    catalogId: 'committed_grinder',
    label: 'Committed Grinder',
    description: 'Manager is consistently active with no negative behavioral patterns.',
    colorToken: 'success',
    iconToken: 'trophy',
    tier: 'manager',
  },
  trade_seeker: {
    catalogId: 'trade_seeker',
    label: 'Trade Seeker',
    description: 'Manager regularly explores the trade market.',
    colorToken: 'positive',
    iconToken: 'target',
    tier: 'manager',
  },
  platform_growing: {
    catalogId: 'platform_growing',
    label: 'Growing',
    description: 'Platform engagement is trending upward.',
    colorToken: 'positive',
    iconToken: 'trending_up',
    tier: 'platform',
  },
  platform_healthy: {
    catalogId: 'platform_healthy',
    label: 'Platform Healthy',
    description: 'Platform engagement health is in good standing.',
    colorToken: 'success',
    iconToken: 'check_circle',
    tier: 'platform',
  },
  platform_at_risk: {
    catalogId: 'platform_at_risk',
    label: 'Platform At Risk',
    description: 'Platform has elevated retention risk across multiple leagues.',
    colorToken: 'danger',
    iconToken: 'alert_triangle',
    tier: 'platform',
  },
}

function makeBadge(entityId: string, catalogId: string, derivation: string[]): Badge {
  const entry = BADGE_CATALOG[catalogId]
  if (!entry) throw new Error(`IPM badge catalog missing: ${catalogId}`)
  return {
    id: `badge_${entityId}_${catalogId}`,
    catalogId: entry.catalogId,
    label: entry.label,
    description: entry.description,
    colorToken: entry.colorToken,
    iconToken: entry.iconToken,
    tier: entry.tier,
    derivation,
  }
}

function stableSort(badges: Badge[]): Badge[] {
  return [...badges].sort((a, b) => a.id.localeCompare(b.id))
}

// ── Manager badge builder ─────────────────────────────────────────────────────

export function buildManagerBadges(
  managerId: string,
  input: {
    primaryIdentity: string
    engagementScore?: number
    completeness: number
  },
): Badge[] {
  if (input.completeness < 20) return []
  const badges: Badge[] = []
  const id = managerId

  if (input.primaryIdentity === 'ghost_manager') {
    badges.push(makeBadge(id, 'ghost_manager', ['primaryIdentity=ghost_manager → ghost_manager badge']))
  }
  if (input.primaryIdentity === 'serial_trader') {
    badges.push(makeBadge(id, 'serial_trader', ['primaryIdentity=serial_trader → serial_trader badge']))
  }
  if (input.primaryIdentity === 'waiver_hawk') {
    badges.push(makeBadge(id, 'waiver_hawk', ['primaryIdentity=waiver_hawk → waiver_hawk badge']))
  }
  if (input.primaryIdentity === 'committed_grinder') {
    badges.push(makeBadge(id, 'committed_grinder', ['primaryIdentity=committed_grinder → committed_grinder badge']))
  }
  if (input.primaryIdentity === 'trade_seeker') {
    badges.push(makeBadge(id, 'trade_seeker', ['primaryIdentity=trade_seeker → trade_seeker badge']))
  }
  return stableSort(badges)
}

// ── League badge builder ──────────────────────────────────────────────────────

export function buildLeagueBadges(
  leagueId: string,
  input: {
    archetype?: string
    archetypeConfidence?: number
    retentionRisk?: string
    engagementTier?: string
    benchmark?: {
      engagement: { percentile: number }
      retentionSafety: { percentile: number }
      tradeActivity: { percentile: number }
      waiverActivity: { percentile: number }
      commissionerEfficiency: { percentile: number }
    }
    completeness: number
  },
): Badge[] {
  if (input.completeness < 20) return []
  const badges: Badge[] = []
  const id = leagueId
  const bm = input.benchmark
  const archetype = input.archetype ?? 'unknown'
  const archetypeConf = input.archetypeConfidence ?? 0
  const threshold = 0.50

  // Engagement tier badges
  if (input.engagementTier === 'elite' || input.engagementTier === 'active') {
    badges.push(makeBadge(id, 'highly_engaged', [`engagementTier=${input.engagementTier} → highly_engaged`]))
  }

  // Archetype badges (require confidence ≥ threshold)
  if (archetypeConf >= threshold) {
    if (archetype === 'inactive_or_stale') {
      badges.push(makeBadge(id, 'inactive_or_stale', [`archetype=inactive_or_stale conf=${archetypeConf.toFixed(2)}`]))
    } else if (archetype === 'high_churn_risk') {
      badges.push(makeBadge(id, 'high_churn_risk', [`archetype=high_churn_risk conf=${archetypeConf.toFixed(2)}`]))
    } else if (archetype === 'competitive_balanced') {
      badges.push(makeBadge(id, 'competitive_balanced', [`archetype=competitive_balanced conf=${archetypeConf.toFixed(2)}`]))
    } else if (archetype === 'casual_social') {
      badges.push(makeBadge(id, 'casual_social', [`archetype=casual_social conf=${archetypeConf.toFixed(2)}`]))
    } else if (archetype === 'commissioner_driven') {
      badges.push(makeBadge(id, 'commissioner_driven', [`archetype=commissioner_driven conf=${archetypeConf.toFixed(2)}`]))
    } else if (archetype === 'trade_heavy') {
      badges.push(makeBadge(id, 'trade_heavy', [`archetype=trade_heavy conf=${archetypeConf.toFixed(2)}`]))
    } else if (archetype === 'waiver_active') {
      badges.push(makeBadge(id, 'waiver_dominant', [`archetype=waiver_active conf=${archetypeConf.toFixed(2)}`]))
    }
  }

  // Retention risk
  if (input.retentionRisk === 'high' || input.retentionRisk === 'critical') {
    badges.push(makeBadge(id, 'retention_risk', [`retentionRisk=${input.retentionRisk} → retention_risk badge`]))
  }

  // Benchmark-based badges
  if (bm) {
    if (bm.engagement.percentile >= 90) {
      badges.push(makeBadge(id, 'top_10_pct', [`engagement.percentile=${bm.engagement.percentile} ≥ 90 → top_10_pct`]))
    } else if (bm.engagement.percentile >= 75) {
      badges.push(makeBadge(id, 'top_25_pct', [`engagement.percentile=${bm.engagement.percentile} ≥ 75 → top_25_pct`]))
    } else if (bm.engagement.percentile < 25) {
      badges.push(makeBadge(id, 'needs_attention', [`engagement.percentile=${bm.engagement.percentile} < 25 → needs_attention`]))
    }

    const allAboveMedian =
      bm.engagement.percentile >= 50 &&
      bm.retentionSafety.percentile >= 50 &&
      bm.tradeActivity.percentile >= 50 &&
      bm.waiverActivity.percentile >= 50 &&
      bm.commissionerEfficiency.percentile >= 50
    if (allAboveMedian) {
      badges.push(makeBadge(id, 'benchmark_leader', [
        `all 5 dimensions ≥ p50: engagement=${bm.engagement.percentile} retentionSafety=${bm.retentionSafety.percentile} → benchmark_leader`,
      ]))
    }

    if (bm.commissionerEfficiency.percentile >= 90) {
      badges.push(makeBadge(id, 'elite_commissioner', [`commissionerEfficiency.percentile=${bm.commissionerEfficiency.percentile} ≥ 90 → elite_commissioner`]))
    }

    if (bm.tradeActivity.percentile >= 75) {
      badges.push(makeBadge(id, 'trade_heavy', [`tradeActivity.percentile=${bm.tradeActivity.percentile} ≥ 75 → trade_heavy`]))
    }
    if (bm.waiverActivity.percentile >= 75) {
      badges.push(makeBadge(id, 'waiver_dominant', [`waiverActivity.percentile=${bm.waiverActivity.percentile} ≥ 75 → waiver_dominant`]))
    }
  }

  // Deduplicate by catalogId (keep first)
  const seen = new Set<string>()
  const deduped = badges.filter((b) => {
    if (seen.has(b.catalogId)) return false
    seen.add(b.catalogId)
    return true
  })

  return stableSort(deduped)
}

// ── Commissioner badge builder ────────────────────────────────────────────────

export function buildCommissionerBadges(
  leagueId: string,
  input: {
    workloadLevel: string
    efficiencyPercentile?: number
    completeness: number
  },
): Badge[] {
  if (input.completeness < 20) return []
  const badges: Badge[] = []

  if (input.efficiencyPercentile !== undefined && input.efficiencyPercentile >= 90) {
    badges.push(makeBadge(leagueId, 'elite_commissioner', [
      `commissionerEfficiency.percentile=${input.efficiencyPercentile} ≥ 90 → elite_commissioner`,
    ]))
  }

  return stableSort(badges)
}

// ── Platform badge builder ────────────────────────────────────────────────────

export function buildPlatformBadges(
  platformId: string,
  input: {
    momentumSignal: string
    platformHealthScore: number
    atRiskLeaguePercent: number
    completeness: number
  },
): Badge[] {
  if (input.completeness < 20) return []
  const badges: Badge[] = []

  if (input.momentumSignal === 'accelerating') {
    badges.push(makeBadge(platformId, 'platform_growing', [`momentumSignal=accelerating → platform_growing`]))
  }

  if (input.platformHealthScore >= 70 && input.atRiskLeaguePercent < 0.25) {
    badges.push(makeBadge(platformId, 'platform_healthy', [
      `healthScore=${input.platformHealthScore} ≥ 70 and atRiskPercent=${input.atRiskLeaguePercent} < 0.25 → platform_healthy`,
    ]))
  } else if (input.atRiskLeaguePercent > 0.40) {
    badges.push(makeBadge(platformId, 'platform_at_risk', [
      `atRiskLeaguePercent=${input.atRiskLeaguePercent} > 0.40 → platform_at_risk`,
    ]))
  }

  return stableSort(badges)
}
