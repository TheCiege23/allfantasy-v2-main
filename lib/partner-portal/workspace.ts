/**
 * The signed-in partner portal's read path (docs/os/OS_BACKBONE_PRINCIPLES.md §4, 2026-11-17).
 *
 * The same order as app/api/commissioner-os/sync-health/route.ts, which is the reference:
 *   session → which workspace? (asked of the database, never of the caller) → authorize → withTenant.
 *
 * Owner's decisions 2026-11-17:
 *   - The first workspaces are created by an owner-run script (scripts/provision-partner-workspace.ts).
 *   - A partner's leagues are LINKED, not moved: they stay AllFantasy leagues for their players, and the
 *     partner sees them through `LeagueBinding` rows in its own workspace.
 *
 * 🛑 THE ONE CROSSING, AND WHY IT IS SAFE. The bindings are read INSIDE the partner's tenant scope, so row-level
 * security decides which leagues the partner may see. The leagues themselves still belong to the AllFantasy
 * tenant, so their names and activity snapshots are then read by id on the app's normal connection — but only
 * for ids that came out of that RLS-filtered read. Nothing a caller sends can name a league; a partner can only
 * ever see a league some owner deliberately linked into their workspace.
 *
 * ⚠ NO FALLBACK TENANT, EVER. No membership means not entitled (lib/domain/db.ts resolveTenantsForUser).
 */
import { computeHealth, deriveActionItems, type CommissionerActionItem } from '@/lib/intelligence/IntelligenceQueryService'
import type { BindingSyncState } from '@/lib/domain/syncHealth'
import { syncHealthView } from '@/lib/domain/syncHealth'
import { ledgerRecordFor, MIN_GRADED_FOR_OVERALL_RATE, type LedgerSnapshot } from '@/lib/chimmy-outcomes/ledgerRecord'

export type TenantRoleName = 'TENANT_OWNER' | 'TENANT_ADMIN' | 'TENANT_SUPPORT'

export type BindingRow = { id: string; leagueId: string; provider: string } & BindingSyncState

export type LeagueFacts = {
  leagues: { id: string; name: string | null; sport: string | null }[]
  snapshots: { leagueId: string; lastActivityAt: Date | null; totalEvents: number; openTradeProposals: number }[]
  managers: { leagueId: string; managerKey: string; lastActiveAt: Date | null }[]
}

export type PortalDeps = {
  resolveTenantsForUser: (userId: string) => Promise<{ tenantId: string; role: TenantRoleName }[]>
  /** createActorContext + authorize('analytics.read') for the workspace; true when allowed. */
  authorizeRead: (input: { userId: string; actorLabel: string; tenantId: string; role: TenantRoleName }) => Promise<boolean>
  /** Inside withTenant(tenantId): the workspace's name and its live bindings. RLS supplies the tenant filter. */
  readWorkspace: (tenantId: string) => Promise<{ name: string | null; bindings: BindingRow[] }>
  /** On the app connection, BY ID ONLY: facts for leagues that came out of the RLS-filtered bindings. */
  readLeagueFacts: (leagueIds: string[]) => Promise<LeagueFacts>
  /**
   * The advice ledger graded over these leagues only (lib/chimmy-outcomes/ledgerGrading.ts
   * recomputeLedgerForLeagues). Same rule as the bindings: ids from the RLS-filtered read, never the caller.
   */
  readRecommendationRecord?: (leagueIds: string[]) => Promise<LedgerSnapshot | null>
  now?: () => Date
}

export type PortalLeague = {
  leagueId: string
  name: string
  sport: string | null
  provider: string
  healthScore: number
  status: 'healthy' | 'cooling' | 'stale' | 'unknown'
  totalManagers: number
  activeManagers: number
  daysSinceLastActivity: number | null
  actionItems: CommissionerActionItem[]
}

export type PortalSource = {
  provider: string
  leagues: number
  /** The OLDEST successful sync across this source's leagues: one stale league makes the source stale. */
  lastSyncedAt: string | null
  /** Leagues on this source that have never completed a sync — said out loud, not averaged away. */
  neverSynced: number
  degraded: number
  reason: string | null
}

/**
 * How the recommendations given in the workspace's leagues turned out — counts, then a rate once the sample
 * is big enough (the same MIN_GRADED_FOR_OVERALL_RATE the platform-wide record uses). NFL only: the grading
 * reads the NFL schedule and week-stats feed.
 */
