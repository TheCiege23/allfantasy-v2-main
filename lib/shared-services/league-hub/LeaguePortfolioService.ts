/**
 * Universal League Hub — canonical League Portfolio service (Part 1).
 *
 * Aggregates every league the authenticated user owns or participates in —
 * native AllFantasy leagues, plus Sleeper/ESPN/Yahoo/MFL/Fantrax imports —
 * into one normalized, provider-agnostic list.
 *
 * Deliberately reuses `getDashboardLeagueListForUser` (`lib/dashboard/get-dashboard-league-list.ts`)
 * for the actual aggregation/merge/dedup logic instead of re-querying
 * `League`/`SleeperLeague`/`LegacyTournament` independently — that function
 * already solves the hard part (merging native `League` rows with the
 * legacy `SleeperLeague` table and deduping against `hasUnifiedRecord`,
 * plus the tournament-hub union). This service only adds the canonical
 * shape, capability badges, sync freshness, and the two pieces of real data
 * that function doesn't already surface: the viewer's own `LeagueTeam`
 * record and a cached playoff-probability snapshot.
 *
 * League Tycoon: grepped the full repo, zero implementation exists anywhere
 * (no route, no model, no component) — not a partial build to wire into,
 * a name with no code behind it. Documented seam: when it exists, add one
 * more source array to `Promise.all` below, normalize into `LeagueHubEntry`
 * with `provider: 'allfantasy'` (League Tycoon is a native game mode) and
 * `importType: 'native'` — no other change needed anywhere else in this
 * service or its consumers.
 */
import { prisma } from '@/lib/prisma'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { deriveProviderCapabilities, deriveImportType } from './providerCapabilities'
import { deriveSyncFreshness } from './syncFreshness'
import { getEmptyRecommendationBundle } from './recommendationContract'
import type { LeagueHubEntry, LeagueHubProvider, LeaguePortfolio } from './types'
import type { TeamSeasonForecast } from '@/lib/season-forecast/types'

interface RawDashboardLeagueRow {
  id: string
  name?: string | null
  sport?: string | null
  sport_type?: string | null
  platform?: string | null
  season?: number | string | null
  status?: string | null
  isCommissioner?: boolean
  syncStatus?: string | null
  syncError?: string | null
  lastSyncedAt?: Date | string | null
  createdAt?: Date | string | null
  settings?: unknown
  navigationLeagueId?: string | null
  unifiedLeagueId?: string | null
  hasUnifiedRecord?: boolean
}

function toSettingsRecord(settings: unknown): Record<string, unknown> | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  return settings as Record<string, unknown>
}

function toProvider(platform: string | null | undefined): LeagueHubProvider {
  const p = String(platform ?? '').toLowerCase()
  if (p === '' || p === 'allfantasy' || p === 'af' || p === 'manual' || p === 'native') return 'allfantasy'
  return p
}

/** Real `League.id` when this row has one — never the legacy `SleeperLeague.id`, which no
 *  downstream OS module (Trade/Waiver/Lineup) can resolve. */
function resolveCanonicalLeagueId(row: RawDashboardLeagueRow): { id: string; hasCanonicalRecord: boolean } {
  if (row.hasUnifiedRecord && row.unifiedLeagueId) {
    return { id: row.unifiedLeagueId, hasCanonicalRecord: true }
  }
  return { id: row.id, hasCanonicalRecord: false }
}

