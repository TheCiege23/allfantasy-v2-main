/**
 * G15.4 — Internal Intelligence Query Service.
 *
 * Read-only backend access to the Intelligence read models. Sport/concept-agnostic.
 * Applies the feature-gate boundary (default: allow-all in G15.4 — no paid enforcement
 * yet). Commissioner Action Items are DERIVED at query time from the snapshots so they
 * are always fresh and need no separate projection.
 *
 * NOT for UI yet (no Commissioner Hub). NOT consumed by Chimmy/Story yet.
 */
import type { PrismaClient } from '@prisma/client'
import {
  defaultFeatureGate,
  INTELLIGENCE_FEATURES,
  type FeatureGatePrincipal,
  type IFeatureGate,
  type IntelligenceFeature,
} from './featureGate'

export class IntelligenceAccessError extends Error {
  constructor(public readonly feature: IntelligenceFeature, public readonly decision: string) {
    super(`intelligence feature "${feature}" not available (${decision})`)
    this.name = 'IntelligenceAccessError'
  }
}

export interface LeagueActivitySummary {
  leagueId: string
  sport: string | null
  leagueConcept: string | null
  totalEvents: number
  firstEventAt: string | null
  lastActivityAt: string | null
  openTradeProposals: number
  counts: { trade: number; waiver: number; lineup: number; draft: number; scoring: number; governance: number; lifecycle: number; other: number }
}

export type LeagueHealthStatus = 'healthy' | 'cooling' | 'stale' | 'unknown'
export interface LeagueHealthSnapshot {
  leagueId: string
  lastActivityAt: string | null
  daysSinceLastActivity: number | null
  totalManagers: number
  activeManagers: number
  openTradeProposals: number
  healthScore: number
  status: LeagueHealthStatus
}

export interface ManagerActivitySnapshot {
  leagueId: string
  managerKey: string
  lastActiveAt: string | null
  daysSinceLastActive: number | null
  totalActions: number
  actions: { trade: number; waiver: number; lineup: number; other: number }
}

export type ActionItemSeverity = 'info' | 'warning' | 'action'
export interface CommissionerActionItem {
  kind: string
  severity: ActionItemSeverity
  message: string
  meta?: Record<string, unknown>
}

/** Privacy-safe audit-feed item (no payload content, no PII). */
export interface AuditFeedItem {
  eventId: string
  type: string
  summary: string
  occurredAt: string
  actorType: string | null
  sport: string | null
  leagueConcept: string | null
}
export interface AuditFeedPage {
  items: AuditFeedItem[]
  nextCursor: string | null
}

export interface ActionItemThresholds {
  staleLeagueDays?: number
  inactiveManagerDays?: number
}

function daysSince(date: Date | null | undefined, now: Date): number | null {
  if (!date) return null
  return Math.floor((now.getTime() - new Date(date).getTime()) / 86_400_000)
}

// ── Pure derivations (exported for tests) ────────────────────────────────────

interface LeagueRow {
  leagueId: string
  lastActivityAt: Date | null
  totalEvents: number
  openTradeProposals: number
}
interface ManagerRow {
  managerKey: string
  lastActiveAt: Date | null
}

/** Pure: 0–100 league health from recency + active-manager ratio. */
export function computeHealth(
  league: LeagueRow,
  managers: ManagerRow[],
  now: Date,
  inactiveManagerDays = 14,
): { healthScore: number; status: LeagueHealthStatus; activeManagers: number } {
  if (league.totalEvents === 0 || !league.lastActivityAt) {
    return { healthScore: 0, status: 'unknown', activeManagers: 0 }
  }
  const dsa = daysSince(league.lastActivityAt, now) ?? 999
  const recencyScore = dsa <= 2 ? 60 : dsa <= 7 ? 40 : dsa <= 14 ? 20 : 0
  const activeManagers = managers.filter((m) => (daysSince(m.lastActiveAt, now) ?? 999) <= inactiveManagerDays).length
  const ratio = managers.length > 0 ? activeManagers / managers.length : 0
  const engagementScore = Math.round(ratio * 40)
  const healthScore = Math.max(0, Math.min(100, recencyScore + engagementScore))
  const status: LeagueHealthStatus = healthScore >= 70 ? 'healthy' : healthScore >= 35 ? 'cooling' : 'stale'
  return { healthScore, status, activeManagers }
}

/** Pure: derive commissioner action items from the snapshots + thresholds. */
export function deriveActionItems(
  league: LeagueRow | null,
  managers: ManagerRow[],
  now: Date,
  thresholds: ActionItemThresholds = {},
): CommissionerActionItem[] {
  const staleDays = thresholds.staleLeagueDays ?? 7
  const inactiveDays = thresholds.inactiveManagerDays ?? 14
  const items: CommissionerActionItem[] = []
  if (!league || league.totalEvents === 0) {
    items.push({ kind: 'no_activity', severity: 'info', message: 'No league activity recorded yet.' })
    return items
  }
  if (league.openTradeProposals > 0) {
    items.push({
      kind: 'pending_trades',
      severity: 'warning',
      message: `${league.openTradeProposals} trade proposal(s) awaiting resolution.`,
      meta: { openTradeProposals: league.openTradeProposals },
    })
  }
  const dsa = daysSince(league.lastActivityAt, now)
  if (dsa != null && dsa > staleDays) {
    items.push({ kind: 'stale_league', severity: 'warning', message: `No league activity for ${dsa} days.`, meta: { daysSinceLastActivity: dsa } })
  }
  const inactive = managers.filter((m) => (daysSince(m.lastActiveAt, now) ?? 999) > inactiveDays)
  if (inactive.length > 0) {
    items.push({
      kind: 'inactive_managers',
      severity: 'action',
      message: `${inactive.length} manager(s) inactive for over ${inactiveDays} days.`,
      meta: { managerKeys: inactive.map((m) => m.managerKey) },
    })
  }
  return items
}

