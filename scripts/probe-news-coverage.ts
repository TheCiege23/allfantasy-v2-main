/**
 * F2.7 News coverage probe — READ-ONLY, non-prod only.
 * Usage: DATABASE_URL=<staging> npx tsx scripts/probe-news-coverage.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({ log: [] })

void (async () => {
  const host = process.env.DATABASE_URL?.match(/@([^/]+)\//)?.[1] ?? 'unknown'
  console.log(`DB host: ${host}`)
  if (host.includes('ep-spring-tooth')) {
    console.error('HARD REFUSE: prod host')
    process.exit(1)
  }

  // PlayerNewsRecord
  const pnrTotal = await prisma.playerNewsRecord.count()
  const pnrWithPlayerId = await prisma.playerNewsRecord.count({ where: { playerId: { not: null } } })
  const pnrBySport = await prisma.playerNewsRecord.groupBy({ by: ['sport'], _count: { _all: true } })
  const pnrByImpact = await prisma.playerNewsRecord.groupBy({ by: ['impact'], _count: { _all: true } })
  const pnrNewest = await prisma.playerNewsRecord.findFirst({ orderBy: { publishedAt: 'desc' }, select: { publishedAt: true, createdAt: true } })
  const pnrSample = await prisma.playerNewsRecord.findMany({
    orderBy: { publishedAt: 'desc' }, take: 3,
    select: { id: true, sport: true, playerName: true, playerId: true, headline: true, publishedAt: true, impact: true, fantasyRelevant: true, source: true, team: true },
  })

  console.log(`\n=== PlayerNewsRecord (player_news table) ===`)
  console.log(`Total rows:            ${pnrTotal}`)
  console.log(`With playerId:         ${pnrWithPlayerId}`)
  console.log(`By sport:              ${JSON.stringify(pnrBySport)}`)
  console.log(`By impact:             ${JSON.stringify(pnrByImpact)}`)
  console.log(`Newest publishedAt:    ${pnrNewest?.publishedAt?.toISOString()}`)
  console.log(`Newest createdAt:      ${pnrNewest?.createdAt?.toISOString()}`)
  console.log(`Sample (latest 3):`)
  for (const r of pnrSample) console.log('  ', JSON.stringify(r))

  // PlayerNewsItem
  const pniTotal = await prisma.playerNewsItem.count()
  const pniWithPlayerId = await prisma.playerNewsItem.count({ where: { playerId: { not: null } } })
  const pniFresh = await prisma.playerNewsItem.count({ where: { expiresAt: { gt: new Date() } } })
  const pniWithExpiry = await prisma.playerNewsItem.count({ where: { expiresAt: { not: null } } })
  const pniBySport = await prisma.playerNewsItem.groupBy({ by: ['sportKey'], _count: { _all: true } })
  const pniByCategory = await prisma.playerNewsItem.groupBy({ by: ['category'], _count: { _all: true } })
  const pniNewest = await prisma.playerNewsItem.findFirst({ orderBy: { publishedAt: 'desc' }, select: { publishedAt: true, fetchedAt: true, expiresAt: true, identityConfidence: true } })
  const pniSample = await prisma.playerNewsItem.findMany({
    orderBy: { publishedAt: 'desc' }, take: 3,
    select: { id: true, sportKey: true, playerId: true, headline: true, publishedAt: true, fetchedAt: true, expiresAt: true, category: true, source: true, confidence: true, identityConfidence: true },
  })

  console.log(`\n=== PlayerNewsItem (sports_core_player_news_items) ===`)
  console.log(`Total rows:            ${pniTotal}`)
  console.log(`With playerId:         ${pniWithPlayerId}`)
  console.log(`With expiresAt:        ${pniWithExpiry}`)
  console.log(`Fresh (expiresAt>now): ${pniFresh}`)
  console.log(`By sportKey:           ${JSON.stringify(pniBySport)}`)
  console.log(`By category:           ${JSON.stringify(pniByCategory)}`)
  console.log(`Newest row:            ${JSON.stringify(pniNewest)}`)
  console.log(`Sample (latest 3):`)
  for (const r of pniSample) console.log('  ', JSON.stringify(r))

  // SportsNews
  const snTotal = await prisma.sportsNews.count()
  const snWithPlayerId = await prisma.sportsNews.count({ where: { playerId: { not: null } } })
  const snFresh = await prisma.sportsNews.count({ where: { expiresAt: { gt: new Date() } } })
  const snBySport = await prisma.sportsNews.groupBy({ by: ['sport'], _count: { _all: true } })
  const snNewest = await prisma.sportsNews.findFirst({ orderBy: { publishedAt: 'desc' }, select: { publishedAt: true, expiresAt: true, source: true, sport: true } })
  const snSample = await prisma.sportsNews.findMany({
    orderBy: { publishedAt: 'desc' }, take: 3,
    select: { id: true, sport: true, playerId: true, playerName: true, title: true, publishedAt: true, expiresAt: true, source: true, category: true },
  })

  console.log(`\n=== SportsNews ===`)
  console.log(`Total rows:            ${snTotal}`)
  console.log(`With playerId:         ${snWithPlayerId}`)
  console.log(`Fresh (expiresAt>now): ${snFresh}`)
  console.log(`By sport:              ${JSON.stringify(snBySport)}`)
  console.log(`Newest row:            ${JSON.stringify(snNewest)}`)
  console.log(`Sample (latest 3):`)
  for (const r of snSample) console.log('  ', JSON.stringify(r))

  await prisma.$disconnect()
  process.exit(0)
})()
