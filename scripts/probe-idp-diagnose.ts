/** READ-ONLY diagnostic for a single defender's projection. Never writes. */
import { PrismaClient } from '@prisma/client'

import { projectIdpStatLine } from '../lib/idp-projections/projectIdpStatLine'
import { computeLeagueProjectedPoints, extractScoringSettings } from '../lib/projections/leagueScoring'

const prisma = new PrismaClient()
const NAME = process.argv[2] ?? 'Kam Curl'
const LEAGUE = process.argv[3] ?? 'Defense IDP For Life'

async function main() {
  const players = await prisma.sportsPlayer.findMany({
    where: { name: { contains: NAME, mode: 'insensitive' } },
    select: { id: true, sleeperId: true, name: true, position: true, team: true, sport: true },
  })
  console.log(`SportsPlayer rows matching "${NAME}": ${players.length}`)
  for (const p of players.slice(0, 8)) {
    console.log(`  id=${p.id} sleeperId=${p.sleeperId} ${p.name} ${p.position} ${p.team} ${p.sport}`)
  }
  const sleeperId = players.find((p) => p.sleeperId)?.sleeperId
  if (!sleeperId) return console.log('no sleeperId')

  const games = await prisma.playerGameStat.findMany({
    where: { sportType: 'NFL', playerId: sleeperId },
    select: { season: true, weekOrRound: true, opponent: true, normalizedStatMap: true, source: true },
    orderBy: [{ season: 'asc' }, { weekOrRound: 'asc' }],
  })
  console.log(`\nplayer_game_stats rows for sleeperId=${sleeperId}: ${games.length}`)
  for (const g of games.slice(-8)) {
    const m = g.normalizedStatMap as Record<string, unknown>
    const idp = Object.fromEntries(Object.entries(m).filter(([k]) => k.startsWith('idp_')))
    console.log(`  ${g.season} wk${String(g.weekOrRound).padStart(2)} src=${g.source} ${JSON.stringify(idp)}`)
  }

  const season = games.at(-1)?.season ?? 2025
  const week = (games.at(-1)?.weekOrRound ?? 0) + 1
  const history = games.map((g) => ({
    season: g.season,
    week: g.weekOrRound,
    opponent: g.opponent,
    statMap: g.normalizedStatMap as Record<string, unknown>,
  }))

  const out = projectIdpStatLine({ position: players[0].position, history })
  console.log(`\nprojection (season ${season}, week ${week}):`)
  console.log(JSON.stringify(out, null, 2).slice(0, 1200))

  const league = await prisma.league.findFirst({
    where: { name: { contains: LEAGUE, mode: 'insensitive' } },
    select: { id: true, name: true, settings: true },
  })
  if (!league) return console.log(`\nno league matching "${LEAGUE}"`)
  const scoring = extractScoringSettings(league.settings)
  const defensive = Object.fromEntries(
    Object.entries(scoring ?? {}).filter(
      ([k, v]) =>
        typeof v === 'number' &&
        v !== 0 &&
        (k.startsWith('idp_') || ['tkl', 'tkl_solo', 'tkl_ast', 'sack', 'int', 'ff', 'fum_rec', 'pass_def', 'safe'].includes(k)),
    ),
  )
  console.log(`\nleague "${league.name}" defensive scoring keys:`)
  console.log(JSON.stringify(defensive, null, 2))

  if (out.ok && scoring) {
    const scored = computeLeagueProjectedPoints(out.statLine, scoring)
    console.log(`\nscored: ${scored?.points}`)
    console.log(`contributions: ${JSON.stringify(scored?.contributions)}`)
    console.log(`unusedProjectedStats: ${JSON.stringify(scored?.coverage.unusedProjectedStats)}`)
  }
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 300) : e))
  .finally(() => prisma.$disconnect())
