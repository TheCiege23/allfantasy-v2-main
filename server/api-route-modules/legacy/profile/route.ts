import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { computeLegacyRankPreview } from '@/lib/ranking/computeLegacyRank'
import { trackLegacyToolUsage } from '@/lib/analytics-server'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function recordString(w: number, l: number, t: number): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export const GET = withApiUsage({ endpoint: "/api/legacy/profile", tool: "LegacyProfile" })(async (request: NextRequest) => {
  /*
   * Guest-usable: this is the one legacy route the guest dashboard (/dashboard/universal)
   * reads after `guest-import`, and guests have no NextAuth session — `guest-import`
   * creates LegacyUser rows with no AppUser. The signed `af_guest_session` JWT carries its
   * own legacyUserId + sleeperUsername, so accepting it is a real binding, not a claim.
   *
   * The `?sleeper_username=` query param is no longer trusted to select data; it is only
   * compared against the caller's own identity so a stale client 403s loudly.
   */
  const gate = await requireLegacySleeperIdentity(request, {
    allowGuest: true,
    requestedUsername: request.nextUrl.searchParams?.get('sleeper_username')?.trim() ?? null,
    rateLimit: { action: 'profile', maxRequests: 30, windowMs: 60_000 },
  })
  if (!gate.ok) return gate.response

  const uname = gate.identity.sleeperUsername.toLowerCase()

  const legacyUser = await prisma.legacyUser.findFirst({
    where: { sleeperUsername: uname },
    select: {
      id: true,
      sleeperUsername: true,
      sleeperUserId: true,
      displayName: true,
      avatar: true,
    },
  })

  if (!legacyUser) {
    return NextResponse.json({ error: 'Legacy user not found. Run import first.' }, { status: 404 })
  }

  const [latestJob, latestReport, leagues, cachedRank] = await Promise.all([
    prisma.legacyImportJob.findFirst({
      where: { userId: legacyUser.id },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.legacyAIReport.findFirst({
      where: { userId: legacyUser.id },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.legacyLeague.findMany({
      where: { userId: legacyUser.id },
      orderBy: [{ season: 'desc' }, { name: 'asc' }],
      include: {
        seasonSummary: true,
        rosters: {
          where: {
            OR: [
              { ownerId: legacyUser.sleeperUserId },
              { isOwner: true },
            ],
          },
        },
      },
    }),
    prisma.$queryRaw<any[]>`
      SELECT
        career_xp, career_level, career_tier, career_tier_name,
        baseline_year_xp, ai_low_year_xp, ai_mid_year_xp, ai_high_year_xp,
        assumptions_json,
        last_calculated_at, last_refresh_at
      FROM legacy_user_rank_cache
      WHERE legacy_user_id = ${legacyUser.id}
      LIMIT 1
    `,
  ])

  const myRosterByLeagueId = new Map<string, any>()

  for (const lg of leagues as any[]) {
    const candidates = lg.rosters ?? []

    const byOwnerId =
      candidates.find((r: any) => r.ownerId != null && String(r.ownerId) === String(legacyUser.sleeperUserId)) ?? null

    const byIsOwner =
      candidates.find((r: any) => r.isOwner === true) ?? null

    const myRoster = byOwnerId ?? byIsOwner

    if (myRoster) myRosterByLeagueId.set(lg.id, myRoster)
  }

  const myRosters = Array.from(myRosterByLeagueId.values())

  // Separate standard leagues from specialty leagues (guillotine, bestball, etc.)
  const standardLeagues = (leagues as any[]).filter(lg => !lg.specialtyFormat || lg.specialtyFormat === 'standard')
  const specialtyLeagues = (leagues as any[]).filter(lg => lg.specialtyFormat && lg.specialtyFormat !== 'standard')
  
  // Get rosters for standard leagues only
  const standardRosters = standardLeagues
    .map(lg => myRosterByLeagueId.get(lg.id))
    .filter(Boolean)
  
  // Get rosters for specialty leagues
  const specialtyRosters = specialtyLeagues
    .map(lg => myRosterByLeagueId.get(lg.id))
    .filter(Boolean)

  // Standard league stats (used for grading)
  const standardTotalWins = standardRosters.reduce((s, r) => s + safeNum(r.wins), 0)
  const standardTotalLosses = standardRosters.reduce((s, r) => s + safeNum(r.losses), 0)
  const standardTotalTies = standardRosters.reduce((s, r) => s + safeNum(r.ties), 0)
  const standardTotalPointsFor = standardRosters.reduce((s, r) => s + safeNum(r.pointsFor), 0)
  
  // Specialty league stats (separated)
  const specialtyTotalWins = specialtyRosters.reduce((s, r) => s + safeNum(r.wins), 0)
  const specialtyTotalLosses = specialtyRosters.reduce((s, r) => s + safeNum(r.losses), 0)
  const specialtyTotalTies = specialtyRosters.reduce((s, r) => s + safeNum(r.ties), 0)
  const specialtyTotalPointsFor = specialtyRosters.reduce((s, r) => s + safeNum(r.pointsFor), 0)
  
  // Combined stats (for display)
  const seasonsPlayed = new Set((leagues as any[]).map(lg => lg.season)).size || 1
  const totalWins = myRosters.reduce((s, r) => s + safeNum(r.wins), 0)
  const totalLosses = myRosters.reduce((s, r) => s + safeNum(r.losses), 0)
  const totalTies = myRosters.reduce((s, r) => s + safeNum(r.ties), 0)
  const totalPointsFor = myRosters.reduce((s, r) => s + safeNum(r.pointsFor), 0)

  const championships = (leagues as any[]).reduce((s, lg) => {
    const r = myRosterByLeagueId.get(lg.id)
    if (!r) return s

    const fallbackChampion =
      lg.winnerRosterId != null && safeNum(lg.winnerRosterId) === safeNum(r.rosterId)

    return s + ((r.isChampion || fallbackChampion) ? 1 : 0)
  }, 0)
  
  // Standard leagues championships only (for grading)
  const standardChampionships = standardLeagues.reduce((s, lg) => {
    const r = myRosterByLeagueId.get(lg.id)
    if (!r) return s
    const fallbackChampion = lg.winnerRosterId != null && safeNum(lg.winnerRosterId) === safeNum(r.rosterId)
    return s + ((r.isChampion || fallbackChampion) ? 1 : 0)
  }, 0)
  
  // Specialty leagues championships
  const specialtyChampionships = specialtyLeagues.reduce((s, lg) => {
    const r = myRosterByLeagueId.get(lg.id)
    if (!r) return s
    const fallbackChampion = lg.winnerRosterId != null && safeNum(lg.winnerRosterId) === safeNum(r.rosterId)
    return s + ((r.isChampion || fallbackChampion) ? 1 : 0)
  }, 0)

  const seasonBreakdown: Record<
    number,
    {
      leagues: number
      wins: number
      losses: number
      ties: number
      championships: number
      playoffs: number
      pointsFor: number
    }
  > = {}

  for (const lg of leagues as any[]) {
    const season = lg.season
    if (!seasonBreakdown[season]) {
      seasonBreakdown[season] = {
        leagues: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        championships: 0,
        playoffs: 0,
        pointsFor: 0,
      }
    }

    const r = myRosterByLeagueId.get(lg.id)
    if (!r) continue

    seasonBreakdown[season].leagues++
    seasonBreakdown[season].wins += safeNum(r.wins)
    seasonBreakdown[season].losses += safeNum(r.losses)
    seasonBreakdown[season].ties += safeNum(r.ties)
    seasonBreakdown[season].pointsFor += safeNum(r.pointsFor)

    if (r.playoffSeed != null) seasonBreakdown[season].playoffs++

    const fallbackChampion =
      lg.winnerRosterId != null && safeNum(lg.winnerRosterId) === safeNum(r.rosterId)
    if (r.isChampion || fallbackChampion) seasonBreakdown[season].championships++
  }

  const season_breakdown = Object.entries(seasonBreakdown)
    .map(([seasonStr, data]) => ({
      season: parseInt(seasonStr, 10),
      leagues: data.leagues,
      wins: data.wins,
      losses: data.losses,
      ties: data.ties,
      record: recordString(data.wins, data.losses, data.ties),
      championships: data.championships,
      playoffs: data.playoffs,
      points_for: round2(data.pointsFor),
    }))
    .sort((a, b) => b.season - a.season)

  const league_history = (leagues as any[]).map((lg) => {
    const r = myRosterByLeagueId.get(lg.id)

    const wins = safeNum(r?.wins, 0)
    const losses = safeNum(r?.losses, 0)
    const ties = safeNum(r?.ties, 0)

    const fallbackChampion =
      r && lg.winnerRosterId != null && safeNum(lg.winnerRosterId) === safeNum(r.rosterId)
    const isChampion = !!r?.isChampion || !!fallbackChampion

    const playoffTeams = safeNum((lg as any).playoffTeams, 0)
    const finalStanding = r?.finalStanding != null ? safeNum(r.finalStanding, 0) : null
    const playoffSeed = r?.playoffSeed != null ? safeNum(r.playoffSeed, 0) : null

    const madePlayoffs =
      (playoffSeed != null && playoffSeed > 0) ||
      isChampion ||
      (playoffTeams > 0 && finalStanding != null && finalStanding > 0 && finalStanding <= playoffTeams)

    const playersJson = r?.players as any
    const starters = Array.isArray(playersJson?.starters) ? playersJson.starters : []
    const bench = Array.isArray(playersJson?.bench) 
      ? playersJson.bench 
      : Array.isArray(playersJson?.players)
        ? playersJson.players.filter((p: string) => !starters.includes(p) && !playersJson?.reserve?.includes(p) && !playersJson?.ir?.includes(p) && !playersJson?.taxi?.includes(p))
        : []
    const reserve = Array.isArray(playersJson?.ir) ? playersJson.ir : Array.isArray(playersJson?.reserve) ? playersJson.reserve : []
    const taxi = Array.isArray(playersJson?.taxi) ? playersJson.taxi : []
    const draftPicks = Array.isArray(playersJson?.draftPicks) ? playersJson.draftPicks : []

    return {
      league_id: lg.sleeperLeagueId,
      name: lg.name,
      season: lg.season,
      sport: lg.sport,
      type: lg.leagueType,
      scoring: lg.scoringType,
      specialty_format: lg.specialtyFormat || 'standard',
      is_sf: lg.isSF || false,
      is_tep: lg.isTEP || false,
      tep_bonus: lg.tepBonus || null,
      team_count: lg.teamCount,
      status: lg.status,
      avatar: (lg as any).avatar || null,

      record: recordString(wins, losses, ties),
      wins,
      losses,
      ties,

      points_for: round2(safeNum(r?.pointsFor, 0)),
      points_against: round2(safeNum(r?.pointsAgainst, 0)),

      playoff_seed: r?.playoffSeed ?? null,
      final_standing: r?.finalStanding ?? null,
      made_playoffs: madePlayoffs,

      is_champion: isChampion,
      winner_roster_id: lg.winnerRosterId ?? null,
      champion_name: lg.seasonSummary?.championName ?? null,

      roster: {
        starters,
        bench,
        reserve,
        taxi,
        draftPicks,
      },
    }
  })

  const leaguesPlayed = myRosters.length

  const playoffAppearances = league_history.reduce((s, lg) => s + (lg.made_playoffs ? 1 : 0), 0)
  const leaguesPlayedForPct = league_history.length
  const playoffPercentage =
    leaguesPlayedForPct > 0 ? Math.round((playoffAppearances / leaguesPlayedForPct) * 1000) / 10 : 0

  const win_percentage =
    totalWins + totalLosses > 0
      ? Math.round((totalWins / (totalWins + totalLosses)) * 1000) / 10
      : 0
  
  // Standard leagues playoff stats (for grading)
  const standardPlayoffAppearances = league_history
    .filter((lg: any) => lg.specialty_format === 'standard')
    .reduce((s: number, lg: any) => s + (lg.made_playoffs ? 1 : 0), 0)
  const standardLeaguesPlayed = standardRosters.length
  const standardWinPercentage = standardTotalWins + standardTotalLosses > 0
    ? Math.round((standardTotalWins / (standardTotalWins + standardTotalLosses)) * 1000) / 10
    : 0
  const standardPlayoffPercentage = standardLeaguesPlayed > 0
    ? Math.round((standardPlayoffAppearances / standardLeaguesPlayed) * 1000) / 10
    : 0
  
  // Specialty leagues playoff stats
  const specialtyPlayoffAppearances = league_history
    .filter((lg: any) => lg.specialty_format !== 'standard')
    .reduce((s: number, lg: any) => s + (lg.made_playoffs ? 1 : 0), 0)
  const specialtyLeaguesPlayed = specialtyRosters.length
  const specialtyWinPercentage = specialtyTotalWins + specialtyTotalLosses > 0
    ? Math.round((specialtyTotalWins / (specialtyTotalWins + specialtyTotalLosses)) * 1000) / 10
    : 0

  let ranking_preview: any = null
  const cached = cachedRank?.[0] ?? null
  if (cached) {
    const lastCalculated = cached.last_calculated_at ? new Date(cached.last_calculated_at).getTime() : 0
    const importCompleted = latestJob?.completedAt ? new Date(latestJob.completedAt).getTime() : 0
    const isStale = importCompleted > 0 && lastCalculated > 0 && importCompleted > lastCalculated

    ranking_preview = {
      career: {
        xp: Number(cached.career_xp || 0),
        level: Number(cached.career_level || 0),
        tier: Number(cached.career_tier || 1),
        tier_name: String(cached.career_tier_name || "Practice Squad"),
      },
      yearly_projection: {
        baseline_year_xp: Number(cached.baseline_year_xp || 0),
        baseline_year_levels: Math.floor(Number(cached.baseline_year_xp || 0) / 500),
        ai_low_year_xp: Number(cached.ai_low_year_xp || 0),
        ai_mid_year_xp: Number(cached.ai_mid_year_xp || 0),
        ai_high_year_xp: Number(cached.ai_high_year_xp || 0),
        assumptions: cached.assumptions_json || {},
      },
      cache: {
        last_calculated_at: cached.last_calculated_at,
        last_refresh_at: cached.last_refresh_at,
        stale: isStale,
      },
    }
  } else {
    const compactLeagueHistory = league_history.map((lg: any) => ({
      season: lg.season,
      sport: lg.sport,
      type: lg.type,
      scoring: lg.scoring,
      team_count: lg.team_count,
      wins: lg.wins,
      losses: lg.losses,
      ties: lg.ties,
      made_playoffs: !!lg.made_playoffs,
      is_champion: !!lg.is_champion,
    }))

    const preview = computeLegacyRankPreview({
      totals: {
        seasons_imported: seasonsPlayed,
        leagues_played: leaguesPlayed,
        wins: totalWins,
        playoffs: playoffAppearances,
        championships,
      },
      leagueHistory: compactLeagueHistory as any,
    })

    ranking_preview = preview

    await prisma.$executeRaw`
      INSERT INTO legacy_user_rank_cache (
        legacy_user_id,
        career_xp, career_level, career_tier, career_tier_name,
        baseline_year_xp, ai_low_year_xp, ai_mid_year_xp, ai_high_year_xp,
        assumptions_json,
        last_calculated_at
      )
      VALUES (
        ${legacyUser.id},
        ${preview.career.xp}, ${preview.career.level}, ${preview.career.tier}, ${preview.career.tier_name},
        ${preview.yearly_projection.baseline_year_xp},
        ${preview.yearly_projection.ai_low_year_xp},
        ${preview.yearly_projection.ai_mid_year_xp},
        ${preview.yearly_projection.ai_high_year_xp},
        ${JSON.stringify(preview.yearly_projection.assumptions)}::jsonb,
        now()
      )
      ON CONFLICT (legacy_user_id)
      DO NOTHING
    `
  }

  // Track tool usage
  trackLegacyToolUsage('legacy_profile', legacyUser.id)

  return NextResponse.json({
    profile: {
      sleeper_username: legacyUser.sleeperUsername,
      sleeper_user_id: legacyUser.sleeperUserId,
      display_name: legacyUser.displayName,
      avatar: legacyUser.avatar,

      ai_rating: latestReport?.rating ?? null,
      ai_title: latestReport?.title ?? null,
    },

    ranking_preview,

    stats: {
      seasons_imported: seasonsPlayed,
      leagues_played: leaguesPlayed,

      wins: totalWins,
      losses: totalLosses,
      ties: totalTies,
      record: recordString(totalWins, totalLosses, totalTies),
      win_percentage,

      playoffs: playoffAppearances,
      playoff_percentage: playoffPercentage,
      championships,
      total_points_for: round2(totalPointsFor),

      seasons: seasonsPlayed,
      leagues: leaguesPlayed,
      total_points: round2(totalPointsFor),
    },
    
    // Standard leagues stats (used for AI grading - excludes guillotine, bestball, etc.)
    standard_stats: {
      leagues_played: standardLeaguesPlayed,
      wins: standardTotalWins,
      losses: standardTotalLosses,
      ties: standardTotalTies,
      record: recordString(standardTotalWins, standardTotalLosses, standardTotalTies),
      win_percentage: standardWinPercentage,
      playoffs: standardPlayoffAppearances,
      playoff_percentage: standardPlayoffPercentage,
      championships: standardChampionships,
      total_points_for: round2(standardTotalPointsFor),
    },
    
    // Specialty leagues stats (guillotine, bestball, survivor, etc.)
    specialty_stats: specialtyLeaguesPlayed > 0 ? {
      leagues_played: specialtyLeaguesPlayed,
      wins: specialtyTotalWins,
      losses: specialtyTotalLosses,
      ties: specialtyTotalTies,
      record: recordString(specialtyTotalWins, specialtyTotalLosses, specialtyTotalTies),
      win_percentage: specialtyWinPercentage,
      playoffs: specialtyPlayoffAppearances,
      championships: specialtyChampionships,
      total_points_for: round2(specialtyTotalPointsFor),
      // Group by format type
      by_format: (() => {
        const formats: Record<string, { count: number; wins: number; losses: number; ties: number }> = {}
        for (const lg of specialtyLeagues) {
          const fmt = lg.specialtyFormat || 'other'
          if (!formats[fmt]) formats[fmt] = { count: 0, wins: 0, losses: 0, ties: 0 }
          const r = myRosterByLeagueId.get(lg.id)
          if (r) {
            formats[fmt].count++
            formats[fmt].wins += safeNum(r.wins)
            formats[fmt].losses += safeNum(r.losses)
            formats[fmt].ties += safeNum(r.ties)
          }
        }
        return formats
      })(),
    } : null,

    season_breakdown,
    league_history,

    latest_ai_report: latestReport
      ? {
          rating: latestReport.rating,
          title: latestReport.title,
          summary: latestReport.summary,
          insights: latestReport.insights,
          share_text: latestReport.shareText,
          created_at: latestReport.createdAt,
        }
      : null,

    last_import: latestJob
      ? {
          status: latestJob.status,
          progress: latestJob.progress,
          error: latestJob.error,
          completed_at: latestJob.completedAt,
          message: (latestJob as any).message ?? null,
        }
      : null,
  })
})

