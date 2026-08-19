import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { computeCompositeProfile, type LeagueRecord } from '@/lib/legacy/overview-scoring'
import { calculateAndSaveRank } from '@/lib/rank/calculateRank'
import { getLevelFromXp } from '@/lib/rank/levels'
import { prisma } from '@/lib/prisma'

function logFullError(context: string, err: unknown) {
  const payload =
    err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err
  console.error(context, '[api/user/rank] FULL ERROR:', JSON.stringify(payload, null, 2))
}

/** `NextResponse.json` cannot serialize BigInt — normalize Prisma bigint fields. */
function jsonSafeXp(n: bigint | number | null | undefined): number {
  if (n == null) return 0
  return typeof n === 'bigint' ? Number(n) : Number.isFinite(n) ? n : 0
}

function clampScore(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(100, Math.round(parsed)))
}

function firstInsightValue(insights: unknown): string | null {
  if (typeof insights === 'string') {
    const trimmed = insights.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  if (!Array.isArray(insights)) return null

  for (const entry of insights) {
    if (typeof entry === 'string' && entry.trim().length > 0) return entry.trim()
    if (
      entry &&
      typeof entry === 'object' &&
      'value' in entry &&
      typeof (entry as { value?: unknown }).value === 'string'
    ) {
      const value = String((entry as { value: string }).value).trim()
      if (value.length > 0) return value
    }
  }

  return null
}

function scoreToLetterGrade(score: number): string {
  if (score >= 97) return 'A+'
  if (score >= 93) return 'A'
  if (score >= 90) return 'A-'
  if (score >= 87) return 'B+'
  if (score >= 83) return 'B'
  if (score >= 80) return 'B-'
  if (score >= 77) return 'C+'
  if (score >= 73) return 'C'
  if (score >= 70) return 'C-'
  if (score >= 67) return 'D+'
  if (score >= 63) return 'D'
  if (score >= 60) return 'D-'
  return 'F'
}

function tierNullResponse() {
  return NextResponse.json({
    tier: null,
    level: null,
    levelName: null,
    tierGroup: null,
    color: null,
    bgColor: null,
    xpIntoLevel: null,
    xpForLevel: null,
    progressPct: null,
    nextLevelName: null,
    careerWins: null,
    careerLosses: null,
    careerChampionships: null,
    careerPlayoffAppearances: null,
    careerSeasonsPlayed: null,
    careerLeaguesPlayed: null,
    stats: null,
    careerStats: null,
    imported: false,
    rank: null,
    tierName: null,
    xpTotal: null,
    xpLevel: null,
    rankProcessing: false,
    rankCalculatedAt: null,
    legacyUsername: null,
    overviewProfile: null,
  })
}

/** Full 25-level payload for `/api/user/rank` (STEP 3). */
function userRankLevelPayloadFromProfile(p: ProfileRankDenormResult) {
  const xpNum = jsonSafeXp(p.xpTotal ?? p.legacyCareerXp)
  const lv = getLevelFromXp(xpNum)
  return {
    tier: lv.tier,
    level: lv.level,
    levelName: lv.name,
    tierGroup: String(lv.tierGroup),
    color: lv.color,
    bgColor: lv.bgColor,
    xpTotal: xpNum,
    /** Always align with 25-rung ladder from XP; DB `xp_level` can drift (e.g. account tier). */
    xpLevel: lv.level,
    xpIntoLevel: lv.xpIntoLevel,
    xpForLevel: lv.xpForLevel,
    progressPct: lv.progressPct,
    nextLevelName: lv.nextLevel?.name ?? null,
    careerWins: p.careerWins ?? 0,
    careerLosses: p.careerLosses ?? 0,
    careerChampionships: p.careerChampionships ?? 0,
    careerPlayoffAppearances: p.careerPlayoffAppearances ?? 0,
    careerSeasonsPlayed: p.careerSeasonsPlayed ?? 0,
    careerLeaguesPlayed: p.careerLeaguesPlayed ?? 0,
    rankCalculatedAt: p.rankCalculatedAt?.toISOString() ?? null,
  }
}

type LegacyLeagueRowForRank = {
  id: string
  season: number
  leagueType: string | null
  scoringType: string | null
  specialtyFormat: string | null
  isSF: boolean | null
  isTEP: boolean | null
  teamCount: number | null
  playoffTeams: number | null
  rosters: Array<{
    wins: number | null
    losses: number | null
    ties: number | null
    isChampion: boolean | null
    finalStanding: number | null
    playoffSeed: number | null
  }>
}

function buildLeagueRecord(league: LegacyLeagueRowForRank): LeagueRecord | null {
  const roster = league.rosters?.[0]
  if (!roster) return null

  const playoffCutoff = league.playoffTeams ?? null
  const madePlayoffs =
    roster.isChampion === true ||
    (playoffCutoff != null && roster.playoffSeed != null
      ? roster.playoffSeed <= playoffCutoff
      : playoffCutoff != null && roster.finalStanding != null
        ? roster.finalStanding <= playoffCutoff
        : false)

  return {
    league_id: `${league.season}-${league.leagueType ?? 'league'}-${league.scoringType ?? 'default'}`,
    type: league.leagueType ?? 'redraft',
    scoring: league.scoringType ?? 'standard',
    specialty_format: league.specialtyFormat ?? undefined,
    is_sf: league.isSF === true,
    is_tep: league.isTEP === true,
    team_count: league.teamCount ?? 12,
    wins: roster.wins ?? 0,
    losses: roster.losses ?? 0,
    ties: roster.ties ?? 0,
    is_champion: roster.isChampion === true,
    made_playoffs: madePlayoffs,
  }
}

export type UserRankCareerStats = {
  seasonsPlayed: number
  totalWins: number
  totalLosses: number
  championships: number
  playoffAppearances: number
  leaguesPlayed: number
}

/** Map DB denorm to API stats: DB `career_leagues_played` = distinct seasons → `seasonsPlayed`; DB `career_seasons_played` = row count → `leaguesPlayed`. */
function careerStatsFromProfileDenorm(denorm: ProfileRankDenormResult): UserRankCareerStats {
  return {
    seasonsPlayed: denorm.careerLeaguesPlayed ?? 0,
    totalWins: denorm.careerWins ?? 0,
    totalLosses: denorm.careerLosses ?? 0,
    championships: denorm.careerChampionships ?? 0,
    playoffAppearances: denorm.careerPlayoffAppearances ?? 0,
    leaguesPlayed: denorm.careerSeasonsPlayed ?? 0,
  }
}

export const dynamic = 'force-dynamic'

async function loadProfileRankFlags(userId: string): Promise<{
  rankProcessing: boolean
  rankCalculatedAtIso: string | null
}> {
  try {
    const profileRows = await prisma.$queryRaw<
      Array<{ league_import_detail_pending: boolean | null; rank_calculated_at: Date | null }>
    >`SELECT league_import_detail_pending, rank_calculated_at FROM user_profiles WHERE "userId" = ${userId} LIMIT 1`

    const profileFlags = profileRows[0]

    return {
      rankProcessing: profileFlags?.league_import_detail_pending === true,
      rankCalculatedAtIso: profileFlags?.rank_calculated_at?.toISOString() ?? null,
    }
  } catch (err: unknown) {
    console.error('[api/user/rank] userProfile flags query failed (missing columns?):', err)
    return { rankProcessing: false, rankCalculatedAtIso: null }
  }
}

/** Shape aligned with rank denorm selects + raw SQL fallback. */
export type ProfileRankDenormResult = {
  rankTier: string | null
  xpTotal: bigint | null
  xpLevel: number | null
  legacyCareerTier: number | null
  legacyCareerTierName: string | null
  legacyCareerLevel: number | null
  legacyCareerXp: bigint | null
  careerWins: number | null
  careerLosses: number | null
  careerChampionships: number | null
  careerPlayoffAppearances: number | null
  careerSeasonsPlayed: number | null
  careerLeaguesPlayed: number | null
  rankCalculatedAt: Date | null
}

/** Map raw SQL row (snake_case DB columns) to denorm shape. */
function mapRawUserProfileRankRow(row: Record<string, unknown>): ProfileRankDenormResult {
  return {
    rankTier: (row.rank_tier as string | null | undefined) ?? null,
    xpTotal: row.xp_total != null ? BigInt(String(row.xp_total)) : null,
    xpLevel: (row.xp_level as number | null | undefined) ?? null,
    legacyCareerTier: (row.legacy_career_tier as number | null | undefined) ?? null,
    legacyCareerTierName: (row.legacy_career_tier_name as string | null | undefined) ?? null,
    legacyCareerLevel: (row.legacy_career_level as number | null | undefined) ?? null,
    legacyCareerXp:
      row.legacy_career_xp != null ? BigInt(String(row.legacy_career_xp)) : null,
    careerWins: (row.career_wins as number | null | undefined) ?? null,
    careerLosses: (row.career_losses as number | null | undefined) ?? null,
    careerChampionships: (row.career_championships as number | null | undefined) ?? null,
    careerPlayoffAppearances: (row.career_playoff_appearances as number | null | undefined) ?? null,
    careerSeasonsPlayed: (row.career_seasons_played as number | null | undefined) ?? null,
    careerLeaguesPlayed: (row.career_leagues_played as number | null | undefined) ?? null,
    rankCalculatedAt: row.rank_calculated_at
      ? new Date(String(row.rank_calculated_at))
      : null,
  }
}

/** Denormalized rank on user_profiles via raw SQL to tolerate Prisma client/schema drift. */
async function loadProfileRankDenorm(userId: string): Promise<ProfileRankDenormResult | null> {
  try {
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT rank_tier, xp_total, xp_level,
             legacy_career_tier, legacy_career_tier_name, legacy_career_level, legacy_career_xp,
             career_wins, career_losses, career_championships, career_playoff_appearances,
             career_seasons_played, career_leagues_played, rank_calculated_at
      FROM user_profiles WHERE "userId" = ${userId} LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return mapRawUserProfileRankRow(row)
  } catch (err: unknown) {
    logFullError('[api/user/rank] userProfile $queryRaw rank columns failed', err)
    return null
  }
}

export async function GET(request: Request) {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id

  try {
    const url = new URL(request.url)
    const forceRecalculate = url.searchParams?.get('recalculate') === 'true'

    /** Single denorm read first (includes rank_calculated_at) — avoids a duplicate probe-only query. */
    let denormCatchup = await loadProfileRankDenorm(userId)

    const recalculateThenReload = async (context: string) => {
      try {
        await calculateAndSaveRank(userId)
      } catch (recalcErr: unknown) {
        logFullError(`[api/user/rank] calculateAndSaveRank (${context})`, recalcErr)
      }
      denormCatchup = await loadProfileRankDenorm(userId)
    }

    if (forceRecalculate || denormCatchup?.rankCalculatedAt == null) {
      await recalculateThenReload('force or missing rank_calculated_at')
    }
    if (!denormCatchup?.rankTier?.trim()) {
      await recalculateThenReload('catch-up when rank_tier still empty')
    }

    const profileFlagsPromise = loadProfileRankFlags(userId)

    let appUser:
      | {
          id: string
          legacyUserId: string | null
          username: string
          displayName: string | null
          legacyUser: { sleeperUsername: string } | null
        }
      | null = null
    try {
      appUser = await prisma.appUser.findUnique({
        where: { id: userId },
        select: {
          id: true,
          legacyUserId: true,
          username: true,
          displayName: true,
          legacyUser: {
            select: {
              sleeperUsername: true,
            },
          },
        },
      })
    } catch (e: unknown) {
      logFullError('[api/user/rank] appUser query failed; retrying without legacyUser join', e)
      appUser = await prisma.appUser
        .findUnique({
          where: { id: userId },
          select: {
            id: true,
            legacyUserId: true,
            username: true,
            displayName: true,
          },
        })
        .then((u) => (u ? { ...u, legacyUser: null } : null))
        .catch(() => null)
    }

    const profileFlags = await profileFlagsPromise

    const { rankProcessing, rankCalculatedAtIso } = profileFlags

    if (!appUser) {
      return tierNullResponse()
    }

    if (!appUser.legacyUserId) {
      const denormEarly = denormCatchup
      const tierLabelEarly = denormEarly?.rankTier?.trim()
      if (tierLabelEarly) {
        const legacyUsernameEarly =
          appUser.legacyUser?.sleeperUsername ?? appUser.displayName ?? appUser.username ?? null
        const xpNum =
          denormEarly?.xpTotal != null
            ? jsonSafeXp(denormEarly.xpTotal)
            : jsonSafeXp(
                denormEarly && 'legacyCareerXp' in denormEarly ? denormEarly.legacyCareerXp : null,
              )
        const lv = getLevelFromXp(xpNum)
        const careerStats = careerStatsFromProfileDenorm(denormEarly!)
        const rank = {
          careerTier: lv.tierGroup,
          careerTierName: lv.name,
          careerLevel: lv.level,
          careerXp: String(
            jsonSafeXp(denormEarly?.legacyCareerXp ?? denormEarly?.xpTotal),
          ),
          // Hardcoded 'B' / 70 for a user who has imported nothing. The insight
          // beside it already said "import your leagues to unlock", so the copy
          // admitted there was no data while the grade next to it did not.
          aiReportGrade: null,
          aiScore: null,
          aiInsight: 'Import your leagues to unlock your Chimmy insight.',
          // Null, not 0. A 0% win rate reads as a terrible record; it means we
          // have not seen a single game.
          winRate: null,
          playoffRate: null,
          championshipCount: careerStats.championships,
          seasonsPlayed: careerStats.seasonsPlayed,
          totalWins: careerStats.totalWins,
          totalLosses: careerStats.totalLosses,
          totalTies: 0,
          playoffAppearances: careerStats.playoffAppearances,
          importedAt: denormEarly?.rankCalculatedAt?.toISOString() ?? null,
        }
        const levelPayload = userRankLevelPayloadFromProfile(denormEarly!)
        return NextResponse.json({
          imported: true,
          ...levelPayload,
          tierName: lv.name,
          xpLevel: levelPayload.level,
          careerStats,
          stats: careerStats,
          rank,
          rankProcessing,
          rankCalculatedAt: levelPayload.rankCalculatedAt ?? rankCalculatedAtIso,
          legacyUsername: legacyUsernameEarly,
          overviewProfile: null,
        })
      }

      const legacyUsernameEarly =
        appUser.legacyUser?.sleeperUsername ?? appUser.displayName ?? appUser.username ?? null

      return NextResponse.json({
        imported: false,
        rank: null,
        tier: null,
        level: null,
        levelName: null,
        tierGroup: null,
        color: null,
        bgColor: null,
        xpTotal: null,
        xpLevel: null,
        xpIntoLevel: null,
        xpForLevel: null,
        progressPct: null,
        nextLevelName: null,
        careerWins: null,
        careerLosses: null,
        careerChampionships: null,
        careerPlayoffAppearances: null,
        careerSeasonsPlayed: null,
        careerLeaguesPlayed: null,
        tierName: null,
        careerStats: null,
        stats: null,
        rankProcessing,
        rankCalculatedAt: rankCalculatedAtIso,
        legacyUsername: legacyUsernameEarly,
        overviewProfile: null,
      })
    }

    const legacyUsername =
      appUser.legacyUser?.sleeperUsername ?? appUser.displayName ?? appUser.username ?? null

    let rankCache: Awaited<ReturnType<typeof prisma.legacyUserRankCache.findUnique>> = null
    try {
      rankCache = await prisma.legacyUserRankCache.findUnique({
        where: { legacyUserId: appUser.legacyUserId },
      })
    } catch (cacheErr: unknown) {
      logFullError('[api/user/rank] legacyUserRankCache query failed', cacheErr)
      rankCache = null
    }

    if (!rankCache) {
      const denorm = denormCatchup
      const tierLabel = denorm?.rankTier?.trim()
      if (tierLabel) {
        const xpNum =
          denorm?.xpTotal != null
            ? jsonSafeXp(denorm.xpTotal)
            : jsonSafeXp(denorm && 'legacyCareerXp' in denorm ? denorm.legacyCareerXp : null)
        const lv = getLevelFromXp(xpNum)
        const careerStats = careerStatsFromProfileDenorm(denorm!)
        const rank = {
          careerTier: lv.tierGroup,
          careerTierName: lv.name,
          careerLevel: lv.level,
          careerXp: String(jsonSafeXp(denorm?.legacyCareerXp ?? denorm?.xpTotal)),
          // Hardcoded 'B' / 70 for a user who has imported nothing. The insight
          // beside it already said "import your leagues to unlock", so the copy
          // admitted there was no data while the grade next to it did not.
          aiReportGrade: null,
          aiScore: null,
          aiInsight: 'Import your leagues to unlock your Chimmy insight.',
          // Null, not 0. A 0% win rate reads as a terrible record; it means we
          // have not seen a single game.
          winRate: null,
          playoffRate: null,
          championshipCount: careerStats.championships,
          seasonsPlayed: careerStats.seasonsPlayed,
          totalWins: careerStats.totalWins,
          totalLosses: careerStats.totalLosses,
          totalTies: 0,
          playoffAppearances: careerStats.playoffAppearances,
          importedAt: denorm?.rankCalculatedAt?.toISOString() ?? null,
        }
        const levelPayload = userRankLevelPayloadFromProfile(denorm!)
        return NextResponse.json({
          imported: true,
          ...levelPayload,
          tierName: lv.name,
          xpLevel: levelPayload.level,
          careerStats,
          stats: careerStats,
          rank,
          rankProcessing,
          rankCalculatedAt: levelPayload.rankCalculatedAt ?? rankCalculatedAtIso,
          legacyUsername,
          overviewProfile: null,
        })
      }

      return NextResponse.json({
        imported: true,
        rank: null,
        tier: null,
        level: null,
        levelName: null,
        tierGroup: null,
        color: null,
        bgColor: null,
        xpTotal: null,
        xpLevel: null,
        xpIntoLevel: null,
        xpForLevel: null,
        progressPct: null,
        nextLevelName: null,
        careerWins: null,
        careerLosses: null,
        careerChampionships: null,
        careerPlayoffAppearances: null,
        careerSeasonsPlayed: null,
        careerLeaguesPlayed: null,
        tierName: null,
        careerStats: null,
        stats: null,
        rankProcessing,
        rankCalculatedAt: rankCalculatedAtIso,
        legacyUsername,
      })
    }

    let importedLeagueRows: Array<{
      season: number
      importWins: number | null
      importLosses: number | null
      importTies: number | null
      importMadePlayoffs: boolean | null
      importWonChampionship: boolean | null
    }> = []

    try {
      const importedRows = await prisma.$queryRaw<
        Array<{
          season: number
          import_wins: number | null
          import_losses: number | null
          import_ties: number | null
          import_made_playoffs: boolean | null
          import_won_championship: boolean | null
        }>
      >`
        SELECT season, import_wins, import_losses, import_ties, import_made_playoffs, import_won_championship
        FROM leagues
        WHERE "userId" = ${userId}
          AND platform = 'sleeper'
          AND import_wins IS NOT NULL
      `

      importedLeagueRows = importedRows.map((row) => ({
        season: row.season,
        importWins: row.import_wins,
        importLosses: row.import_losses,
        importTies: row.import_ties,
        importMadePlayoffs: row.import_made_playoffs,
        importWonChampionship: row.import_won_championship,
      }))
    } catch (err: unknown) {
      console.error('[api/user/rank] imported League rows query failed (import_* columns on leagues?):', err)
      importedLeagueRows = []
    }

    let aiReport: {
      rating: number | null
      title: string | null
      summary: string | null
      insights: unknown
      shareText: string | null
    } | null = null

    let legacyLeagues: LegacyLeagueRowForRank[] = []

    try {
      const [ai, legs] = await Promise.all([
        prisma.legacyAIReport.findFirst({
          where: { userId: appUser.legacyUserId },
          orderBy: { createdAt: 'desc' },
          select: {
            rating: true,
            title: true,
            summary: true,
            insights: true,
            shareText: true,
          },
        }),
        prisma.legacyLeague.findMany({
          where: { userId: appUser.legacyUserId },
          orderBy: [{ season: 'desc' }, { updatedAt: 'desc' }],
          select: {
            id: true,
            season: true,
            leagueType: true,
            scoringType: true,
            specialtyFormat: true,
            isSF: true,
            isTEP: true,
            teamCount: true,
            playoffTeams: true,
            rosters: {
              where: { isOwner: true },
              take: 1,
              select: {
                wins: true,
                losses: true,
                ties: true,
                isChampion: true,
                finalStanding: true,
                playoffSeed: true,
              },
            },
          },
        }),
      ])
      aiReport = ai
      legacyLeagues = legs
    } catch (err: unknown) {
      console.error('[api/user/rank] legacy AI report / legacy leagues query failed:', err)
    }

    const leagueRecords =
      legacyLeagues
        ?.map(buildLeagueRecord)
        .filter((record): record is LeagueRecord => record != null) ?? []

    const totalWins = leagueRecords.reduce((sum, league) => sum + league.wins, 0)
    const totalLosses = leagueRecords.reduce((sum, league) => sum + league.losses, 0)
    const totalTies = leagueRecords.reduce((sum, league) => sum + (league.ties ?? 0), 0)
    const totalGames = totalWins + totalLosses + totalTies
    const seasonsPlayedLegacy = new Set((legacyLeagues ?? []).map((league) => league.season)).size
    const championshipCount = leagueRecords.filter((league) => league.is_champion).length
    const playoffCount = leagueRecords.filter((league) => league.made_playoffs).length
    const winRate = totalGames > 0 ? (totalWins / totalGames) * 100 : 0
    const playoffRate = leagueRecords.length > 0 ? (playoffCount / leagueRecords.length) * 100 : 0
    // No report means NO grade. legacy_ai_reports has 0 rows and nothing in the
    // codebase writes it, so `clampScore(aiReport?.rating, 70)` handed every
    // single user a score of 70 — and scoreToLetterGrade(70) is "C-", rendered on
    // a grade ring as if it had been earned. A letter grade about someone's
    // fantasy career, computed from a table that has never held a row.
    //
    // AIGradeRing already accepts a null score and renders an empty ring, so the
    // honest value costs nothing at the UI.
    const aiScore = aiReport?.rating != null ? clampScore(aiReport.rating, 0) : null
    const aiInsight =
      aiReport?.summary?.trim() ||
      firstInsightValue(aiReport?.insights) ||
      aiReport?.title?.trim() ||
      aiReport?.shareText?.trim() ||
      'Import your leagues to unlock your Chimmy insight.'

    let careerStats: UserRankCareerStats
    if (importedLeagueRows.length > 0) {
      const seasonsPlayed = new Set(importedLeagueRows.map((r) => r.season)).size
      careerStats = {
        seasonsPlayed,
        totalWins: importedLeagueRows.reduce((s, r) => s + (r.importWins ?? 0), 0),
        totalLosses: importedLeagueRows.reduce((s, r) => s + (r.importLosses ?? 0), 0),
        championships: importedLeagueRows.filter((r) => r.importWonChampionship === true).length,
        playoffAppearances: importedLeagueRows.filter((r) => r.importMadePlayoffs === true).length,
        leaguesPlayed: importedLeagueRows.length,
      }
    } else {
      careerStats = {
        seasonsPlayed: seasonsPlayedLegacy,
        totalWins,
        totalLosses,
        championships: championshipCount,
        playoffAppearances: playoffCount,
        leaguesPlayed: leagueRecords.length,
      }
    }

    const d = denormCatchup
    // Quarantine fix (audit finding: dormant secondary ranking engine): `calculateAndSaveRank`
    // — the single canonical XP engine — merges Sleeper imports, legacy Sleeper history, AND
    // native AF leagues, so `d.xpTotal` is the real total for ANY user it has run for, not
    // just imported-league users. This used to gate on `importedLeagueRows.length > 0` first,
    // which meant a legacy-only user (real canonical XP available, just no Sleeper import_*
    // rows) still silently fell through to `legacyUserRankCache` — a dormant, differently-
    // weighted engine (win=50/playoff=200/championship=500 vs the canonical win=10/
    // playoff=30/championship=200) that can be 5-10x off. Canonical XP now wins whenever it
    // exists; the legacy cache is a true last-resort only when calculateAndSaveRank has
    // genuinely never run for this user.
    const careerXpBig =
      d?.xpTotal != null
        ? BigInt(jsonSafeXp(d.xpTotal))
        : rankCache?.careerXp ?? 0n
    const xpTotalNum = Number(careerXpBig)
    const lv = getLevelFromXp(xpTotalNum)
    const tier = lv.tier
    const tierName = lv.name

    const importedTiesSum =
      importedLeagueRows.length > 0
        ? importedLeagueRows.reduce((s, r) => s + (r.importTies ?? 0), 0)
        : 0
    const displayTies = importedLeagueRows.length > 0 ? importedTiesSum : totalTies
    const gamesForImported =
      importedLeagueRows.length > 0
        ? careerStats.totalWins + careerStats.totalLosses + importedTiesSum
        : totalGames
    const winRateForDisplay =
      importedLeagueRows.length > 0
        ? gamesForImported > 0
          ? (careerStats.totalWins / gamesForImported) * 100
          : 0
        : winRate
    const playoffRateForDisplay =
      importedLeagueRows.length > 0
        ? (careerStats.playoffAppearances / importedLeagueRows.length) * 100
        : playoffRate

    const rank = {
      careerTier: lv.tierGroup,
      careerTierName: lv.name,
      careerLevel: lv.level,
      careerXp: String(jsonSafeXp(careerXpBig)),
      aiReportGrade: aiScore != null ? scoreToLetterGrade(aiScore) : null,
      aiScore,
      aiInsight,
      winRate: Math.round(winRateForDisplay * 10) / 10,
      playoffRate: Math.round(playoffRateForDisplay * 10) / 10,
      // Branch-aware, matching careerStats.championships used everywhere else in this file
      // (lines 390/481) — this used to read the raw legacy-table-only `championshipCount`
      // regardless of whether the user's real championship data actually came from Sleeper
      // imports, so a user with both import and legacy history could see two different
      // championship counts depending on which response branch/UI surface read them.
      championshipCount: careerStats.championships,
      seasonsPlayed: careerStats.seasonsPlayed,
      totalWins: careerStats.totalWins,
      totalLosses: careerStats.totalLosses,
      totalTies: displayTies,
      playoffAppearances: careerStats.playoffAppearances,
      importedAt:
        importedLeagueRows.length > 0 && d?.rankCalculatedAt
          ? d.rankCalculatedAt.toISOString()
          : rankCache.lastCalculatedAt?.toISOString() ?? null,
    }

    let overviewProfile: ReturnType<typeof computeCompositeProfile> | null = null
    if (leagueRecords.length > 0) {
      try {
        overviewProfile = computeCompositeProfile(leagueRecords)
      } catch (err: unknown) {
        console.error('[api/user/rank] computeCompositeProfile failed:', err)
        overviewProfile = null
      }
    }

    const levelPayload = {
      tier,
      level: lv.level,
      levelName: lv.name,
      tierGroup: lv.tierGroup,
      color: lv.color,
      bgColor: lv.bgColor,
      xpTotal: xpTotalNum,
      xpIntoLevel: lv.xpIntoLevel,
      xpForLevel: lv.xpForLevel,
      progressPct: lv.progressPct,
      nextLevelName: lv.nextLevel?.name ?? null,
      careerWins: d?.careerWins ?? careerStats.totalWins,
      careerLosses: d?.careerLosses ?? careerStats.totalLosses,
      careerChampionships: d?.careerChampionships ?? careerStats.championships,
      careerPlayoffAppearances: d?.careerPlayoffAppearances ?? careerStats.playoffAppearances,
      // Same DB-to-API un-swap as careerStatsFromProfileDenorm above: `career_leagues_played`
      // holds the distinct-season count, `career_seasons_played` holds the league-row count.
      // This block used to read the raw (swapped) DB fields straight through, so these two
      // top-level response keys — the ones CareerProgressionStrip actually renders — were
      // inverted even though the corrected values already existed in `careerStats`/`stats`.
      careerSeasonsPlayed: d?.careerLeaguesPlayed ?? careerStats.seasonsPlayed,
      careerLeaguesPlayed: d?.careerSeasonsPlayed ?? careerStats.leaguesPlayed,
      rankCalculatedAt: d?.rankCalculatedAt?.toISOString() ?? rankCalculatedAtIso,
    }

    return NextResponse.json({
      imported: true,
      ...levelPayload,
      tierName,
      xpLevel: levelPayload.level,
      careerStats,
      stats: careerStats,
      rank,
      rankProcessing,
      rankCalculatedAt: levelPayload.rankCalculatedAt,
      legacyUsername,
      overviewProfile,
    })
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error('[rank]', err.message, err.stack)
    } else {
      console.error('[rank]', err)
    }
    return tierNullResponse()
  }
}

