/**
 * Backfill `league_player_weekly_scores` (source 'allfantasy') for NATIVE leagues' already-final weeks.
 *
 * The scoring engine writes these rows itself from now on (lib/redraft/nativePlayerWeeklyScores.ts,
 * via `updateMatchupScores`). Weeks that went final before that change have none, so Storyline
 * Studio's "last season" player hooks have nothing to read until this runs.
 *
 * ⚠ A RESCORE OF AN OLD WEEK IS NOT AUTOMATICALLY THE WEEK THAT WAS PLAYED. The engine reads the
 * roster as it is NOW (plus that week's saved lineup), so a player traded since would be scored onto
 * his new team. Every roster-week is therefore VERIFIED before it is written: the rescored starter
 * total (plus any commissioner adjustment) must equal the score stored on the final matchup to the
 * cent. A roster-week that does not reproduce is skipped and counted, never written.
 *
 * Reads and the row writes only — it never touches `redraft_matchups`, standings or events.
 *
 * ⚠ DRY RUN BY DEFAULT. Writing requires --commit. The dry run rescores everything and reports how
 * many roster-weeks verify and how many rows a real run would write.
 *
 * Usage:
 *   npx tsx scripts/backfill-native-player-weekly-scores.ts                     # dry run, every native league
 *   npx tsx scripts/backfill-native-player-weekly-scores.ts --league=<League.id> --season=2025
 *   npx tsx scripts/backfill-native-player-weekly-scores.ts --season=2025 --commit
 */
import { prisma } from '../lib/prisma'
import { isNativePlatform } from '../lib/league/isNativeLeague'
import { settingsForScoringWeek } from '../lib/category-scoring/leagueScoringType'
import { adjustmentFor, readScoreAdjustments } from '../lib/score-adjustments/scoreAdjustments'
import { scoreRosterForWeek } from '../lib/redraft/scoringEngine'
import { writeNativePlayerWeeklyScores } from '../lib/redraft/nativePlayerWeeklyScores'

const { describeTarget, isProductionTarget } = require('./db-target-identity.cjs') as {
  describeTarget: (url: string) => string
  isProductionTarget: (url: string) => boolean
}

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}
const COMMIT = process.argv.includes('--commit')

async function main() {
  const url = process.env.DATABASE_URL ?? ''
  console.log(`DB target : ${describeTarget(url)}`)
  console.log(`Mode      : ${COMMIT ? 'COMMIT (will write)' : 'DRY RUN (no writes)'}`)
  if (isProductionTarget(url) && COMMIT) {
    console.log('⚠ This is PRODUCTION and --commit is set. Ctrl-C now if that is not intended.')
    await new Promise((r) => setTimeout(r, 5000))
  }

  const leagueFilter = arg('league')
  const seasonArg = arg('season')
  const season = seasonArg ? Number(seasonArg) : null
  if (seasonArg && !Number.isInteger(season)) throw new Error(`--season=${seasonArg} is not a season`)

  const leagues = (
    await prisma.league.findMany({
      where: leagueFilter ? { id: leagueFilter } : {},
      select: { id: true, name: true, platform: true, settings: true },
    })
  ).filter((l) => isNativePlatform(l.platform))
  console.log(`Leagues   : ${leagues.length} native`)
  console.log('')

  let verified = 0
  let unverified = 0
  let skipped = 0
  let rows = 0
  const failures: Array<{ league: string; matchup: string; error: string }> = []

  for (const league of leagues) {
    const seasons = await prisma.redraftSeason.findMany({
      where: { leagueId: league.id, ...(season != null ? { season } : {}) },
      select: { id: true, season: true },
    })
    for (const s of seasons) {
      const matchups = await prisma.redraftMatchup.findMany({
        where: { seasonId: s.id, status: 'final', isMedianMatchup: false, awayRosterId: { not: null } },
        select: { id: true, week: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true },
        orderBy: { week: 'asc' },
      })
      for (const m of matchups) {
        const scoring = settingsForScoringWeek(league.settings as Record<string, any> | null, s.season, m.week)
        const mode = scoring?.scoring_mode ?? scoring?.scoringSettings?.scoringMode ?? 'points'
        // Category leagues are not scored in points; their fantasy points are not what the league counted.
        if (mode !== 'points') {
          skipped += 2
          continue
        }
        const adjustments = readScoreAdjustments(scoring)
        for (const side of [
          { rosterId: m.homeRosterId, stored: m.homeScore },
          { rosterId: m.awayRosterId as string, stored: m.awayScore },
        ]) {
          try {
            const r = await scoreRosterForWeek({
              leagueId: league.id,
              rosterId: side.rosterId,
              week: m.week,
              seasonYear: s.season,
              collectPlayerPoints: true,
            })
            if (!r.playerPoints) {
              skipped += 1 // devy engine: no per-player breakdown exists
              continue
            }
            const reproduced = Math.round((r.points + adjustmentFor(adjustments, m.id, side.rosterId)) * 100) / 100
            if (r.missingPlayerIds.length > 0 || Math.abs(reproduced - side.stored) > 0.005) {
              unverified += 1
              continue
            }
            verified += 1
            rows += r.playerPoints.length
            if (COMMIT) {
              await writeNativePlayerWeeklyScores(prisma, {
                leagueId: league.id,
                seasonYear: s.season,
                week: m.week,
                redraftRosterId: side.rosterId,
                players: r.playerPoints,
                isFinalized: true,
              })
            }
          } catch (e) {
            failures.push({ league: league.id, matchup: m.id, error: e instanceof Error ? e.message : String(e) })
          }
        }
      }
    }
  }

  console.log(`Roster-weeks verified   : ${verified}`)
  console.log(`Roster-weeks unverified : ${unverified} (rescore did not reproduce the stored score — not written)`)
  console.log(`Roster-weeks skipped    : ${skipped} (category scoring or devy engine)`)
  console.log(`Rows ${COMMIT ? 'written' : 'that would be written'} : ${rows}`)
  if (failures.length > 0) {
    console.log(`Failures                : ${failures.length}`)
    for (const f of failures.slice(0, 20)) console.log(`  ${f.league} ${f.matchup}: ${f.error}`)
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
