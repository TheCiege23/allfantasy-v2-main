import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const sessionId = '04f8e3e2-a768-4267-bc7f-86dc9629427e'
const leagueId  = 'ab46a586-e6cf-4636-bacc-a515b0c3d0b2'

// 1. Check for picks with empty/null playerName
const badPicks = await prisma.$queryRaw`
  SELECT overall, "playerName", position, "rosterId", source
  FROM draft_picks
  WHERE "sessionId" = ${sessionId}
    AND (TRIM("playerName") = '' OR "playerName" IS NULL)
  ORDER BY overall
`
console.log('\n=== Picks with empty playerName ===')
console.log(JSON.stringify(badPicks, null, 2))

// 2. All picks ordered
const allPicks = await prisma.$queryRaw`
  SELECT overall, "playerName", position, "rosterId", source
  FROM draft_picks
  WHERE "sessionId" = ${sessionId}
  ORDER BY overall
`
console.log('\n=== All picks ===')
console.log(JSON.stringify(allPicks, null, 2))

// 3. Session status and currentOverall
const sess = await prisma.$queryRaw`
  SELECT status, "currentOverall", "teamCount", rounds
  FROM draft_sessions WHERE id = ${sessionId}
`
console.log('\n=== Session status ===')
console.log(JSON.stringify(sess, null, 2))

await prisma.$disconnect()
