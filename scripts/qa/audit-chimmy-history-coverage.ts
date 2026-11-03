import { prisma } from '@/lib/prisma'

async function main() {
  const playerLogs = await prisma.$queryRaw`
    WITH reader_keys AS (
      SELECT sport, id AS player_id FROM "PlayerIdentityMap"
      WHERE sport NOT IN ('NFL', 'NCAAF') AND "rollingInsightsId" IS NOT NULL
      UNION
      SELECT sport, "sleeperId" FROM "PlayerIdentityMap"
      WHERE sport = 'NFL' AND "sleeperId" IS NOT NULL
      UNION
      SELECT sport, player_id FROM fantasy_stat_lines
      WHERE sport = 'NCAAF' AND source = 'cfbd' AND week = 0 AND nullif(stats ->> 'name', '') IS NOT NULL
    )
    SELECT p."sportType" AS sport, p.season, p.source, count(*)::int AS rows,
      count(*) FILTER (WHERE i.player_id IS NOT NULL)::int AS rows_with_reader_identity,
      count(DISTINCT p."playerId")::int AS player_ids
    FROM player_game_stats p
    LEFT JOIN reader_keys i
      ON i.player_id = p."playerId" AND i.sport = p."sportType"
    WHERE p.season BETWEEN 2023 AND 2026
    GROUP BY 1, 2, 3 ORDER BY 1, 2, 3
  `
  const leagueScores = await prisma.$queryRaw`
    SELECT "seasonYear" AS season, source, count(*)::int AS rows,
      count(*) FILTER (WHERE "isFinalized")::int AS finalized
    FROM league_player_weekly_scores
    WHERE "seasonYear" BETWEEN 2023 AND 2026 AND lower(source) <> 'yahoo'
    GROUP BY 1, 2 ORDER BY 1, 2
  `
  console.log(JSON.stringify({ playerLogs, leagueScores }))
}

main().catch(() => { console.error('Chimmy history coverage audit failed'); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
