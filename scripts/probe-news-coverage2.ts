/**
 * F2.7 News coverage probe part 2 — READ-ONLY, non-prod only.
 * Probes SportsNews and examines PlayerNewsRecord playerId namespace.
 */
import { PrismaClient } from '@prisma/client'
import { assertNonProductionDbTarget } from './_db-target-identity'

const prisma = new PrismaClient({ log: [] })

void (async () => {
  assertNonProductionDbTarget({ script: 'probe-news-coverage2', action: 'reads coverage counts' })

  // SportsNews
  const snTotal = await prisma.sportsNews.count()
  const snWithPlayerId = await prisma.sportsNews.count({ where: { playerId: { not: null } } })
  const snFresh = await prisma.sportsNews.count({ where: { expiresAt: { gt: new Date() } } })
  const snBySport = await prisma.sportsNews.groupBy({ by: ['sport'], _count: { _all: true } })
  const snBySource = await prisma.sportsNews.groupBy({ by: ['source'], _count: { _all: true } })
  const snNewest = await prisma.sportsNews.findFirst({
    orderBy: { publishedAt: 'desc' },
    select: { id: true, sport: true, playerId: true, playerName: true, title: true, publishedAt: true, expiresAt: true, source: true, category: true },
  })
  const snSample = await prisma.sportsNews.findMany({
    orderBy: { publishedAt: 'desc' }, take: 5,
    select: { id: true, sport: true, playerId: true, playerName: true, title: true, publishedAt: true, expiresAt: true, source: true, category: true },
  })

  console.log(`\n=== SportsNews ===`)
  console.log(`Total rows:            ${snTotal}`)
  console.log(`With playerId:         ${snWithPlayerId}`)
  console.log(`Fresh (expiresAt>now): ${snFresh}`)
  console.log(`By sport:              ${JSON.stringify(snBySport)}`)
  console.log(`By source:             ${JSON.stringify(snBySource)}`)
  console.log(`Newest:                ${JSON.stringify(snNewest)}`)
  console.log(`Sample (5):`)
  for (const r of snSample) console.log('  ', JSON.stringify(r))

  // PlayerNewsRecord: check name distribution
  const pnrPlayerNameSamples = await prisma.playerNewsRecord.findMany({
    where: { sport: 'NFL', playerId: null },
    orderBy: { publishedAt: 'desc' },
    take: 10,
    select: { playerName: true, team: true, headline: true, publishedAt: true, impact: true, source: true },
  })
  const pnrGeneralUpdate = await prisma.playerNewsRecord.count({ where: { playerName: 'General Update' } })
  const pnrDistinctPlayers = await prisma.playerNewsRecord.groupBy({
    by: ['playerName'], _count: { _all: true }, orderBy: { _count: { _all: 'desc' } }, take: 10,
  })
  const pnrBySrc = await prisma.playerNewsRecord.groupBy({ by: ['source'], _count: { _all: true } })
  const pnrFantasyRelevant = await prisma.playerNewsRecord.count({ where: { fantasyRelevant: true } })

  console.log(`\n=== PlayerNewsRecord — name/join analysis ===`)
  console.log(`'General Update' rows: ${pnrGeneralUpdate}`)
  console.log(`Fantasy-relevant rows: ${pnrFantasyRelevant}`)
  console.log(`By source:             ${JSON.stringify(pnrBySrc)}`)
  console.log(`Top player names:      ${JSON.stringify(pnrDistinctPlayers)}`)
  console.log(`NFL sample (no playerId):`)
  for (const r of pnrPlayerNameSamples) console.log('  ', JSON.stringify(r))

  await prisma.$disconnect()
  process.exit(0)
})()
