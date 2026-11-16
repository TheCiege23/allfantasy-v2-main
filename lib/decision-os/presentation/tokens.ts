/**
 * Decision OS — Phase 7.0 IPM Token System.
 *
 * Pure deterministic mapping functions: scores/tiers/risks → severity/color/icon tokens.
 * No UI imports, no side effects.
 */

import type { ColorToken, IconToken, SeverityToken, SeverityDefinition } from './types'

export const PRESENTATION_VERSION = '7.0.0' as const

// ── Severity definitions ──────────────────────────────────────────────────────

export const SEVERITY_DEFINITIONS: Record<SeverityToken, SeverityDefinition> = {
  critical: {
    token: 'critical',
    priority: 1,
    displayColorToken: 'critical',
    iconToken: 'alert_circle',
    animationToken: 'pulse',
  },
  elevated: {
    token: 'elevated',
    priority: 2,
    displayColorToken: 'danger',
    iconToken: 'alert_triangle',
    animationToken: 'none',
  },
  standard: {
    token: 'standard',
    priority: 3,
    displayColorToken: 'warning',
    iconToken: 'alert_triangle',
    animationToken: 'none',
  },
  advisory: {
    token: 'advisory',
    priority: 4,
    displayColorToken: 'neutral',
    iconToken: 'eye',
    animationToken: 'none',
  },
  positive: {
    token: 'positive',
    priority: 5,
    displayColorToken: 'success',
    iconToken: 'check_circle',
    animationToken: 'none',
  },
}

export function severityDefinition(token: SeverityToken): SeverityDefinition {
  return SEVERITY_DEFINITIONS[token]
}

// ── Score → severity ──────────────────────────────────────────────────────────

/** Maps a 0–100 score to a severity token. Higher = better. */
export function scoreToSeverity(score: number): SeverityToken {
  if (score < 30) return 'critical'
  if (score < 50) return 'elevated'
  if (score < 70) return 'standard'
  if (score < 85) return 'advisory'
  return 'positive'
}

/** Maps a percentile (0–100, higher = better) to a severity token. */
export function percentileToSeverity(percentile: number): SeverityToken {
  if (percentile < 20) return 'critical'
  if (percentile < 40) return 'elevated'
  if (percentile < 60) return 'standard'
  if (percentile < 80) return 'advisory'
  return 'positive'
}

// ── Tier → severity ───────────────────────────────────────────────────────────

export function engagementTierToSeverity(tier: string): SeverityToken {
  switch (tier) {
    case 'elite':
    case 'thriving':
      return 'positive'
    case 'active':
    case 'healthy':
      return 'advisory'
    case 'moderate':
      return 'standard'
    case 'passive':
    case 'struggling':
      return 'elevated'
    case 'dormant':
    case 'inactive':
      return 'critical'
    default:
      return 'advisory'
  }
}

export function retentionRiskToSeverity(risk: string): SeverityToken {
  switch (risk) {
    case 'low':  return 'positive'
    case 'medium': return 'standard'
    case 'high': return 'elevated'
    case 'critical': return 'critical'
    default: return 'advisory'
  }
}

export function workloadToSeverity(workload: string): SeverityToken {
  switch (workload) {
    case 'light':    return 'positive'
    case 'moderate': return 'advisory'
    case 'heavy':    return 'standard'
    case 'critical': return 'critical'
    default: return 'advisory'
  }
}

export function recommendationPriorityToSeverity(priority: string): SeverityToken {
  switch (priority) {
    case 'critical': return 'critical'
    case 'high':     return 'elevated'
    case 'medium':   return 'standard'
    case 'low':      return 'advisory'
    default: return 'advisory'
  }
}

export function archetypeToSeverity(archetype: string): SeverityToken {
  switch (archetype) {
    case 'highly_engaged':
    case 'competitive_balanced':
      return 'positive'
    case 'trade_heavy':
    case 'waiver_active':
    case 'casual_social':
      return 'advisory'
    case 'commissioner_driven':
    case 'low_engagement':
      return 'standard'
    case 'high_churn_risk':
      return 'elevated'
    case 'inactive_or_stale':
      return 'critical'
    default:
      return 'advisory'
  }
}

export function healthTierToSeverity(tier: string): SeverityToken {
  switch (tier) {
    case 'excellent': return 'positive'
    case 'good':      return 'advisory'
    case 'moderate':  return 'standard'
    case 'poor':      return 'elevated'
    case 'critical':  return 'critical'
    // Legacy tiers from CommissionerIntelligencePreview
    case 'strong': return 'positive'
    case 'fair':   return 'standard'
    default: return 'advisory'
  }
}

// ── Score / tier → color token ────────────────────────────────────────────────

export function percentileToColorToken(percentile: number): ColorToken {
  if (percentile >= 75) return 'benchmark_above'
  if (percentile >= 40) return 'benchmark_equal'
  return 'benchmark_below'
}

