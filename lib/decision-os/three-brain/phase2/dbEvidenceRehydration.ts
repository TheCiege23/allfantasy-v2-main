/**
 * Issue 1 — REAL DB-first evidence rehydrator. A refresh must run on CURRENT evidence, never on the old
 * minimized snapshot. This loads the authoritative persisted source-data VERSION for a league (from
 * `IntelligenceLeagueSnapshot` — a trade/waiver/lineup/scoring/governance event bumps it) and delegates the
 * request rebuild to a per-tool `CurrentEvidenceResolver`.
 *
 * Honest support contract: a tool/decision is refresh-SUPPORTED only when a resolver is registered for it.
 * With none registered (the Phase 2 default), the tool's refresh is UNSUPPORTED — the enqueue side does NOT
 * enqueue an executable refresh (so it never retries every 10 minutes) and the drain refuses cleanly, retaining
 * the permitted stale result with honest refresh-unavailable metadata. Phase 3 registers real resolvers
 * (reading league/roster/matchup/standings/draft/trade/waiver/scoring/settings/injury/weather/news) WITHOUT
 * connecting any of the four live Decision OS routes. Imported leagues stay read-only (this only READS).
 */
import 'server-only'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { resolveFreshnessPolicy } from './freshnessPolicy'
import type { EvidenceRehydrator, RehydrationResult } from './evidenceRehydration'
import type { IntelligenceRequestContext, IntelligenceRunRecord } from './types'

type PrismaLike = typeof defaultPrisma

/**
 * Authoritative current source-data VERSION for a league, derived from the persisted activity snapshot. Any
 * new event (trade/waiver/lineup/scoring/governance/open-proposal) changes the version → a material change.
 */
export async function loadLeagueSourceVersion(
  db: PrismaLike,
  leagueId: string,
): Promise<{ version: string; lastActivityAt: Date | null } | null> {
  const snap = await db.intelligenceLeagueSnapshot.findUnique({
    where: { leagueId },
    select: {
      totalEvents: true, tradeCount: true, waiverCount: true, lineupCount: true, draftCount: true,
      scoringCount: true, governanceCount: true, openTradeProposals: true, lastActivityAt: true,
    },
  })
  if (!snap) return null
  // CONTENT-based version — the real activity signal (lastActivityAt) + the semantic event counts, NOT the
  // row's write timestamp. A no-op re-write of the snapshot must NOT look like a material change (that would
  // force needless provider spend); only an actual new event (which bumps a count and lastActivityAt) does.
  const version = [
    'v1',
    snap.lastActivityAt ? snap.lastActivityAt.toISOString() : 'none',
    snap.totalEvents, snap.tradeCount, snap.waiverCount, snap.lineupCount, snap.draftCount,
    snap.scoringCount, snap.governanceCount, snap.openTradeProposals,
  ].join(':')
  return { version, lastActivityAt: snap.lastActivityAt }
}

/**
 * Rebuilds the CURRENT request context for a tool from authoritative DB state. Phase 3 registers real
 * resolvers; without one, the tool's refresh is unsupported.
 */
export interface CurrentEvidenceResolver {
  /** Whether this resolver can rebuild CURRENT evidence for the tool/decision/scope. `connectedGroupId` is
   *  passed so a resolver can decline a scope it cannot fully rebuild (e.g. Phase 2 = single-league only). */
  supports(tool: string, decisionType: string, connectedGroupId?: string | null): boolean
  resolve(input: {
    run: IntelligenceRunRecord
    sourceDataVersion: string | null
    lastActivityAt: Date | null
  }): Promise<{ ok: true; ctx: IntelligenceRequestContext; isLive: boolean } | { ok: false; reason: string }>
}

/** DB-first rehydrator. Delegates to a registered resolver, stamps the current league source version, and
 *  refuses honestly when unsupported / unavailable / (live-sensitive without fresh live evidence). */
export class DbEvidenceRehydrator implements EvidenceRehydrator {
  constructor(
    private readonly resolvers: CurrentEvidenceResolver[] = [],
    private readonly db: PrismaLike = defaultPrisma,
  ) {}

  /** Whether a refresh can be safely enqueued for this tool/decision/scope (a resolver supports it). */
  supports(tool: string, decisionType: string, connectedGroupId?: string | null): boolean {
    return this.resolvers.some((r) => r.supports(tool, decisionType, connectedGroupId))
  }

  async rehydrate({ run }: { run: IntelligenceRunRecord }): Promise<RehydrationResult> {
    const resolver = this.resolvers.find((r) => r.supports(run.tool, run.decisionType, run.connectedGroupId))
    if (!resolver) return { ok: false, reason: 'refresh_unsupported_tool' }

    const source = run.leagueId ? await loadLeagueSourceVersion(this.db, run.leagueId) : null
    const loaded = await resolver.resolve({
      run,
      sourceDataVersion: source?.version ?? null,
      lastActivityAt: source?.lastActivityAt ?? null,
    })
    if (!loaded.ok) return { ok: false, reason: loaded.reason }

    const policy = resolveFreshnessPolicy(run.decisionType)
    if (policy.liveSensitive && !loaded.isLive) return { ok: false, reason: 'live_evidence_stale_or_unavailable' }

    return {
      ok: true,
      ctx: loaded.ctx,
      sourceDataVersion: source?.version ?? null,
      isLiveEvidence: loaded.isLive,
      evidenceLoadedAt: new Date().toISOString(),
    }
  }
}

/** Convenience predicate for the enqueue side (default rehydrator has no resolvers → everything unsupported). */
export function isRefreshSupported(
  rehydrator: EvidenceRehydrator | undefined,
  tool: string,
  decisionType: string,
  connectedGroupId?: string | null,
): boolean {
  return rehydrator instanceof DbEvidenceRehydrator ? rehydrator.supports(tool, decisionType, connectedGroupId) : false
}
