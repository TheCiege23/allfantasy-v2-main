import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { calculateAndSaveRank } from '@/lib/rank/calculateRank'

import { sendImportCompleteNotification } from '@/lib/import/sendImportNotification'
import { sleeperApiSportToLeagueSport } from '@/lib/import/sleeperApiSportToLeagueSport'
import { SLEEPER_IMPORT_SPORTS } from '@/lib/league-import/sleeper/import-sports'
import { getLeagueRosters, getUserLeagues } from '@/lib/sleeper-client'

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Tighter pacing than original — user asked for faster imports. */
const SLEEP_BETWEEN_SPORTS_MS = 80
const SLEEP_BETWEEN_SEASONS_MS = 150

type SeasonSummaryRow = {
  season: number
  leagues: number
  wins: number
  losses: number
  championships: number
  xp: number
  level?: number | null
}

function parseSeasonsSummary(raw: unknown): SeasonSummaryRow[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((r): r is SeasonSummaryRow => r != null && typeof r === 'object' && 'season' in r) as SeasonSummaryRow[]
}

/**
 * Import a single season year (all Sleeper API sports). Updates `LegacyImportJob` totals from DB
 * so chunked serverless steps stay consistent.
 */
export async function importLegacySeasonAtIndex(
  jobId: string,
  userId: string,
  sleeperUserId: string,
  seasons: number[],
  seasonIndex: number,
): Promise<void> {
  const i = seasonIndex
  if (i < 0 || i >= seasons.length) return

  const jobRow = await prisma.legacyImportJob.findUnique({ where: { id: jobId } })
  if (!jobRow) throw new Error('LegacyImportJob not found')

  let totalLeaguesSaved = jobRow.totalLeaguesSaved ?? 0
  const seasonsSummary = parseSeasonsSummary(jobRow.seasonsSummary)

  const season = seasons[i]!
  const progressDuring =
    seasons.length > 0 ? Math.min(99, Math.round(((i + 0.5) / seasons.length) * 100)) : 0

  await prisma.legacyImportJob.update({
    where: { id: jobId },
    data: {
      status: 'running',
      progress: Math.max(1, progressDuring),
      currentSeason: season,
      seasonsCompleted: i,
    },
  })

  await prisma.importJobSeason.upsert({
    where: { jobId_season: { jobId, season } },
    update: { status: 'processing', startedAt: new Date() },
    create: { jobId, season, status: 'processing', startedAt: new Date() },
  })

  try {
    let sw = 0
    let sl = 0
    let sc = 0
    let sp = 0
    let saved = 0

    for (const sleeperSport of SLEEPER_IMPORT_SPORTS) {
      const leagueSportEnum = sleeperApiSportToLeagueSport(sleeperSport)
      const sleeperLeagues: unknown = await getUserLeagues(sleeperUserId, sleeperSport, String(season)).catch(
        () => [] as unknown,
      )
      if (!Array.isArray(sleeperLeagues) || sleeperLeagues.length === 0) {
        await sleep(SLEEP_BETWEEN_SPORTS_MS)
        continue
      }

      for (const league of sleeperLeagues as Array<{
        league_id?: string
        name?: string
        total_rosters?: number
        settings?: { playoff_teams?: number; num_teams?: number }
      }>) {
        try {
          const rosters: unknown = await getLeagueRosters(String(league.league_id)).catch(() => [] as unknown)
          const mine = Array.isArray(rosters)
            ? rosters.find((r: { owner_id?: string; co_owners?: string[]; settings?: Record<string, unknown> }) => {
                const oid = r?.owner_id != null ? String(r.owner_id) : ''
                const co = Array.isArray(r?.co_owners) ? r.co_owners.map(String) : []
                return oid === sleeperUserId || co.includes(sleeperUserId)
              })
            : null

          const totalTeams =
            typeof league.total_rosters === 'number' && league.total_rosters >= 1
              ? league.total_rosters
              : typeof league.settings?.num_teams === 'number' && league.settings.num_teams >= 1
                ? league.settings.num_teams
                : 12
          const playoffTeams =
            typeof league.settings?.playoff_teams === 'number' && league.settings.playoff_teams >= 1
              ? league.settings.playoff_teams
              : Math.max(1, Math.ceil(totalTeams / 3))

          const settings = (mine?.settings ?? {}) as Record<string, unknown>
          const finalStandingRaw = settings.final_standing ?? settings.rank
          const finalStanding =
            typeof finalStandingRaw === 'number' && Number.isFinite(finalStandingRaw)
              ? finalStandingRaw
              : finalStandingRaw != null
                ? parseInt(String(finalStandingRaw), 10)
                : null
          const wins = typeof settings.wins === 'number' ? settings.wins : Number(settings.wins ?? 0) || 0
          const losses = typeof settings.losses === 'number' ? settings.losses : Number(settings.losses ?? 0) || 0
          const ties = typeof settings.ties === 'number' ? settings.ties : Number(settings.ties ?? 0) || 0
          const madePlayoffs =
            finalStanding != null && Number.isFinite(finalStanding) ? finalStanding <= playoffTeams : false
          const wonChampionship = finalStanding === 1

          const platformLeagueId = String(league.league_id ?? '')
          const fpts =
            typeof settings.fpts === 'number'
              ? settings.fpts
              : typeof settings.fpts_decimal === 'number'
                ? settings.fpts_decimal
                : null

          await prisma.league.upsert({
            where: {
              userId_platform_platformLeagueId_season: {
                userId,
                platform: 'sleeper',
                platformLeagueId,
                season,
              },
            },
            update: {
              name: league.name ?? 'Unnamed League',
              leagueSize: totalTeams,
              sport: leagueSportEnum,
              importWins: wins,
              importLosses: losses,
              importTies: ties,
              importMadePlayoffs: madePlayoffs,
              importWonChampionship: wonChampionship,
              importFinalStanding: finalStanding,
              importPointsFor: fpts,
              // Only tag as legacy_summary if this league has no real-import status
              // (real active-league imports always set status from the Sleeper API)
            },
            create: {
              userId,
              platform: 'sleeper',
              platformLeagueId,
              name: league.name ?? 'Unnamed League',
              season,
              leagueSize: totalTeams,
              sport: leagueSportEnum,
              // Tag new ranking-import leagues so they are excluded from My Leagues
              leagueVariant: 'legacy_summary',
              importWins: wins,
              importLosses: losses,
              importTies: ties,
              importMadePlayoffs: madePlayoffs,
              importWonChampionship: wonChampionship,
              importFinalStanding: finalStanding,
              importPointsFor: fpts,
            },
          })

          sw += wins
          sl += losses
          if (wonChampionship) sc++
          if (madePlayoffs) sp++
          saved++
          totalLeaguesSaved++
        } catch (e: unknown) {
          console.error(`[import] league ${String(league.league_id)}:`, e)
        }
      }

      await sleep(SLEEP_BETWEEN_SPORTS_MS)
    }

    if (saved === 0) {
      await prisma.importJobSeason.update({
        where: { jobId_season: { jobId, season } },
        data: { status: 'empty', completedAt: new Date() },
      })
      await prisma.legacyImportJob.update({
        where: { id: jobId },
        data: {
          seasonsCompleted: i + 1,
          progress: seasons.length > 0 ? Math.round(((i + 1) / seasons.length) * 100) : 100,
        },
      })
      await sleep(SLEEP_BETWEEN_SEASONS_MS)
      return
    }

    const rankResult = await calculateAndSaveRank(userId)
    const xpNow = rankResult?.xpTotal ?? 0

    await prisma.importJobSeason.update({
      where: { jobId_season: { jobId, season } },
      data: {
        status: 'complete',
        leagueCount: saved,
        wins: sw,
        losses: sl,
        championships: sc,
        playoffApps: sp,
        xpEarned: xpNow,
        rankAfter: rankResult?.rankTier ?? null,
        levelAfter: rankResult?.xpLevel ?? null,
        completedAt: new Date(),
      },
    })

    seasonsSummary.push({
      season,
      leagues: saved,
      wins: sw,
      losses: sl,
      championships: sc,
      xp: xpNow,
      level: rankResult?.xpLevel,
    })

    await prisma.legacyImportJob.update({
      where: { id: jobId },
      data: {
        totalLeaguesSaved,
        seasonsCompleted: i + 1,
        currentSeasonLeagues: saved,
        lastRankTier: rankResult?.rankTier ?? null,
        lastRankLevel: rankResult?.xpLevel ?? null,
        lastXpTotal: xpNow,
        seasonsSummary: seasonsSummary as unknown as Prisma.InputJsonValue,
        progress: seasons.length > 0 ? Math.round(((i + 1) / seasons.length) * 100) : 100,
      },
    })
  } catch (err: unknown) {
    console.error(`[import] season ${season}:`, err)
    await prisma.importJobSeason
      .update({
        where: { jobId_season: { jobId, season } },
        data: { status: 'error', completedAt: new Date() },
      })
      .catch(() => {})
    throw err
  }

  await sleep(SLEEP_BETWEEN_SEASONS_MS)
}