export function archetypeToColorToken(archetype: string): ColorToken {
  switch (archetype) {
    case 'highly_engaged':       return 'success'
    case 'competitive_balanced': return 'positive'
    case 'trade_heavy':          return 'accent'
    case 'waiver_active':        return 'accent'
    case 'casual_social':        return 'neutral'
    case 'commissioner_driven':  return 'warning'
    case 'low_engagement':       return 'warning'
    case 'high_churn_risk':      return 'danger'
    case 'inactive_or_stale':    return 'critical'
    default:                     return 'neutral'
  }
}

export function identityToColorToken(identity: string): ColorToken {
  switch (identity) {
    case 'committed_grinder': return 'success'
    case 'trade_seeker':      return 'positive'
    case 'serial_trader':     return 'accent'
    case 'waiver_hawk':       return 'accent'
    case 'set_and_forget':    return 'neutral'
    case 'indecisive_tinkerer': return 'warning'
    case 'reactive_manager':  return 'warning'
    case 'ghost_manager':     return 'critical'
    default:                  return 'neutral'
  }
}

export function retentionRiskToColorToken(risk: string): ColorToken {
  switch (risk) {
    case 'low':      return 'success'
    case 'medium':   return 'warning'
    case 'high':     return 'danger'
    case 'critical': return 'critical'
    default:         return 'neutral'
  }
}

export function scoreToColorToken(score: number): ColorToken {
  if (score >= 80) return 'success'
  if (score >= 65) return 'healthy'
  if (score >= 50) return 'warning'
  if (score >= 35) return 'danger'
  return 'critical'
}

// ── Identity / archetype → icon token ────────────────────────────────────────

export function identityToIconToken(identity: string): IconToken {
  switch (identity) {
    case 'ghost_manager':       return 'ghost'
    case 'committed_grinder':   return 'trophy'
    case 'serial_trader':       return 'activity'
    case 'waiver_hawk':         return 'zap'
    case 'trade_seeker':        return 'target'
    case 'indecisive_tinkerer': return 'alert_triangle'
    case 'reactive_manager':    return 'trending_up'
    case 'set_and_forget':      return 'clock'
    default:                    return 'none'
  }
}

export function archetypeToIconToken(archetype: string): IconToken {
  switch (archetype) {
    case 'highly_engaged':       return 'flame'
    case 'competitive_balanced': return 'target'
    case 'trade_heavy':          return 'activity'
    case 'waiver_active':        return 'zap'
    case 'casual_social':        return 'users'
    case 'commissioner_driven':  return 'shield'
    case 'low_engagement':       return 'trending_down'
    case 'high_churn_risk':      return 'alert_triangle'
    case 'inactive_or_stale':    return 'clock'
    default:                     return 'none'
  }
}

// ── Category display labels ───────────────────────────────────────────────────

export const IDENTITY_DISPLAY_LABELS: Record<string, string> = {
  ghost_manager:        'Ghost Manager',
  set_and_forget:       'Set & Forget',
  reactive_manager:     'Reactive Manager',
  indecisive_tinkerer:  'Indecisive Tinkerer',
  serial_trader:        'Serial Trader',
  waiver_hawk:          'Waiver Hawk',
  trade_seeker:         'Trade Seeker',
  committed_grinder:    'Committed Grinder',
  unknown:              'Unclassified',
}

export const IDENTITY_DESCRIPTIONS: Record<string, string> = {
  ghost_manager:        'Extended inactivity — missing from league decisions.',
  set_and_forget:       'Sets lineup once and rarely revisits roster decisions.',
  reactive_manager:     'Makes frequent changes in response to recent results.',
  indecisive_tinkerer:  'Repeated lineup saves and bench flip-flopping.',
  serial_trader:        'Highly active in the trade market.',
  waiver_hawk:          'Aggressively monitors and claims on the waiver wire.',
  trade_seeker:         'Regularly explores trades without aggressive volume.',
  committed_grinder:    'Consistently engaged with no negative behavioral patterns.',
  unknown:              'Insufficient data to classify.',
}

export const ARCHETYPE_DISPLAY_LABELS: Record<string, string> = {
  highly_engaged:       'Highly Engaged',
  competitive_balanced: 'Competitive & Balanced',
  trade_heavy:          'Trade Heavy',
  waiver_active:        'Waiver Active',
  casual_social:        'Casual Social',
  commissioner_driven:  'Commissioner Driven',
  low_engagement:       'Low Engagement',
  high_churn_risk:      'High Churn Risk',
  inactive_or_stale:    'Inactive or Stale',
  unknown:              'Unclassified',
}

export const ARCHETYPE_DESCRIPTIONS: Record<string, string> = {
  highly_engaged:       'Strong activity across all dimensions with low retention risk.',
  competitive_balanced: 'Active trade and waiver markets with balanced engagement.',
  trade_heavy:          'Trade activity dominates league transactions.',
  waiver_active:        'Waiver wire is the primary roster management tool.',
  casual_social:        'Moderate engagement with low transaction volume.',
  commissioner_driven:  'League health relies heavily on commissioner oversight.',
  low_engagement:       'Below-average participation across most dimensions.',
  high_churn_risk:      'Elevated manager retention risk — action recommended.',
  inactive_or_stale:    'League shows significant signs of inactivity.',
  unknown:              'Insufficient data to classify this league.',
}
