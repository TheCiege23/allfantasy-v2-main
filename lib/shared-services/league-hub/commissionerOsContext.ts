/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 4.
 *
 * Deliberately built as a thin wrapper around the real, already-built,
 * shadow-mode `lib/shared-services/commissioner/*` package (Fantasy OS
 * Migration Plan, Phase 10) — NOT a parallel context assembler. That
 * package's own `buildCommissionerContext()` already federates real,
 * live-computed League Health, activity counts, retention risk, and
 * format-awareness (redraft/dynasty/specialty-stub honesty) by reusing
 * `resolveMissionControlSnapshot`/`resolveLeagueAnalyticsSnapshot` — this
 * phase's Part 1 inventory confirmed it has never been given a real
 * consumer. This assembler gives it one.
 *
 * Storylines, rivalries, and draft grades are likewise NOT recomputed here.
 * This phase's own inventory found three more real, already-live,
 * deterministic engines with their own persisted tables: `lib/drama-engine/`
 * (→ `DramaEvent`), `lib/rivalry-engine/` (→ `RivalryRecord`/`RivalryEvent`
 * — NOT the legacy, roster_id-keyed `lib/rivalry-engine.ts` single-file
 * module, a confirmed duplicate this phase deliberately avoids extending),
 * and `lib/rankings-engine/draft-grades.ts` (→ `DraftGrade`). This
 * assembler only READS their already-persisted output — it never calls
 * `runLeagueDramaEngine`/`runRivalryEngine`/`computeDraftGrades` itself.
 * When a league has no rows yet (the engine has never run for it), the
 * corresponding field is honestly empty, never fabricated.
 *
 * Authorization is intentionally NOT delegated to
 * `lib/shared-services/commissioner/CommissionerAuthorization.ts`'s
 * `resolveCommissionerAccess` (which wraps `getLeagueRole()`) — that
 * module's own docstring discloses a real gap: for imported leagues,
 * `getLeagueRole()` reflects "who imported it," not real, attestation-aware
 * commissioner status. This phase instead reuses
 * `resolveActiveLeagueContext`'s `isCommissioner`, which this same phase
 * just fixed (see `activeLeagueContext.ts`) to also trust a real, recorded
 * `commissionerVerification` attestation for MFL/ESPN/Yahoo — the more
 * correct, more recently hardened of the two mechanisms, and the same one
 * every other League Hub surface already uses.
 */
import { prisma } from '@/lib/prisma'
import { resolveActiveLeagueContext } from './activeLeagueContext'
import { deriveImportType } from './providerCapabilities'
import {
  buildCommissionerContext,
  buildLeagueHealthAssessment,
  buildCommissionerAttentionItems,
  buildCommissionerRanking,
  buildCommissionerBrief,
  type CommissionerContext,
  type LeagueHealthAssessment,
  type CommissionerAttentionItem,
  type CommissionerPowerRanking,
  type CommissionerBrief,
} from '@/lib/shared-services/commissioner'
import type { ActiveLeagueContext, LeagueHubProvider, SyncFreshness } from './types'

export interface LeagueChampionRecord {
  season: number
  championTeamId: string | null
  championName: string | null
  runnerUpName: string | null
}

/** Real, persisted `RivalryRecord` + its `RivalryEvent[]` — read-only, this phase never calls `runRivalryEngine` itself. */
export interface RivalryRecordSummary {
  id: string
  managerAId: string
  managerBId: string
  rivalryScore: number
  rivalryTier: string
  eventCount: number
  latestEvent: { eventType: string; season: number | null } | null
}

/** Real, persisted `DramaEvent` — read-only, this phase never calls `runLeagueDramaEngine` itself. */
export interface DramaEventSummary {
  id: string
  dramaType: string
  headline: string
  summary: string | null
  relatedManagerIds: string[]
  relatedTeamIds: string[]
  dramaScore: number
  season: number | null
  createdAt: string
}

/** Real, persisted `DraftGrade` — read-only, this phase never calls `computeDraftGrades` itself. */
export interface DraftGradeSummary {
  rosterId: string
  season: string
  grade: string
  score: number
}

export interface CommissionerOsContext {
  appUserId: string
  canonicalLeagueId: string
  provider: LeagueHubProvider
  sport: string
  season: number | string | null
  isDynasty: boolean
  isCommissioner: boolean
  syncFreshness: SyncFreshness
  /**
   * Part 18 — real, from `deriveImportType` (the same function every other
   * League Hub provider badge already uses). `true` only for Fantrax
   * (`csv_snapshot`) today. A one-time CSV upload can prove a lineup was
   * empty AT THE MOMENT OF UPLOAD, but never a *repeated* or *ongoing*
   * pattern (abandonment, inactivity trend) — generators must not phrase a
   * snapshot-only observation as a live-activity conclusion.
   */
  isSnapshotOnly: boolean
  /** The real, reused shared-services context — every field on it is real, live-computed data. */
  shared: CommissionerContext
  health: LeagueHealthAssessment
  attentionItems: CommissionerAttentionItem[]
  ranking: CommissionerPowerRanking | null
  brief: CommissionerBrief
  /** Real `LeagueSeason` rows — empty when no season history has been recorded, never fabricated. */
  championHistory: LeagueChampionRecord[]
  /** Real, persisted `RivalryRecord` rows (canonical `lib/rivalry-engine/`) — empty when the engine has never run for this league. */
  rivalries: RivalryRecordSummary[]
  /** Real, persisted `DramaEvent` rows (`lib/drama-engine/`) for the current season — empty when the engine has never run for this league/season. */
  dramaEvents: DramaEventSummary[]
  /** Real, persisted `DraftGrade` rows (`lib/rankings-engine/draft-grades.ts`) — empty when no draft has been graded for this league/season. */
  draftGrades: DraftGradeSummary[]
  unavailableDomains: string[]
}