export async function getLeaguePortfolioForUser(userId: string): Promise<LeaguePortfolio> {
  const base = await getDashboardLeagueListForUser(userId)
  const rows = base.leagues as RawDashboardLeagueRow[]

  const canonicalIds = Array.from(
    new Set(
      rows
        .map((row) => resolveCanonicalLeagueId(row))
        .filter((r) => r.hasCanonicalRecord)
        .map((r) => r.id)
    )
  )

  const [viewerTeams, forecastSnapshots] = canonicalIds.length
    ? await Promise.all([
        prisma.leagueTeam.findMany({
          where: { leagueId: { in: canonicalIds }, claimedByUserId: userId },
          select: {
            id: true,
            leagueId: true,
            teamName: true,
            wins: true,
            losses: true,
            ties: true,
            currentRank: true,
          },
        }),
        prisma.seasonForecastSnapshot
          .findMany({
            where: { leagueId: { in: canonicalIds } },
            orderBy: [{ leagueId: 'asc' }, { week: 'desc' }],
            select: { leagueId: true, week: true, teamForecasts: true },
          })
          .catch(() => []),
      ])
    : [[], []]

  const teamByLeagueId = new Map<string, (typeof viewerTeams)[number]>()
  for (const team of viewerTeams) {
    if (!teamByLeagueId.has(team.leagueId)) teamByLeagueId.set(team.leagueId, team)
  }

  // Keep only the latest (highest-week) snapshot per league — the query is already
  // ordered `week: desc`, so the first row seen per leagueId wins.
  const latestForecastByLeagueId = new Map<string, unknown>()
  for (const snap of forecastSnapshots) {
    if (!latestForecastByLeagueId.has(snap.leagueId)) {
      latestForecastByLeagueId.set(snap.leagueId, snap.teamForecasts)
    }
  }

  function resolvePlayoffProbability(leagueId: string, teamId: string | null): number | null {
    if (!teamId) return null
    const raw = latestForecastByLeagueId.get(leagueId)
    if (!Array.isArray(raw)) return null
    const match = (raw as TeamSeasonForecast[]).find((t) => t?.teamId === teamId)
    return typeof match?.playoffProbability === 'number' ? match.playoffProbability : null
  }

  const leagues: LeagueHubEntry[] = rows.map((row) => {
    const { id: canonicalLeagueId, hasCanonicalRecord } = resolveCanonicalLeagueId(row)
    const provider = toProvider(row.platform)
    const settings = toSettingsRecord(row.settings)
    const isCommissioner = Boolean(row.isCommissioner)
    const team = hasCanonicalRecord ? teamByLeagueId.get(canonicalLeagueId) ?? null : null

    let verificationMethod: 'api' | 'attestation' | 'membership-only' | null = null
    const rawVerification = settings?.['commissionerVerification']
    if (rawVerification && typeof rawVerification === 'object') {
      const method = (rawVerification as Record<string, unknown>)['method']
      if (method === 'api' || method === 'attestation' || method === 'membership-only') {
        verificationMethod = method
      }
    }

    return {
      canonicalLeagueId,
      hasCanonicalRecord,
      provider,
      sport: String(row.sport_type ?? row.sport ?? 'NFL'),
      season: row.season ?? null,
      leagueName: row.name ?? 'Untitled League',
      userTeam: {
        id: team?.id ?? null,
        name: team?.teamName ?? null,
        record: team ? { wins: team.wins, losses: team.losses, ties: team.ties } : null,
        standingsPosition: team?.currentRank ?? null,
      },
      commissionerStatus: {
        isCommissioner,
        verificationMethod,
      },
      platformLogoKey: provider,
      syncFreshness: deriveSyncFreshness({
        provider,
        syncStatus: row.syncStatus,
        lastSyncedAt: row.lastSyncedAt,
      }),
      importType: deriveImportType(provider),
      capabilities: deriveProviderCapabilities({ provider, isCommissioner, settings }),
      playoffProbability: hasCanonicalRecord
        ? resolvePlayoffProbability(canonicalLeagueId, team?.id ?? null)
        : null,
      recommendations: getEmptyRecommendationBundle(),
      lastActivityAt: row.lastSyncedAt
        ? new Date(row.lastSyncedAt).toISOString()
        : row.createdAt
          ? new Date(row.createdAt).toISOString()
          : null,
    }
  })

  return { leagues, sleeperUserId: base.sleeperUserId }
}