export async function finalizeLegacyImportJob(
  jobId: string,
  userId: string,
  totalSeasonCount: number,
): Promise<void> {
  const job = await prisma.legacyImportJob.findUnique({ where: { id: jobId } })
  const totalLeaguesSaved = job?.totalLeaguesSaved ?? 0

  await prisma.legacyImportJob.update({
    where: { id: jobId },
    data: {
      status: 'complete',
      progress: 100,
      completedAt: new Date(),
      totalLeaguesSaved,
      seasonsCompleted: totalSeasonCount,
    },
  })

  // Retroactively tag any existing ranking-import leagues that predate this fix.
  // Real active-league imports always write `status` from the Sleeper API (e.g. "complete",
  // "in_season"). Leagues with status=null were created only by ranking imports and should
  // never appear in My Leagues.
  await prisma.league.updateMany({
    where: {
      userId,
      platform: 'sleeper',
      leagueVariant: null,
      status: null,
    },
    data: { leagueVariant: 'legacy_summary' },
  }).catch((e: unknown) => console.error('[import] retroactive variant tag failed:', e))

  // Final rank recomputation after all seasons + retroactive tagging. Per-season calls
  // inside importLegacySeasonAtIndex skip rank calc when saved===0 for that year, and the
  // retroactive variant flip can change which leagues count toward rank. One last pass
  // ensures the user's persisted xp/tier reflects the final state of the import.
  await calculateAndSaveRank(userId).catch((e: unknown) =>
    console.error('[import] finalize rank calc failed:', e),
  )

  await sendImportCompleteNotification(userId, jobId).catch((e: unknown) =>
    console.error('[import] notification failed:', e),
  )
}

/**
 * Full import in one process (local dev / tests). On Vercel, prefer chained {@link importLegacySeasonAtIndex} via internal-step.
 */
export async function processImportJob(
  jobId: string,
  userId: string,
  sleeperUserId: string,
  seasons: number[],
): Promise<void> {
  for (let i = 0; i < seasons.length; i++) {
    await importLegacySeasonAtIndex(jobId, userId, sleeperUserId, seasons, i)
  }
  await finalizeLegacyImportJob(jobId, userId, seasons.length)
}
