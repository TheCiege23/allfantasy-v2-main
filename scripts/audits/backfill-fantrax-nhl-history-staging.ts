/** Bounded, league-scoped NHL actuals backfill. Dry run unless --write is supplied. */
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { riFetchRows } from '@/lib/workers/providers/rollingInsightsRest'
import { normalizeRiGameBox, normalizedStatMapFor, writeRiGameRows } from '@/lib/sports-data/rollingInsightsGameLogs'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import { fetchOfficialNhlGoalieDay, matchOfficialNhlGoalieGame } from '@/lib/nhl-scoring/officialGoalieGameStats'
import { enrichOfficialNhlGoalieGameStats } from '@/lib/nhl-scoring/officialGoalieGameStatsIngest'
import targetGuard from '../db-target-identity.cjs'

async function main() {
  assert.equal(targetGuard.identifyTarget(process.env.DIRECT_URL || process.env.DATABASE_URL).label,
    'staging', 'STAGING_DATABASE_REQUIRED')
  const [leagueId, ...args] = process.argv.slice(2)
  assert.match(leagueId ?? '', /^[0-9a-f-]{36}$/i)
  const dates = [...new Set(args.filter((arg) => arg !== '--write'))]
  assert.ok(dates.length > 0 && dates.length <= 3, 'ONE_TO_THREE_DATES_REQUIRED')
  assert.ok(dates.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Date.parse(`${date}T00:00:00Z`) < Date.now() - 86400000), 'PAST_DATES_REQUIRED')
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })
  assert.equal(league.sport, 'NHL')
  assert.equal(league.platform, 'fantrax')
  const rosters = await prisma.roster.findMany({ where: { leagueId }, select: { playerData: true } })
  const rosterIds = [...new Set(rosters.flatMap((row) => {
    const data = row.playerData as { players?: unknown }
    return Array.isArray(data?.players) ? data.players.filter((id): id is string => typeof id === 'string') : []
  }))]
  const identities = await prisma.playerIdentityMap.findMany({ where: { sport: 'NHL',
    fantraxId: { in: rosterIds } }, select: { id: true, rollingInsightsId: true, fantraxId: true, canonicalName: true } })
  const byRiId = new Map<string, string>()
  const names = new Map(identities.map((row) => [row.id, row.canonicalName]))
  for (const row of identities) {
    if (!row.rollingInsightsId) continue
    assert.ok(!byRiId.has(row.rollingInsightsId), 'DUPLICATE_RI_IDENTITY')
    assert.equal(identities.filter((other) => other.fantraxId === row.fantraxId).length, 1, 'DUPLICATE_FANTRAX_IDENTITY')
    byRiId.set(row.rollingInsightsId, row.id)
  }
  for (const date of dates) {
    const response = await riFetchRows('live', { sport: 'NHL', date })
    assert.ok(!response.error && !response.notModified, response.error ?? 'UNCONFIRMED_PROVIDER_RESPONSE')
    const official = await fetchOfficialNhlGoalieDay(date)
    const existing = await prisma.playerGameStat.findMany({ where: { sportType: 'NHL',
      playerId: { in: [...byRiId.values()] }, gameDate: new Date(`${date}T00:00:00Z`) },
    select: { playerId: true, gameId: true } })
    const occupied = new Set(existing.map((row) => `${row.playerId}:${row.gameId}`))
    const allowed = new Set<string>()
    const rows = response.rows.filter((raw) => {
      const box = normalizeRiGameBox(raw)
      return box && normalizeGameStatus(box.status) === 'final' && box.seasonType === 'regular' &&
        box.gameDay?.toISOString().slice(0, 10) === date &&
        box.season !== null && box.season <= league.season
    })
    let excludedGoalies = 0
    for (const raw of rows) {
      const box = normalizeRiGameBox(raw)!
      for (const line of box.lines) {
        const id = byRiId.get(line.providerPlayerId)
        if (!id || !['skaters', 'goalies'].includes(line.group)) continue
        const gameId = `${box.providerGameId}:${line.group}`
        if (occupied.has(`${id}:${gameId}`)) continue
        if (line.group === 'goalies') {
          const stats = normalizedStatMapFor(line, box).stats as Record<string, unknown>
          const match = line.team && line.opponent && typeof stats.saves === 'number' &&
            typeof stats.goals_allowed === 'number' ? matchOfficialNhlGoalieGame({ date,
              team: line.team, opponent: line.opponent, playerName: names.get(id)!,
              saves: stats.saves, goalsAgainst: stats.goals_allowed }, official) : null
          if (!match?.row) { excludedGoalies++; continue }
        }
        allowed.add(`${id}:${gameId}`)
      }
    }
    const result = { games: 0, lines: 0, written: 0, unresolved: 0,
      unrecognizedSeasonTypes: [] as string[], errors: [] as string[] }
    if (args.includes('--write') && allowed.size) {
      await writeRiGameRows({ sport: 'NHL', rows, identityByRiId: byRiId, now: new Date(),
        result, persistSchedule: true, insertOnly: true,
        shouldWriteLine: ({ playerId, gameId }) => allowed.has(`${playerId}:${gameId}`) })
    }
    const goalie = args.includes('--write') && result.written
      ? await enrichOfficialNhlGoalieGameStats({ dates: [date] }) : null
    console.log(JSON.stringify({ date, dryRun: !args.includes('--write'), selectedGames: rows.length,
      candidates: allowed.size, excludedGoalies, ...result, officialGoalies: goalie }))
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
