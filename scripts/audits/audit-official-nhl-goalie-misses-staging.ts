/** Read-only diagnosis of unmatched official goalie rows on one staging date. */
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { fetchOfficialNhlGoalieDay, matchOfficialNhlGoalieGame } from '@/lib/nhl-scoring/officialGoalieGameStats'
import targetGuard from '../db-target-identity.cjs'

async function main() {
  const date = process.argv[2]
  assert.match(date ?? '', /^\d{4}-\d{2}-\d{2}$/, 'DATE_REQUIRED')
  assert.equal(targetGuard.identifyTarget(process.env.DIRECT_URL || process.env.DATABASE_URL).label,
    'staging', 'STAGING_DATABASE_REQUIRED')
  const [boxes, official] = await Promise.all([
    prisma.playerGameStat.findMany({ where: { sportType: 'NHL', source: 'rolling_insights_live',
      gameDate: new Date(`${date}T00:00:00Z`), gameId: { endsWith: ':goalies' } },
    select: { playerId: true, team: true, opponent: true, normalizedStatMap: true } }),
    fetchOfficialNhlGoalieDay(date!),
  ])
  const ids = [...new Set(boxes.map((box) => box.playerId))]
  const names = new Map((await prisma.playerIdentityMap.findMany({ where: { sport: 'NHL',
    id: { in: ids } }, select: { id: true, canonicalName: true } }))
    .map((row) => [row.id, row.canonicalName]))
  const failed = boxes.flatMap((box) => {
    const stats = (box.normalizedStatMap as { stats?: Record<string, unknown> } | null)?.stats
    const name = names.get(box.playerId)
    const saves = stats?.saves, goalsAgainst = stats?.goals_allowed
    if (!name || !box.team || !box.opponent || typeof saves !== 'number' || typeof goalsAgainst !== 'number')
      return [{ name, team: box.team, opponent: box.opponent, saves, goalsAgainst, reason: 'missing_box_fields' }]
    const match = matchOfficialNhlGoalieGame({ date: date!, team: box.team,
      opponent: box.opponent, playerName: name, saves, goalsAgainst }, official)
    return match.row ? [] : [{ name, team: box.team, opponent: box.opponent,
      saves, goalsAgainst, reason: match.reason,
      sameName: official.filter((row) => row.goalieFullName.toLowerCase() === name.toLowerCase())
        .map((row) => ({ team: row.teamAbbrev, opponent: row.opponentTeamAbbrev,
          saves: row.saves, goalsAgainst: row.goalsAgainst })) }]
  })
  console.log(JSON.stringify({ date, boxes: boxes.length, official: official.length,
    failed: failed.length, examples: failed.slice(0, 12) }, null, 2))
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
