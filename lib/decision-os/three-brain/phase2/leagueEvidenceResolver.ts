/**
 * Blocker 1 — REAL production `CurrentEvidenceResolver`. Rebuilds a tool's evidence packet from AUTHORITATIVE
 * persisted DB state (never the old minimized request snapshot) so a durable refresh runs on current evidence.
 *
 * `buildLeagueIntelligenceEvidence` is the SHARED canonical DB→packet assembly: the refresh resolver uses it
 * now, and the Phase 3 route will use the SAME builder to create the original request — so an unchanged league
 * recanonicalizes to the SAME identity (reuse without a provider call) while any real activity/settings change
 * yields a NEW identity (recompute). It is READ-ONLY (imported/shadow leagues are never written).
 *
 * Evidence sources (all persisted, all current):
 *   - League                     — settings snapshot (roster/scoring/draft/waiver/playoff/concept), scoring
 *                                  preset, sport, season, platform, status, sync status, imported flag.
 *   - IntelligenceLeagueSnapshot — behavioral/activity signal: trade/waiver/lineup/scoring/governance/draft
 *                                  counts, open trade proposals, last activity — the authoritative "what changed".
 *   - Roster                     — current roster/lineup cardinality for the league.
 *   - connectedGroupId (on the run) — connected-league/group scope, folded into identity.
 *
 * Live-sensitivity: the persisted snapshot is authoritative for behavioral/managerial decisions (trade,
 * commissioner, matchup, static/history, draft). It is NOT a live injury/weather/in-game feed — so for a
 * live-sensitive decision the resolver reports `isLive:false`, and the refresh worker refuses (never presents a
 * live answer built from non-live evidence). Missing league/snapshot → honest `evidence_unavailable`.
 *
 * SCOPE — single league only. Phase 2 rebuilds evidence for ONE league. A connected-group request (spanning
 * linked NFL/NCAAF leagues) is NOT supported: rebuilding complete connected-group evidence (resolve every
 * member league, verify per-league access, load each league's settings/rosters/snapshot/versions, preserve
 * separate sport pools, canonicalize deterministically, fold every member version into the fingerprint) is a
 * Phase 3 task. Connected requests are therefore refresh-UNSUPPORTED: they do not enqueue, are served stale
 * WITHOUT a freshness bump, and refuse honestly if a job is somehow drained.
 */
import 'server-only'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { buildEvidencePacket } from '../evidencePacket'
import type { DecisionOSSignal, VerifiedDecisionFact } from '../types'
import { resolveFreshnessPolicy } from './freshnessPolicy'
import { loadLeagueSourceVersion, type CurrentEvidenceResolver } from './dbEvidenceRehydration'
import type { IntelligenceRequestContext, IntelligenceRunRecord, IntelligenceTool } from './types'

type PrismaLike = typeof defaultPrisma

/** The tools this resolver can safely serve from persisted league evidence today (behavioral/managerial). */
export const LEAGUE_EVIDENCE_TOOLS: ReadonlySet<IntelligenceTool> = new Set<IntelligenceTool>([
  'manager_intelligence',
])

type LeagueRow = {
  id: string
  platform: string
  platformLeagueId: string
  name: string | null
  sport: string
  season: number
  scoring: string | null
  scoringPresetId: string | null
  status: string | null
  syncStatus: string | null
  settingsSnapshotVersion: number | null
  importedAt: Date | null
}

/** Stable, deterministic evidence for a league+tool+decision from CURRENT persisted DB state. Returns null when
 *  the required authoritative evidence is not persisted (caller maps that to an honest unavailable). */
export async function buildLeagueIntelligenceEvidence(input: {
  db?: PrismaLike
  leagueId: string
  userId: string
  tool: IntelligenceTool
  decisionType: string
  connectedGroupId?: string | null
}): Promise<
  | { ok: true; ctx: IntelligenceRequestContext; sourceDataVersion: string; isLive: boolean }
  | { ok: false; reason: string }