export type PartnerRecord = {
  season: number
  /** Every NFL week through this one is over; nothing after it is graded. */
  throughWeek: number
  /** The rate needs this many decided calls (or graded pickups). */
  minSample: number
  startSit: { right: number; wrong: number; same: number; ratePct: number | null; gainPerCall: number | null; pending: number } | null
  pickups: { graded: number; startable: number; ratePct: number | null; vsDrop: number; beatDrop: number; pending: number } | null
}

/** Pure: the scoped ledger → what the portal shows. Null when nothing has been given or graded at all. */
export function buildPartnerRecord(ledger: LedgerSnapshot | null): PartnerRecord | null {
  if (!ledger) return null
  const view = ledgerRecordFor({ ...ledger, users: {} }, null)
  const benchPending = Math.max(0, ledger.bench?.pending ?? 0)
  const pickPending = Math.max(0, ledger.pickups?.pending ?? 0)
  const b = view?.bench?.everyone ?? null
  const p = view?.pickups?.everyone ?? null
  const startSit = b
    ? { right: b.right, wrong: b.wrong, same: b.same, ratePct: b.ratePct, gainPerCall: b.gainPerCall, pending: benchPending }
    : benchPending
      ? { right: 0, wrong: 0, same: 0, ratePct: null, gainPerCall: null, pending: benchPending }
      : null
  const pickups = p
    ? { graded: p.graded, startable: p.startable, ratePct: p.ratePct, vsDrop: p.vsDrop, beatDrop: p.beatDrop, pending: pickPending }
    : pickPending
      ? { graded: 0, startable: 0, ratePct: null, vsDrop: 0, beatDrop: 0, pending: pickPending }
      : null
  if (!startSit && !pickups) return null
  return { season: ledger.season, throughWeek: ledger.throughWeek, minSample: MIN_GRADED_FOR_OVERALL_RATE, startSit, pickups }
}

export type PortalView =
  | { kind: 'unavailable' }
  | { kind: 'not_member' }
  | { kind: 'forbidden' }
  | {
      kind: 'ok'
      tenantId: string
      workspaceName: string
      role: TenantRoleName
      /** A person can belong to more than one workspace; the first is shown and the count is said out loud. */
      otherWorkspaces: number
      leagues: PortalLeague[]
      sources: PortalSource[]
      summary: { leagues: number; managers: number; activeManagers: number; activePct: number; medianHealth: number; needsAttention: number; openItems: number }
      /** Null when nothing was recommended in these leagues yet, or the record could not be read (the page says which). */
      record: PartnerRecord | null
      recordUnavailable: boolean
    }

function daysBetween(then: Date | null, now: Date): number | null {
  if (!then) return null
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000))
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2)
}

/** Pure: bindings + league facts → the portal's league rows, worst first. */
export function buildPortalLeagues(bindings: BindingRow[], facts: LeagueFacts, now: Date): PortalLeague[] {
  const leagueById = new Map(facts.leagues.map((l) => [l.id, l]))
  const snapById = new Map(facts.snapshots.map((s) => [s.leagueId, s]))
  const seen = new Set<string>()
  const rows: PortalLeague[] = []
  for (const b of bindings) {
    if (seen.has(b.leagueId)) continue // one league linked twice (two providers) is still one league
    seen.add(b.leagueId)
    const s = snapById.get(b.leagueId) ?? null
    const managers = facts.managers.filter((m) => m.leagueId === b.leagueId)
    const leagueRow = { leagueId: b.leagueId, lastActivityAt: s?.lastActivityAt ?? null, totalEvents: s?.totalEvents ?? 0, openTradeProposals: Math.max(0, s?.openTradeProposals ?? 0) }
    const health = computeHealth(leagueRow, managers, now)
    rows.push({
      leagueId: b.leagueId,
      name: leagueById.get(b.leagueId)?.name?.trim() || 'Untitled league',
      sport: leagueById.get(b.leagueId)?.sport ?? null,
      provider: b.provider,
      healthScore: health.healthScore,
      status: health.status,
      totalManagers: managers.length,
      activeManagers: health.activeManagers,
      daysSinceLastActivity: daysBetween(s?.lastActivityAt ?? null, now),
      actionItems: deriveActionItems(s ? leagueRow : null, managers, now),
    })
  }
  const rank = { stale: 0, cooling: 1, unknown: 2, healthy: 3 } as const
  return rows.sort((a, b) => rank[a.status] - rank[b.status] || a.healthScore - b.healthScore)
}