function toProvider(platform: string | null | undefined): LeagueHubProvider {
  const p = String(platform ?? '').toLowerCase()
  if (p === '' || p === 'allfantasy' || p === 'af' || p === 'manual' || p === 'native') return 'allfantasy'
  return p
}

/**
 * Resolves the Commissioner OS context. Returns `null` when the caller is
 * not a real, verified commissioner of this league — fail-closed, callers
 * (the API route) must treat `null` as 404, never assume access.
 */
export async function assembleCommissionerOsContext(args: {
  appUserId: string
  canonicalLeagueId: string
}): Promise<CommissionerOsContext | null> {
  const active: ActiveLeagueContext | null = await resolveActiveLeagueContext({
    leagueId: args.canonicalLeagueId,
    userId: args.appUserId,
  })
  if (!active || active.isCommissioner !== true) return null

  const league = await prisma.league.findUnique({
    where: { id: args.canonicalLeagueId },
    select: { platform: true, sport: true, season: true, isDynasty: true },
  })
  if (!league) return null

  const provider = toProvider(league.platform)
  const currentSeason = typeof league.season === 'number' ? league.season : new Date().getFullYear()

  const shared = await buildCommissionerContext({
    leagueId: args.canonicalLeagueId,
    requestingUserId: args.appUserId,
  })
  const health = buildLeagueHealthAssessment(shared)
  const attentionItems = buildCommissionerAttentionItems(shared)
  const ranking = await buildCommissionerRanking(shared).catch(() => null)
  const brief = buildCommissionerBrief(shared, ranking, attentionItems)

  const [seasonRows, rivalryRows, dramaRows, draftGradeRows] = await Promise.all([
    prisma.leagueSeason
      .findMany({
        where: { leagueId: args.canonicalLeagueId },
        orderBy: { season: 'desc' },
        select: { season: true, championTeamId: true, championName: true, runnerUpName: true },
      })
      .catch(() => []),
    prisma.rivalryRecord
      .findMany({
        where: { leagueId: args.canonicalLeagueId },
        orderBy: { rivalryScore: 'desc' },
        include: {
          events: { orderBy: { createdAt: 'desc' }, take: 1, select: { eventType: true, season: true } },
          _count: { select: { events: true } },
        },
      })
      .catch(() => []),
    prisma.dramaEvent
      .findMany({
        where: { leagueId: args.canonicalLeagueId, season: currentSeason },
        orderBy: { dramaScore: 'desc' },
        take: 20,
      })
      .catch(() => []),
    prisma.draftGrade
      .findMany({
        where: { leagueId: args.canonicalLeagueId, season: String(currentSeason) },
      })
      .catch(() => []),
  ])

  const unavailableDomains: string[] = []
  if (String(league.sport ?? 'NFL').toUpperCase() !== 'NFL') {
    unavailableDomains.push('storylines_weekly_cadence')
  }
  if (rivalryRows.length === 0) {
    unavailableDomains.push('rivalries_history')
  }
  if (draftGradeRows.length === 0) {
    unavailableDomains.push('draft_grades')
  }

  return {
    appUserId: args.appUserId,
    canonicalLeagueId: args.canonicalLeagueId,
    provider,
    sport: String(league.sport ?? 'NFL'),
    season: league.season ?? null,
    isDynasty: league.isDynasty,
    isCommissioner: true,
    syncFreshness: active.syncFreshness,
    isSnapshotOnly: deriveImportType(provider) === 'csv_snapshot',
    shared,
    health,
    attentionItems,
    ranking,
    brief,
    championHistory: seasonRows.map((r) => ({
      season: r.season,
      championTeamId: r.championTeamId,
      championName: r.championName,
      runnerUpName: r.runnerUpName,
    })),
    rivalries: rivalryRows.map((r) => ({
      id: r.id,
      managerAId: r.managerAId,
      managerBId: r.managerBId,
      rivalryScore: r.rivalryScore,
      rivalryTier: r.rivalryTier,
      eventCount: r._count.events,
      latestEvent: r.events[0] ? { eventType: r.events[0].eventType, season: r.events[0].season } : null,
    })),
    dramaEvents: dramaRows.map((d) => ({
      id: d.id,
      dramaType: d.dramaType,
      headline: d.headline,
      summary: d.summary,
      relatedManagerIds: Array.isArray(d.relatedManagerIds) ? (d.relatedManagerIds as string[]) : [],
      relatedTeamIds: Array.isArray(d.relatedTeamIds) ? (d.relatedTeamIds as string[]) : [],
      dramaScore: d.dramaScore,
      season: d.season,
      createdAt: d.createdAt.toISOString(),
    })),
    draftGrades: draftGradeRows.map((g) => ({
      rosterId: g.rosterId,
      season: g.season,
      grade: g.grade,
      score: Number(g.score),
    })),
    unavailableDomains,
  }
}
