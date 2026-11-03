/**
 * Read-only production/staging smoke for one claimed NCAAF Player Finder league.
 * Run with node --require ./scripts/_audit-preload.cjs --import tsx
 * scripts/verify-player-finder-period-pilot.ts <league-uuid> --preview-allowlist --all.
 */
import { prisma } from '@/lib/prisma'
import { getFinderDailyImpact } from '@/lib/core-app/playerFinderDailyImpact'
import type { LeagueSlot } from '@/lib/core-app/playerFinder'

async function main() {
  const leagueId = process.argv[2]
  if (!leagueId || !/^[0-9a-f-]{36}$/i.test(leagueId)) {
    throw new Error('Pass one league UUID')
  }
  const previewAllowlist = process.argv.includes('--preview-allowlist')
  if (previewAllowlist) process.env.PLAYER_FINDER_PERIOD_PILOT_LEAGUE_IDS = leagueId
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, sport: true, platform: true, platformLeagueId: true, season: true },
  })
  if (!league || String(league.sport).toUpperCase() !== 'NCAAF' || league.platform !== 'fantrax') {
    throw new Error('League is not a Fantrax NCAAF league')
  }
  const team = await prisma.leagueTeam.findFirst({
    where: { leagueId, claimedByUserId: { not: null } },
    select: { claimedByUserId: true, platformUserId: true, externalId: true },
  })
  if (!team?.claimedByUserId) throw new Error('No claimed team')
  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: { in: [team.platformUserId, team.externalId, team.claimedByUserId].filter((id): id is string => Boolean(id)) } },
    select: { playerData: true },
  })
  if (!roster) throw new Error('Claimed team has no matching roster')
  const data = roster.playerData && typeof roster.playerData === 'object' && !Array.isArray(roster.playerData)
    ? roster.playerData as Record<string, unknown> : {}
  const players = Array.isArray(data.players) ? data.players.map(String) : []
  const starters = Array.isArray(data.starters) ? data.starters.map(String) : []
  const identities = await prisma.playerIdentityMap.findMany({
    where: { sport: 'NCAAF', fantraxId: { in: players } },
    select: { fantraxId: true, cfbdId: true },
  })
  const slot: LeagueSlot = {
    leagueId, leagueName: league.name ?? 'NCAAF league', platform: league.platform,
    format: null, platformLeagueId: league.platformLeagueId, season: league.season,
    teamExternalId: team.externalId, slot: 'STARTER', isYours: true, owner: null,
  }
  const outcomes = []
  for (const fantraxId of players) {
    const identity = identities.find((row) => row.fantraxId === fantraxId)
    if (!identity?.cfbdId) continue
    const player = await prisma.sportsPlayer.findFirst({
      where: { sport: 'NCAAF', source: 'cfbd', externalId: identity.cfbdId },
      select: { externalId: true, name: true, position: true, team: true, status: true },
    })
    if (!player) continue
    const result = await getFinderDailyImpact({ sport: 'NCAAF', source: 'cfbd',
      externalId: player.externalId, sleeperId: null, name: player.name,
      position: player.position, team: player.team, status: player.status },
      [slot], team.claimedByUserId, true)
    const impact = result.impact[0]
    outcomes.push({ name: player.name, starter: starters.includes(fantraxId), impact: Boolean(impact),
      points: impact?.afPoints.available ? impact.afPoints.data.points : null,
      replacements: impact?.replacements.available ? impact.replacements.data.length : 0,
      startOver: impact?.startOver ? { name: impact.startOver.name, delta: impact.startOver.delta } : null,
      moves: result.moves.length })
    if (!process.argv.includes('--all') && (impact?.startOver || result.moves.length ||
      (impact?.replacements.available && impact.replacements.data.some((item) => (item.delta ?? 0) > 0)))) break
  }
  console.log(JSON.stringify({ leagueId, previewAllowlist, players: players.length, linked: identities.length,
    starters: starters.length, evaluated: outcomes.length,
    impactedStarters: outcomes.filter((row) => row.starter && row.impact).length,
    pricedStarters: outcomes.filter((row) => row.starter && row.points != null).length,
    unavailableStarters: outcomes.filter((row) => row.starter && row.points == null).map((row) => row.name),
    legalSwap: outcomes.find((row) => row.startOver || row.replacements > 0) ?? null,
    movesFound: outcomes.reduce((sum, row) => sum + row.moves, 0) }))
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
