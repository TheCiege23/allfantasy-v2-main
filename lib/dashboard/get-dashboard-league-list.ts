/**
 * Shared league list for `/api/league/list` and dashboard SSR so My Leagues hydrates
 * immediately without waiting for a client-side fetch.
 */
import { prisma } from '@/lib/prisma'
import { DEFAULT_SPORT } from '@/lib/sport-scope'
import { isRealLeague, EXCLUDED_VARIANTS } from '@/lib/leagues/leagueListFilter'
import { resolveLeagueListSeasonYear } from '@/lib/leagues/resolveLeagueListSeasonYear'

const VARIANT_NOT_IN = Array.from(EXCLUDED_VARIANTS)

function normalizeSleeperScoring(raw: string | null | undefined): string {
  const s = (raw ?? '').toLowerCase().trim()
  if (s === 'ppr') return 'PPR'
  if (s === 'half_ppr' || s === '0.5_ppr') return 'Half-PPR'
  return 'Standard'
}

function extractEntryFeeUsd(settings: unknown): number | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const o = settings as Record<string, unknown>
  const keys = ['entryFee', 'entry_fee', 'buyIn', 'buy_in', 'buyInAmount', 'entry_fee_usd']
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
  }
  return null
}

function computeUserRole(
  platform: string,
  isCommissioner: boolean
): 'commissioner' | 'member' | 'imported' {
  const p = String(platform || '').toLowerCase()
  if (isCommissioner) return 'commissioner'
  if (p !== 'allfantasy' && p !== 'af' && p !== 'manual') return 'imported'
  return 'member'
}

/** Dashboard viewer is commissioner/co-commish for this league row (not necessarily `League.userId`). */
export function resolveViewerLeagueCommissioner(params: {
  platform: string
  leagueRowOwnerId: string
  viewerUserId: string
  leagueIsCommissionerFlag: boolean
  membershipRole?: string | null
  team?: { isCommissioner?: boolean | null; isCoCommissioner?: boolean | null } | null
}): boolean {
  const p = String(params.platform || '').toLowerCase()
  const isRowOwner = params.leagueRowOwnerId === params.viewerUserId
  if (params.team?.isCommissioner || params.team?.isCoCommissioner) return true
  if (params.membershipRole === 'COMMISSIONER') return true
  if (
    isRowOwner &&
    (params.leagueIsCommissionerFlag || p === 'manual' || p === 'allfantasy' || p === 'af')
  ) {
    return true
  }
  return false
}

export type DashboardLeagueListPayload = {
  leagues: unknown[]
  sleeperUserId: string | null
}