> {
  const db = input.db ?? defaultPrisma
  // Single-league scope only. A connected-group request is not fully rebuildable in Phase 2 → refuse honestly
  // rather than pass one league's evidence off as connected-group evidence.
  if (input.connectedGroupId) return { ok: false, reason: 'connected_group_refresh_unsupported' }
  const league = (await db.league.findUnique({
    where: { id: input.leagueId },
    select: {
      id: true, platform: true, platformLeagueId: true, name: true, sport: true, season: true,
      scoring: true, scoringPresetId: true, status: true, syncStatus: true,
      settingsSnapshotVersion: true, importedAt: true,
    },
  })) as LeagueRow | null
  if (!league) return { ok: false, reason: 'evidence_unavailable' }

  // The authoritative behavioral/activity snapshot (source-version signal). Absent → we have no current
  // behavioral evidence to analyze → refuse honestly rather than refresh from nothing.
  const source = await loadLeagueSourceVersion(db, input.leagueId)
  if (!source) return { ok: false, reason: 'evidence_unavailable' }

  const snap = await db.intelligenceLeagueSnapshot.findUnique({
    where: { leagueId: input.leagueId },
    select: {
      totalEvents: true, tradeCount: true, waiverCount: true, lineupCount: true, draftCount: true,
      scoringCount: true, governanceCount: true, openTradeProposals: true,
    },
  })
  if (!snap) return { ok: false, reason: 'evidence_unavailable' }

  const rosterCount = await db.roster.count({ where: { leagueId: input.leagueId } })

  // Live-sensitivity: persisted snapshot is current-truth for behavioral decisions but is NOT a live feed.
  const policy = resolveFreshnessPolicy(input.decisionType)
  const isLive = !policy.liveSensitive

  // Deterministic freshness derived from PERSISTED sync status (never wall-clock — that would drift identity).
  const syncBad = /error|failed|stale|degraded/i.test(league.syncStatus ?? '')
  const freshnessState: 'fresh' | 'aging' | 'stale' = syncBad ? 'stale' : 'fresh'

  // Signals + facts are derived ONLY from persisted content, so unchanged evidence → identical fingerprint.
  const signals: Array<Omit<DecisionOSSignal, 'id'> & { id?: string }> = [
    { id: 'sig-activity', kind: 'league_activity', summary: `total_events=${snap.totalEvents}`, severity: 'info' },
    { id: 'sig-trades', kind: 'trade_activity', summary: `trades=${snap.tradeCount} open_proposals=${snap.openTradeProposals}`, severity: snap.openTradeProposals > 0 ? 'warning' : 'info' },
    { id: 'sig-transactions', kind: 'transaction_activity', summary: `waivers=${snap.waiverCount} lineups=${snap.lineupCount}`, severity: 'info' },
    { id: 'sig-governance', kind: 'governance_activity', summary: `governance=${snap.governanceCount} scoring=${snap.scoringCount}`, severity: 'info' },
  ]
  const facts: Array<Omit<VerifiedDecisionFact, 'id'> & { id?: string }> = [
    { id: 'fact-scoring', label: 'Scoring preset', value: league.scoringPresetId ?? league.scoring ?? 'unknown', source: 'league.settings' },
    { id: 'fact-season', label: 'Season', value: String(league.season), source: 'league' },
    { id: 'fact-status', label: 'League status', value: `${league.status ?? 'unknown'}/${league.syncStatus ?? 'unknown'}`, source: 'league' },
    { id: 'fact-settings-version', label: 'Settings snapshot version', value: String(league.settingsSnapshotVersion ?? 0), source: 'league' },
    { id: 'fact-rosters', label: 'Rosters', value: String(rosterCount), source: 'roster' },
    { id: 'fact-drafts', label: 'Draft events', value: String(snap.draftCount), source: 'intelligence_league_snapshot' },
  ]

  const packet = buildEvidencePacket({
    userId: input.userId,
    sport: String(league.sport),
    decisionType: input.decisionType,
    mode: 'league',
    canonicalLeagueId: league.id,
    platform: league.platform,
    platformLeagueId: league.platformLeagueId,
    season: String(league.season),
    signals,
    facts,
    freshness: { state: freshnessState },
    missingInformation: isLive ? [] : ['live_game_data_not_available_from_persisted_evidence'],
  })

  const ctx: IntelligenceRequestContext = {
    tool: input.tool,
    userId: input.userId,
    packet,
    connectedGroupId: input.connectedGroupId ?? null,
    sourceDataVersion: source.version,
    isImportedLeague: league.importedAt != null, // imported → analyze only, never write
  }
  return { ok: true, ctx, sourceDataVersion: source.version, isLive }
}

/** The registered production resolver. Supports the behavioral/managerial tools it can rebuild from persisted
 *  evidence; everything else is explicitly unsupported (the enqueue side then never arms a refresh). */
export class LeagueEvidenceResolver implements CurrentEvidenceResolver {
  private readonly db: PrismaLike
  private readonly tools: ReadonlySet<IntelligenceTool>
  constructor(opts?: { db?: PrismaLike; tools?: ReadonlySet<IntelligenceTool> }) {
    this.db = opts?.db ?? defaultPrisma
    this.tools = opts?.tools ?? LEAGUE_EVIDENCE_TOOLS
  }

  supports(tool: string, _decisionType: string, connectedGroupId?: string | null): boolean {
    // Single-league only in Phase 2 — a connected-group request is unsupported (no enqueue).
    return this.tools.has(tool as IntelligenceTool) && !connectedGroupId
  }

  async resolve(input: {
    run: IntelligenceRunRecord
    sourceDataVersion: string | null
    lastActivityAt: Date | null
  }): Promise<{ ok: true; ctx: IntelligenceRequestContext; isLive: boolean } | { ok: false; reason: string }> {
    const { run } = input
    if (run.connectedGroupId) return { ok: false, reason: 'connected_group_refresh_unsupported' }
    if (!run.leagueId) return { ok: false, reason: 'evidence_requires_league' }
    const built = await buildLeagueIntelligenceEvidence({
      db: this.db,
      leagueId: run.leagueId,
      userId: run.userId,
      tool: run.tool as IntelligenceTool,
      decisionType: run.decisionType,
      connectedGroupId: run.connectedGroupId,
    })
    if (!built.ok) return built
    return { ok: true, ctx: built.ctx, isLive: built.isLive }
  }
}
