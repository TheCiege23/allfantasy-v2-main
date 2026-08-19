/**
 * Decision OS — Phase 7.0 IPM Widget Contract Assemblers.
 *
 * Pure functions that assemble widget data bundles for different frontend surfaces.
 * No React, no CSS — layout-neutral data contracts only.
 */

import type {
  CompactWidget, SidebarWidget, FullDashboardWidget, PopupWidget,
  CommissionerWidget, ManagerWidget, MobileWidget, PartnerWidget,
  HealthCard, CommissionerCard, RetentionCard, LeagueArchetypeCard,
  DnaCard, ManagerCard, RecommendationPresentation, RecommendationPresentationSet,
  Badge, GraphModel, MetricPresentation, GaugeGraphModel, RadarGraphModel,
  TrendGraphModel, SeverityDefinition, ColorToken, WhiteLabelConfig,
} from './types'
import { PRESENTATION_VERSION, SEVERITY_DEFINITIONS, scoreToSeverity, scoreToColorToken } from './tokens'

// ── Compact widget ────────────────────────────────────────────────────────────

export function buildCompactWidget(
  entityId: string,
  entityType: CompactWidget['entityType'],
  primaryMetric: MetricPresentation,
  options?: {
    title?: string
    subtitle?: string
    badge?: Badge | null
    trend?: TrendGraphModel | null
    completeness?: number
    uncertainty?: string[]
    derivation?: string[]
  },
): CompactWidget {
  const opts = options ?? {}
  return {
    widgetId: `widget_${entityId}_compact`,
    widgetType: 'compact',
    entityId,
    entityType,
    title: opts.title ?? primaryMetric.label,
    subtitle: opts.subtitle ?? null,
    completeness: opts.completeness ?? primaryMetric.completeness,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`metric=${primaryMetric.metricId} → compact widget`],
    version: PRESENTATION_VERSION,
    primaryMetric,
    badge: opts.badge ?? null,
    trend: opts.trend ?? null,
  }
}

// ── Sidebar widget ────────────────────────────────────────────────────────────

export function buildSidebarWidget(
  entityId: string,
  entityType: SidebarWidget['entityType'],
  options?: {
    title?: string
    subtitle?: string
    healthCard?: HealthCard | null
    topMetrics?: MetricPresentation[]
    topRecommendation?: RecommendationPresentation | null
    badges?: Badge[]
    completeness?: number
    uncertainty?: string[]
    derivation?: string[]
  },
): SidebarWidget {
  const opts = options ?? {}
  const completeness = opts.completeness
    ?? opts.healthCard?.completeness
    ?? (opts.topMetrics?.[0]?.completeness ?? 0)
  return {
    widgetId: `widget_${entityId}_sidebar`,
    widgetType: 'sidebar',
    entityId,
    entityType,
    title: opts.title ?? 'Intelligence Summary',
    subtitle: opts.subtitle ?? null,
    completeness,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`entityId=${entityId} → sidebar widget`],
    version: PRESENTATION_VERSION,
    healthCard: opts.healthCard ?? null,
    topMetrics: (opts.topMetrics ?? []).slice(0, 3),
    topRecommendation: opts.topRecommendation ?? null,
    badges: opts.badges ?? [],
  }
}

// ── Full dashboard widget ─────────────────────────────────────────────────────

export function buildFullDashboardWidget(
  entityId: string,
  entityType: FullDashboardWidget['entityType'],
  options?: {
    title?: string
    subtitle?: string
    cards?: FullDashboardWidget['cards']
    graphs?: GraphModel[]
    recommendations?: RecommendationPresentationSet | null
    badges?: Badge[]
    metrics?: MetricPresentation[]
    completeness?: number
    uncertainty?: string[]
    derivation?: string[]
  },
): FullDashboardWidget {
  const opts = options ?? {}
  const completeness = opts.completeness ?? (opts.cards?.[0]?.completeness ?? 0)
  return {
    widgetId: `widget_${entityId}_full_dashboard`,
    widgetType: 'full_dashboard',
    entityId,
    entityType,
    title: opts.title ?? 'Full Intelligence Dashboard',
    subtitle: opts.subtitle ?? null,
    completeness,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`entityId=${entityId} cards=${opts.cards?.length ?? 0} → full_dashboard`],
    version: PRESENTATION_VERSION,
    cards: opts.cards ?? [],
    graphs: opts.graphs ?? [],
    recommendations: opts.recommendations ?? null,
    badges: opts.badges ?? [],
    metrics: opts.metrics ?? [],
  }
}

// ── Popup widget ──────────────────────────────────────────────────────────────

export function buildPopupWidget(
  entityId: string,
  entityType: PopupWidget['entityType'],
  healthScore: number,
  options?: {
    title?: string
    subtitle?: string
    topRecommendations?: RecommendationPresentation[]
    primaryBadge?: Badge | null
    completeness?: number
    uncertainty?: string[]
    derivation?: string[]
  },
): PopupWidget {
  const opts = options ?? {}
  const severity: SeverityDefinition = SEVERITY_DEFINITIONS[scoreToSeverity(healthScore)]
  const healthColorToken: ColorToken = scoreToColorToken(healthScore)
  return {
    widgetId: `widget_${entityId}_popup`,
    widgetType: 'popup',
    entityId,
    entityType,
    title: opts.title ?? 'League Intelligence',
    subtitle: opts.subtitle ?? null,
    completeness: opts.completeness ?? 100,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`healthScore=${healthScore} → popup widget`],
    version: PRESENTATION_VERSION,
    healthScore,
    healthColorToken,
    healthSeverity: severity,
    topRecommendations: (opts.topRecommendations ?? []).slice(0, 3),
    primaryBadge: opts.primaryBadge ?? null,
  }
}