// ── Service ──────────────────────────────────────────────────────────────────

export class IntelligenceQueryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly gate: IFeatureGate = defaultFeatureGate,
  ) {}

  private check(principal: FeatureGatePrincipal | null | undefined, feature: IntelligenceFeature): void {
    const decision = this.gate.decide(principal ?? null, feature)
    if (decision !== 'allow') throw new IntelligenceAccessError(feature, decision)
  }

  async getLeagueActivitySummary(leagueId: string, principal?: FeatureGatePrincipal): Promise<LeagueActivitySummary> {
    this.check(principal, INTELLIGENCE_FEATURES.ACTIVITY_SUMMARY)
    const s = await this.prisma.intelligenceLeagueSnapshot.findUnique({ where: { leagueId } })
    return {
      leagueId,
      sport: s?.sport ?? null,
      leagueConcept: s?.leagueConcept ?? null,
      totalEvents: s?.totalEvents ?? 0,
      firstEventAt: s?.firstEventAt?.toISOString() ?? null,
      lastActivityAt: s?.lastActivityAt?.toISOString() ?? null,
      openTradeProposals: Math.max(0, s?.openTradeProposals ?? 0),
      counts: {
        trade: s?.tradeCount ?? 0,
        waiver: s?.waiverCount ?? 0,
        lineup: s?.lineupCount ?? 0,
        draft: s?.draftCount ?? 0,
        scoring: s?.scoringCount ?? 0,
        governance: s?.governanceCount ?? 0,
        lifecycle: s?.lifecycleCount ?? 0,
        other: s?.otherCount ?? 0,
      },
    }
  }

  async getLeagueHealthSnapshot(leagueId: string, principal?: FeatureGatePrincipal, now: Date = new Date()): Promise<LeagueHealthSnapshot> {
    this.check(principal, INTELLIGENCE_FEATURES.HEALTH_SNAPSHOT)
    const s = await this.prisma.intelligenceLeagueSnapshot.findUnique({ where: { leagueId } })
    const managers = await this.prisma.intelligenceManagerSnapshot.findMany({ where: { leagueId }, select: { managerKey: true, lastActiveAt: true } })
    const leagueRow: LeagueRow = {
      leagueId,
      lastActivityAt: s?.lastActivityAt ?? null,
      totalEvents: s?.totalEvents ?? 0,
      openTradeProposals: Math.max(0, s?.openTradeProposals ?? 0),
    }
    const { healthScore, status, activeManagers } = computeHealth(leagueRow, managers, now)
    return {
      leagueId,
      lastActivityAt: s?.lastActivityAt?.toISOString() ?? null,
      daysSinceLastActivity: daysSince(s?.lastActivityAt ?? null, now),
      totalManagers: managers.length,
      activeManagers,
      openTradeProposals: leagueRow.openTradeProposals,
      healthScore,
      status,
    }
  }

  async getManagerActivitySnapshot(leagueId: string, userId: string, principal?: FeatureGatePrincipal, now: Date = new Date()): Promise<ManagerActivitySnapshot> {
    this.check(principal, INTELLIGENCE_FEATURES.MANAGER_ACTIVITY)
    const m = await this.prisma.intelligenceManagerSnapshot.findUnique({ where: { leagueId_managerKey: { leagueId, managerKey: userId } } })
    return {
      leagueId,
      managerKey: userId,
      lastActiveAt: m?.lastActiveAt?.toISOString() ?? null,
      daysSinceLastActive: daysSince(m?.lastActiveAt ?? null, now),
      totalActions: m?.totalActions ?? 0,
      actions: { trade: m?.tradeActions ?? 0, waiver: m?.waiverActions ?? 0, lineup: m?.lineupActions ?? 0, other: m?.otherActions ?? 0 },
    }
  }

  async getLeagueAuditFeed(
    leagueId: string,
    opts: { limit?: number; cursor?: string } = {},
    principal?: FeatureGatePrincipal,
  ): Promise<AuditFeedPage> {
    this.check(principal, INTELLIGENCE_FEATURES.AUDIT_FEED)
    const limit = Math.max(1, Math.min(opts.limit ?? 25, 100))
    const rows = await this.prisma.auditFeedEntry.findMany({
      where: { leagueId },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1, // fetch one extra to detect "more"
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    })
    const hasMore = rows.length > limit
    const page = rows.slice(0, limit)
    const items: AuditFeedItem[] = page.map((r) => ({
      eventId: r.eventId,
      type: r.type,
      summary: r.summary,
      occurredAt: r.occurredAt.toISOString(),
      actorType: r.actorType ?? null,
      sport: r.sport ?? null,
      leagueConcept: r.leagueConcept ?? null,
    }))
    const nextCursor = hasMore ? page[page.length - 1]!.id : null
    return { items, nextCursor }
  }

  async getCommissionerActionItems(leagueId: string, principal?: FeatureGatePrincipal, now: Date = new Date()): Promise<CommissionerActionItem[]> {
    this.check(principal, INTELLIGENCE_FEATURES.ACTION_ITEMS)
    const s = await this.prisma.intelligenceLeagueSnapshot.findUnique({ where: { leagueId } })
    const managers = await this.prisma.intelligenceManagerSnapshot.findMany({ where: { leagueId }, select: { managerKey: true, lastActiveAt: true } })
    const leagueRow: LeagueRow | null = s
      ? { leagueId, lastActivityAt: s.lastActivityAt, totalEvents: s.totalEvents, openTradeProposals: Math.max(0, s.openTradeProposals) }
      : null
    return deriveActionItems(leagueRow, managers, now)
  }
}