/** Pure: per-provider sync health, from the same `syncHealthView` the sync-health API returns. */
export function buildPortalSources(bindings: BindingRow[], now: Date): PortalSource[] {
  const byProvider = new Map<string, PortalSource>()
  for (const b of bindings) {
    const v = syncHealthView(b, now)
    const cur = byProvider.get(b.provider) ?? { provider: b.provider, leagues: 0, lastSyncedAt: null, neverSynced: 0, degraded: 0, reason: null }
    cur.leagues += 1
    if (!v.lastSyncedAt) cur.neverSynced += 1
    else if (!cur.lastSyncedAt || v.lastSyncedAt < cur.lastSyncedAt) cur.lastSyncedAt = v.lastSyncedAt
    if (v.degraded) {
      cur.degraded += 1
      cur.reason = cur.reason ?? v.reason
    }
    byProvider.set(b.provider, cur)
  }
  return [...byProvider.values()].sort((a, b) => b.leagues - a.leagues || a.provider.localeCompare(b.provider))
}

export function summarizePortal(leagues: PortalLeague[]) {
  const managers = leagues.reduce((n, l) => n + l.totalManagers, 0)
  const activeManagers = leagues.reduce((n, l) => n + l.activeManagers, 0)
  return {
    leagues: leagues.length,
    managers,
    activeManagers,
    activePct: managers ? Math.round((activeManagers / managers) * 100) : 0,
    medianHealth: median(leagues.map((l) => l.healthScore)),
    needsAttention: leagues.filter((l) => l.status === 'stale' || l.status === 'cooling').length,
    openItems: leagues.reduce((n, l) => n + l.actionItems.filter((i) => i.severity !== 'info').length, 0),
  }
}

/**
 * The whole read. Every failure of the tenancy layer itself (no COMMISH_APP_URL, the isolation assertion refusing
 * the owner connection, the resolve function missing) is `unavailable` — a page that says workspaces are not
 * switched on, never a 500 and never a fallback.
 */
export async function loadPortalView(user: { id: string; label: string }, deps: PortalDeps): Promise<PortalView> {
  let memberships: { tenantId: string; role: TenantRoleName }[]
  try {
    memberships = await deps.resolveTenantsForUser(user.id)
  } catch (error) {
    console.error('[partner-portal] tenancy layer unavailable:', error instanceof Error ? error.message : error)
    return { kind: 'unavailable' }
  }
  if (memberships.length === 0) return { kind: 'not_member' }

  const m = memberships[0]!
  let allowed: boolean
  try {
    allowed = await deps.authorizeRead({ userId: user.id, actorLabel: user.label, tenantId: m.tenantId, role: m.role })
  } catch (error) {
    console.error('[partner-portal] authorize failed:', error instanceof Error ? error.message : error)
    return { kind: 'unavailable' }
  }
  if (!allowed) return { kind: 'forbidden' }

  let workspace: { name: string | null; bindings: BindingRow[] }
  try {
    workspace = await deps.readWorkspace(m.tenantId)
  } catch (error) {
    console.error('[partner-portal] workspace read failed:', error instanceof Error ? error.message : error)
    return { kind: 'unavailable' }
  }

  const now = deps.now?.() ?? new Date()
  const leagueIds = [...new Set(workspace.bindings.map((b) => b.leagueId))]
  const facts = leagueIds.length ? await deps.readLeagueFacts(leagueIds) : { leagues: [], snapshots: [], managers: [] }
  const leagues = buildPortalLeagues(workspace.bindings, facts, now)

  // The record is a section of the page, not the page: a failure here is said on the card, never a broken portal.
  let record: PartnerRecord | null = null
  let recordUnavailable = false
  if (leagueIds.length && deps.readRecommendationRecord) {
    try {
      record = buildPartnerRecord(await deps.readRecommendationRecord(leagueIds))
    } catch (error) {
      console.error('[partner-portal] recommendation record read failed:', error instanceof Error ? error.message : error)
      recordUnavailable = true
    }
  }

  return {
    kind: 'ok',
    tenantId: m.tenantId,
    workspaceName: workspace.name?.trim() || 'Your workspace',
    role: m.role,
    otherWorkspaces: memberships.length - 1,
    leagues,
    sources: buildPortalSources(workspace.bindings, now),
    summary: summarizePortal(leagues),
    record,
    recordUnavailable,
  }
}