// ── Commissioner widget ───────────────────────────────────────────────────────

export function buildCommissionerWidget(
  leagueId: string,
  options?: {
    title?: string
    subtitle?: string
    workloadCard?: CommissionerCard | null
    retentionCard?: RetentionCard | null
    archetypeCard?: LeagueArchetypeCard | null
    recommendations?: RecommendationPresentation[]
    atRiskMetrics?: MetricPresentation[]
    healthGraph?: GaugeGraphModel | null
    completeness?: number
    uncertainty?: string[]
    derivation?: string[]
  },
): CommissionerWidget {
  const opts = options ?? {}
  const completeness = opts.completeness
    ?? opts.workloadCard?.completeness
    ?? opts.retentionCard?.completeness
    ?? 0
  return {
    widgetId: `widget_${leagueId}_commissioner`,
    widgetType: 'commissioner',
    entityId: leagueId,
    entityType: 'league',
    title: opts.title ?? 'Commissioner Intelligence',
    subtitle: opts.subtitle ?? null,
    completeness,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`leagueId=${leagueId} → commissioner widget`],
    version: PRESENTATION_VERSION,
    workloadCard: opts.workloadCard ?? null,
    retentionCard: opts.retentionCard ?? null,
    archetypeCard: opts.archetypeCard ?? null,
    recommendations: (opts.recommendations ?? []).filter((r) => r.tier === 'commissioner'),
    atRiskMetrics: opts.atRiskMetrics ?? [],
    healthGraph: opts.healthGraph ?? null,
  }
}

// ── Manager widget ────────────────────────────────────────────────────────────

export function buildManagerWidget(
  managerId: string,
  leagueId: string,
  options?: {
    title?: string
    subtitle?: string
    dnaCard?: DnaCard | null
    managerCard?: ManagerCard | null
    recommendations?: RecommendationPresentation[]
    radarGraph?: RadarGraphModel | null
    badges?: Badge[]
    completeness?: number
    uncertainty?: string[]
    derivation?: string[]
  },
): ManagerWidget {
  const opts = options ?? {}
  const completeness = opts.completeness
    ?? opts.dnaCard?.completeness
    ?? opts.managerCard?.completeness
    ?? 0
  return {
    widgetId: `widget_${managerId}_manager`,
    widgetType: 'manager',
    entityId: managerId,
    entityType: 'manager',
    title: opts.title ?? 'Manager Intelligence',
    subtitle: opts.subtitle ?? null,
    completeness,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`managerId=${managerId} leagueId=${leagueId} → manager widget`],
    version: PRESENTATION_VERSION,
    managerId,
    leagueId,
    dnaCard: opts.dnaCard ?? null,
    managerCard: opts.managerCard ?? null,
    recommendations: (opts.recommendations ?? []).filter((r) => r.tier === 'manager'),
    radarGraph: opts.radarGraph ?? null,
    badges: opts.badges ?? [],
  }
}

// ── Mobile widget ─────────────────────────────────────────────────────────────

export function buildMobileWidget(
  entityId: string,
  entityType: MobileWidget['entityType'],
  primaryMetric: MetricPresentation,
  options?: {
    title?: string
    subtitle?: string
    healthScore?: number | null
    topRecommendation?: RecommendationPresentation | null
    badges?: Badge[]
    completeness?: number
    uncertainty?: string[]
    derivation?: string[]
  },
): MobileWidget {
  const opts = options ?? {}
  return {
    widgetId: `widget_${entityId}_mobile`,
    widgetType: 'mobile',
    entityId,
    entityType,
    title: opts.title ?? primaryMetric.label,
    subtitle: opts.subtitle ?? null,
    completeness: opts.completeness ?? primaryMetric.completeness,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`entityId=${entityId} → mobile widget`],
    version: PRESENTATION_VERSION,
    primaryMetric,
    healthScore: opts.healthScore ?? null,
    topRecommendation: opts.topRecommendation ?? null,
    badges: opts.badges ?? [],
  }
}

// ── Partner widget ────────────────────────────────────────────────────────────

export function buildPartnerWidget(
  entityId: string,
  whiteLabelConfig: WhiteLabelConfig,
  content: CompactWidget | SidebarWidget | PopupWidget,
  options?: {
    title?: string
    subtitle?: string
    completeness?: number
    uncertainty?: string[]
    derivation?: string[]
  },
): PartnerWidget {
  const opts = options ?? {}
  return {
    widgetId: `widget_${entityId}_partner`,
    widgetType: 'partner',
    entityId,
    entityType: content.entityType,
    title: opts.title ?? content.title,
    subtitle: opts.subtitle ?? content.subtitle,
    completeness: opts.completeness ?? content.completeness,
    uncertainty: opts.uncertainty ?? content.uncertainty,
    derivation: opts.derivation ?? [`platform=${whiteLabelConfig.platform} entityId=${entityId} → partner widget`],
    version: PRESENTATION_VERSION,
    whiteLabelConfig,
    content,
  }
}