export async function getDashboardLeagueListForUser(userId: string): Promise<DashboardLeagueListPayload> {
  const profile = await prisma.userProfile
    .findUnique({
      where: { userId },
      select: { sleeperUserId: true },
    })
    .catch(() => null)

  const [genericLeagues, sleeperLeagues, tournaments] = await Promise.all([
    (prisma as any).league
      .findMany({
        where: {
          name: { not: null },
          AND: [
            {
              OR: [
                { userId },
                { redraftMembers: { some: { userId } } },
                { teams: { some: { claimedByUserId: userId } } },
              ],
            },
            {
              OR: [{ leagueVariant: null }, { leagueVariant: { notIn: VARIANT_NOT_IN } }],
            },
            {
              NOT: {
                AND: [
                  { platform: 'sleeper' },
                  { leagueVariant: null },
                  {
                    OR: [
                      { status: null },
                      { importWins: { not: null } },
                      { importLosses: { not: null } },
                      { importFinalStanding: { not: null } },
                    ],
                  },
                ],
              },
            },
          ],
        },
        orderBy: [{ season: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          userId: true,
          name: true,
          sport: true,
          leagueVariant: true,
          platform: true,
          platformLeagueId: true,
          leagueSize: true,
          season: true,
          status: true,
          avatarUrl: true,
          scoring: true,
          isDynasty: true,
          settings: true,
          syncStatus: true,
          syncError: true,
          lastSyncedAt: true,
          createdAt: true,
          isCommissioner: true,
          redraftMembers: {
            where: { userId },
            select: { role: true },
          },
          teams: {
            where: { claimedByUserId: userId },
            select: { isCommissioner: true, isCoCommissioner: true, role: true },
          },
          rosters: {
            select: {
              id: true,
              platformUserId: true,
              playerData: true,
              faabRemaining: true,
            },
          },
        },
      })
      .catch((err: unknown) => {
        console.error('[League List] generic leagues query failed', err)
        return []
      }),
    (prisma as any).sleeperLeague
      .findMany({
        where: {
          userId,
          totalTeams: { gt: 0 },
        },
        orderBy: { lastSyncedAt: 'desc' },
        select: {
          id: true,
          name: true,
          sleeperLeagueId: true,
          totalTeams: true,
          season: true,
          status: true,
          isDynasty: true,
          scoringType: true,
          syncStatus: true,
          syncError: true,
          lastSyncedAt: true,
          createdAt: true,
          rosters: {
            select: {
              id: true,
              ownerId: true,
              rosterId: true,
              players: true,
              starters: true,
              bench: true,
              faabRemaining: true,
              waiverPriority: true,
            },
          },
        },
      })
      .catch((err: unknown) => {
        console.error('[League List] sleeper leagues query failed', err)
        return []
      }),
    prisma.legacyTournament
      .findMany({
        where: { creatorId: userId },
        orderBy: { createdAt: 'desc' },
        include: {
          leagues: { select: { leagueId: true } },
        },
      })
      .catch((err: unknown) => {
        console.error('[League List] tournament query failed', err)
        return []
      }),
  ])

  const genericLeagueIds = (genericLeagues as { id: string }[]).map((lg) => lg.id).filter(Boolean)
  const [redraftSeasonMaxRows, leagueHistoryMaxRows] =
    genericLeagueIds.length > 0
      ? await Promise.all([
          prisma.redraftSeason
            .groupBy({
              by: ['leagueId'],
              where: { leagueId: { in: genericLeagueIds } },
              _max: { season: true },
            })
            .catch((err: unknown) => {
              console.error('[League List] redraft season max query failed', err)
              return [] as { leagueId: string; _max: { season: number | null } }[]
            }),
          prisma.leagueSeason
            .groupBy({
              by: ['leagueId'],
              where: { leagueId: { in: genericLeagueIds } },
              _max: { season: true },
            })
            .catch((err: unknown) => {
              console.error('[League List] league_season max query failed', err)
              return [] as { leagueId: string; _max: { season: number | null } }[]
            }),
        ])
      : [[], []]

  const redraftMaxByLeagueId = new Map<string, number>()
  for (const row of redraftSeasonMaxRows) {
    const m = row._max.season
    if (typeof m === 'number' && Number.isFinite(m)) {
      redraftMaxByLeagueId.set(row.leagueId, m)
    }
  }
  const leagueHistoryMaxByLeagueId = new Map<string, number>()
  for (const row of leagueHistoryMaxRows) {
    const m = row._max.season
    if (typeof m === 'number' && Number.isFinite(m)) {
      leagueHistoryMaxByLeagueId.set(row.leagueId, m)
    }
  }

  const sleeperGenericSorted = genericLeagues
    .filter((lg: any) => lg.platform === 'sleeper' && typeof lg.platformLeagueId === 'string')
    .sort((a: any, b: any) => (b.season ?? 0) - (a.season ?? 0))
  const unifiedSleeperLeagueIdMap = new Map<string, string>()
  for (const lg of sleeperGenericSorted) {
    if (!unifiedSleeperLeagueIdMap.has(lg.platformLeagueId)) {
      unifiedSleeperLeagueIdMap.set(lg.platformLeagueId, lg.id)
    }
  }

  const normalizedGeneric = genericLeagues.map((lg: any) => {
    const {
      userId: leagueRowOwnerId,
      redraftMembers: viewerRedraftMembers,
      teams: viewerTeams,
      ...lgCore
    } = lg
    const rosterCount = Array.isArray(lgCore.rosters) ? lgCore.rosters.length : 0
    const teamCountForFilter =
      typeof lgCore.leagueSize === 'number' && lgCore.leagueSize > 0
        ? lgCore.leagueSize
        : rosterCount > 0
          ? rosterCount
          : 0
    const entryFee = extractEntryFeeUsd(lgCore.settings)
    const isPaid = entryFee != null && entryFee > 0
    const memberRow = Array.isArray(viewerRedraftMembers) ? viewerRedraftMembers[0] : undefined
    const myTeam = Array.isArray(viewerTeams) ? viewerTeams[0] : undefined
    const membershipRole =
      typeof memberRow?.role === 'string' ? (memberRow.role as string) : null
    const isCommissioner = resolveViewerLeagueCommissioner({
      platform: String(lgCore.platform ?? ''),
      leagueRowOwnerId: String(leagueRowOwnerId ?? ''),
      viewerUserId: userId,
      leagueIsCommissionerFlag: Boolean(lgCore.isCommissioner),
      membershipRole,
      team: myTeam ?? null,
    })
    const userRole = computeUserRole(lgCore.platform, isCommissioner)

    const seasonDisplay = resolveLeagueListSeasonYear({
      leagueSeason: lgCore.season,
      maxRedraftSeason: redraftMaxByLeagueId.get(lgCore.id) ?? null,
      maxLeagueHistorySeason: leagueHistoryMaxByLeagueId.get(lgCore.id) ?? null,
    })

    return {
      ...lgCore,
      season: seasonDisplay,
      sport_type: lgCore.sport ?? DEFAULT_SPORT,
      league_variant: lgCore.leagueVariant ?? null,
      navigationLeagueId: lgCore.id,
      unifiedLeagueId: lgCore.id,
      hasUnifiedRecord: true,
      teamCount: teamCountForFilter,
      isCommissioner,
      userRole,
      isPaid,
      entryFee: entryFee ?? null,
    }
  })

  const normalizedSleeper = sleeperLeagues
    .map((lg: any) => {
      const unifiedLeagueId = unifiedSleeperLeagueIdMap.get(lg.sleeperLeagueId) ?? null
      return {
        id: lg.id,
        name: lg.name,
        sport: DEFAULT_SPORT,
        sport_type: DEFAULT_SPORT,
        league_variant: null,
        platform: 'sleeper',
        platformLeagueId: lg.sleeperLeagueId,
        leagueSize: lg.totalTeams,
        teamCount: lg.totalTeams,
        avatarUrl: null,
        scoring: normalizeSleeperScoring(lg.scoringType),
        isDynasty: lg.isDynasty,
        syncStatus: lg.syncStatus,
        syncError: lg.syncError,
        lastSyncedAt: lg.lastSyncedAt,
        createdAt: lg.createdAt,
        season: lg.season,
        status: lg.status,
        navigationLeagueId: unifiedLeagueId,
        unifiedLeagueId,
        hasUnifiedRecord: Boolean(unifiedLeagueId),
        isCommissioner: false,
        userRole: 'imported' as const,
        isPaid: false,
        entryFee: null,
        rosters: (Array.isArray(lg.rosters) ? lg.rosters : []).map((r: any) => ({
          id: r.id,
          platformUserId: r.ownerId,
          players: r.players,
          starters: r.starters,
          bench: r.bench,
          faabRemaining: r.faabRemaining,
          waiverPriority: r.waiverPriority,
        })),
      }
    })
    .filter((lg: any) => !lg.hasUnifiedRecord)

  const normalizedTournaments = tournaments.map((t: any) => {
    const settings =
      t.settings && typeof t.settings === 'object' && !Array.isArray(t.settings)
        ? (t.settings as Record<string, unknown>)
        : {}
    const poolSize =
      typeof settings.participantPoolSize === 'number' && Number.isFinite(settings.participantPoolSize)
        ? settings.participantPoolSize
        : Math.max(12, (Array.isArray(t.leagues) ? t.leagues.length : 1) * 12)
    return {
      id: t.id,
      name: t.name,
      sport: t.sport ?? DEFAULT_SPORT,
      sport_type: t.sport ?? DEFAULT_SPORT,
      league_variant: 'tournament_hub',
      platform: 'allfantasy',
      platformLeagueId: `tournament-${t.id}`,
      leagueSize: 12,
      teamCount: poolSize,
      avatarUrl: null,
      scoring: 'Tournament',
      isDynasty: false,
      syncStatus: null,
      syncError: null,
      lastSyncedAt: t.updatedAt,
      createdAt: t.createdAt,
      season: t.season,
      status: t.status,
      navigationLeagueId: t.id,
      unifiedLeagueId: t.id,
      hasUnifiedRecord: true,
      isCommissioner: true,
      userRole: 'commissioner' as const,
      isPaid: false,
      entryFee: null,
      settings: {
        league_type: 'tournament_hub',
        tournamentId: t.id,
      },
      rosters: [],
    }
  })

  const normalizedGenericFiltered = normalizedGeneric
    .filter(isRealLeague)
    .filter((lg: any) => {
      // Filter out tournament feeder leagues from dashboard - they're accessed via tournament hub
      const settings = lg.settings && typeof lg.settings === 'object' ? lg.settings as Record<string, unknown> : {}
      return settings.league_type !== 'tournament'
    })
  const normalizedSleeperFiltered = normalizedSleeper.filter(isRealLeague)
  const normalizedTournamentFiltered = normalizedTournaments.filter(isRealLeague)
  const filtered = [...normalizedTournamentFiltered, ...normalizedGenericFiltered, ...normalizedSleeperFiltered]

  const leaguesSorted = filtered.sort((a: any, b: any) => {
    const aDate = a.lastSyncedAt ? new Date(a.lastSyncedAt).getTime() : 0
    const bDate = b.lastSyncedAt ? new Date(b.lastSyncedAt).getTime() : 0
    return bDate - aDate
  })

  if (process.env.NODE_ENV === 'development' && leaguesSorted.length === 0) {
    console.info('[getDashboardLeagueListForUser] empty dashboard league list (post-filter)', {
      userIdPrefix: userId.slice(0, 12),
      rawCounts: {
        generic: genericLeagues.length,
        sleeper: sleeperLeagues.length,
        tournaments: tournaments.length,
      },
      passedRealLeague: {
        generic: normalizedGenericFiltered.length,
        sleeper: normalizedSleeperFiltered.length,
        tournament: normalizedTournamentFiltered.length,
      },
    })
  }

  return {
    leagues: leaguesSorted,
    sleeperUserId: profile?.sleeperUserId ?? null,
  }
}
