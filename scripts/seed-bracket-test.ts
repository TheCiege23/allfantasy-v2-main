import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"
import { randomUUID } from "crypto"
import { assertSafeSeedTarget } from './_assert-safe-seed-target'

const prisma = new PrismaClient()

const TOURNAMENT_ID = "a2cc3feb-5a73-4d83-89ee-081fc4eb97c1"
const NUM_USERS = 1000
const NUM_LEAGUES = 1000
const NUM_MESSAGES = 1000
const NUM_WINNERS = 100
const BATCH_SIZE = 100

const TEAM_NAMES = [
  "Connecticut", "Wagner", "Northwestern", "Michigan State", "San Diego State",
  "Grand Canyon", "Auburn", "Vermont", "BYU", "NC State", "Baylor", "Colgate",
  "Texas", "Drake", "Marquette", "Long Beach State", "Purdue", "FDU",
  "Mississippi State", "Oregon", "Clemson", "Samford", "North Carolina", "Akron",
  "South Carolina", "McNeese State", "Kentucky", "Grambling State", "Nevada",
  "New Mexico", "Duke", "Stetson", "Iowa State", "Longwood", "Utah State", "TCU",
  "Wisconsin", "James Madison", "Kansas", "Yale", "Gonzaga", "Montana State",
  "Creighton", "UC Santa Barbara", "Tennessee", "Saint Peter's", "Illinois",
  "Morehead State", "Houston", "Alabama State", "Arizona", "Long Island",
  "Dayton", "Florida", "Indiana", "Kent State", "UCLA", "Pittsburgh",
  "Villanova", "Colorado State", "Michigan", "Texas A&M", "Memphis", "Rutgers"
]

const CHAT_MESSAGES = [
  "Let's go! My bracket is locked in!", "Anyone else pick a 12-seed upset in the South?",
  "No way Duke loses in the first round", "I'm going chalk in the West region",
  "That 5-12 matchup is a coin flip honestly", "Who's your dark horse Final Four pick?",
  "I went with the upset in the Midwest, feeling risky", "My bracket is looking strong!",
  "Busted already lol", "Can't believe that happened", "AI told me to pick the upset and it hit!",
  "This scoring system is wild, upset bonus is huge", "Insurance token saved me that round",
  "Who's leading the pool right now?", "My leverage bonus just kicked in!",
  "GG everyone, great pool this year", "These AI matchup analysis cards are clutch",
  "Anyone in other pools too?", "First time doing this, so far so good",
  "That was the craziest game I've ever seen", "My Final Four is busted already",
  "Chalk city in my bracket, playing it safe", "Going for the upset delta bonus this round",
  "Who picked that 15 seed?? Legend", "This leaderboard is going to be tight",
  "Good luck everyone!", "Round of 32 is where it gets real",
  "Sweet 16 picks are locked, let's see what happens", "My bracket is toast",
  "Still alive in 3 regions!", "Wow that was a buzzer beater upset",
  "FanCred EDGE scoring rewards the bold", "Insurance token on my championship pick",
  "This pool has been so fun", "AI gave that game 65% and it was right",
  "Who else got wrecked by the 11 seed?", "Elite 8 here we come",
  "That leverage bonus is worth so much", "Perfect bracket through round 1!",
  "My upset picks are carrying me right now"
]

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function generateUsername(index: number): string {
  const prefixes = ["bracket", "hoops", "march", "madness", "cbb", "ncaa", "fan", "hoop", "ball", "dunk", "slam", "net", "court", "pick", "seed"]
  const suffixes = ["king", "queen", "pro", "guru", "wizard", "master", "chief", "ace", "star", "boss", "goat", "champ", "elite", "prime", "alpha"]
  return `${randomFrom(prefixes)}${randomFrom(suffixes)}${index}`
}

async function main() {
  // Fail closed before the first write — see scripts/_assert-safe-seed-target.ts.
  assertSafeSeedTarget('seed-bracket-test')

  console.log("=== AllFantasy March Madness Stress Test Seeder ===\n")

  const nodes = await prisma.bracketNode.findMany({
    where: { tournamentId: TOURNAMENT_ID },
    orderBy: [{ round: "asc" }, { region: "asc" }, { slot: "asc" }],
  })
  console.log(`Found ${nodes.length} bracket nodes across ${new Set(nodes.map(n => n.round)).size} rounds`)

  if (nodes.length === 0) {
    console.error("No bracket nodes found for tournament. Aborting.")
    process.exit(1)
  }

  const r1Nodes = nodes.filter(n => n.round === 1)
  const teamPool: string[] = []
  for (const n of r1Nodes) {
    if (n.homeTeamName) teamPool.push(n.homeTeamName)
    if (n.awayTeamName) teamPool.push(n.awayTeamName)
  }
  console.log(`Team pool: ${teamPool.length} teams`)

  const nodesByRound = new Map<number, typeof nodes>()
  for (const n of nodes) {
    const arr = nodesByRound.get(n.round) || []
    arr.push(n)
    nodesByRound.set(n.round, arr)
  }

  const parentMap = new Map<string, { nodeId: string; side: string }>()
  for (const n of nodes) {
    if (n.nextNodeId && n.nextNodeSide) {
      parentMap.set(`${n.nextNodeId}_${n.nextNodeSide}`, { nodeId: n.id, side: n.nextNodeSide })
    }
  }

  console.log("\n--- Phase 1: Creating 1,000 test accounts ---")
  const passwordHash = await bcrypt.hash("Test1234!", 10)
  const userIds: string[] = []

  for (let batch = 0; batch < NUM_USERS / BATCH_SIZE; batch++) {
    const users = []
    for (let i = 0; i < BATCH_SIZE; i++) {
      const idx = batch * BATCH_SIZE + i
      const id = randomUUID()
      userIds.push(id)
      users.push({
        id,
        email: `testuser${idx}@allfantasy.test`,
        username: generateUsername(idx),
        displayName: `Test User ${idx}`,
        passwordHash,
        emailVerified: new Date(),
      })
    }
    await prisma.appUser.createMany({ data: users, skipDuplicates: true })
    if ((batch + 1) % 5 === 0) console.log(`  Created ${(batch + 1) * BATCH_SIZE} accounts...`)
  }
  console.log(`  Done: ${userIds.length} accounts created`)

  console.log("\n--- Phase 2: Creating 1,000 leagues ---")
  const leagueIds: string[] = []

  for (let batch = 0; batch < NUM_LEAGUES / BATCH_SIZE; batch++) {
    const leagues = []
    for (let i = 0; i < BATCH_SIZE; i++) {
      const idx = batch * BATCH_SIZE + i
      const id = randomUUID()
      leagueIds.push(id)
      leagues.push({
        id,
        tournamentId: TOURNAMENT_ID,
        ownerId: userIds[idx % userIds.length],
        name: `Test Pool ${idx + 1}`,
        joinCode: `TEST${String(idx).padStart(6, "0")}`,
        isPrivate: Math.random() > 0.3,
        maxManagers: 100,
        scoringRules: { mode: "EDGE", upsetBonus: true, leverageBonus: true, insuranceTokens: true },
      })
    }
    await prisma.bracketLeague.createMany({ data: leagues, skipDuplicates: true })
    if ((batch + 1) % 5 === 0) console.log(`  Created ${(batch + 1) * BATCH_SIZE} leagues...`)
  }
  console.log(`  Done: ${leagueIds.length} leagues created`)

  console.log("\n--- Phase 3: Adding members to leagues ---")
  const memberData: { leagueId: string; userId: string; role: string }[] = []

  for (let li = 0; li < leagueIds.length; li++) {
    const leagueId = leagueIds[li]
    const ownerIdx = li % userIds.length
    memberData.push({ leagueId, userId: userIds[ownerIdx], role: "OWNER" })

    const memberCount = 3 + Math.floor(Math.random() * 8)
    const usedIndices = new Set([ownerIdx])
    for (let m = 0; m < memberCount; m++) {
      let randIdx: number
      do { randIdx = Math.floor(Math.random() * userIds.length) } while (usedIndices.has(randIdx))
      usedIndices.add(randIdx)
      memberData.push({ leagueId, userId: userIds[randIdx], role: "MEMBER" })
    }
  }

  for (let batch = 0; batch < memberData.length; batch += BATCH_SIZE * 5) {
    const slice = memberData.slice(batch, batch + BATCH_SIZE * 5)
    await prisma.bracketLeagueMember.createMany({ data: slice, skipDuplicates: true })
    if (batch > 0 && batch % 2500 === 0) console.log(`  Added ${batch} memberships...`)
  }
  console.log(`  Done: ${memberData.length} memberships created`)

  console.log("\n--- Phase 4: Creating 1,000 bracket entries with picks ---")

  function generateBracketPicks(entryId: string): { entryId: string; nodeId: string; pickedTeamName: string; points: number; isCorrect: boolean | null }[] {
    const picks: { entryId: string; nodeId: string; pickedTeamName: string; points: number; isCorrect: boolean | null }[] = []
    const winners = new Map<string, string>()

    for (const node of r1Nodes) {
      const home = node.homeTeamName
      const away = node.awayTeamName
      if (!home || !away) continue
      const pick = Math.random() < 0.65 ? home : away
      const isHigherSeed = (node.seedHome ?? 99) < (node.seedAway ?? 99) ? home : away
      const isCorrect = Math.random() < 0.55
      winners.set(node.id, pick)
      picks.push({ entryId, nodeId: node.id, pickedTeamName: pick, points: isCorrect ? 1 : 0, isCorrect })
    }

    const pointsPerRound: Record<number, number> = { 2: 2, 3: 5, 4: 10, 5: 18, 6: 30 }
    for (let round = 2; round <= 6; round++) {
      const roundNodes = nodesByRound.get(round) || []
      for (const node of roundNodes) {
        const homeParent = [...nodes].find(n => n.nextNodeId === node.id && n.nextNodeSide === "home")
        const awayParent = [...nodes].find(n => n.nextNodeId === node.id && n.nextNodeSide === "away")

        const homeWinner = homeParent ? winners.get(homeParent.id) : node.homeTeamName
        const awayWinner = awayParent ? winners.get(awayParent.id) : node.awayTeamName

        if (!homeWinner && !awayWinner) continue

        const candidates = [homeWinner, awayWinner].filter(Boolean) as string[]
        const pick = randomFrom(candidates)
        const isCorrect = Math.random() < (0.55 - round * 0.03)
        const pts = isCorrect ? (pointsPerRound[round] || 0) : 0

        const upsetBonus = isCorrect && Math.random() < 0.2 ? Math.floor(Math.random() * 8) + 1 : 0

        winners.set(node.id, pick)
        picks.push({ entryId, nodeId: node.id, pickedTeamName: pick, points: pts + upsetBonus, isCorrect })
      }
    }

    return picks
  }

  const allPicks: { entryId: string; nodeId: string; pickedTeamName: string; points: number; isCorrect: boolean | null }[] = []
  const entryIds: string[] = []

  for (let batch = 0; batch < NUM_USERS / BATCH_SIZE; batch++) {
    const entries = []
    for (let i = 0; i < BATCH_SIZE; i++) {
      const idx = batch * BATCH_SIZE + i
      const userId = userIds[idx]
      const leagueId = leagueIds[idx % leagueIds.length]
      const id = randomUUID()
      entryIds.push(id)
      entries.push({
        id,
        leagueId,
        userId,
        name: `${generateUsername(idx)}'s Bracket`,
      })
    }
    await prisma.bracketEntry.createMany({ data: entries, skipDuplicates: true })

    for (const entry of entries) {
      const picks = generateBracketPicks(entry.id)
      allPicks.push(...picks)
    }

    if ((batch + 1) % 5 === 0) console.log(`  Created ${(batch + 1) * BATCH_SIZE} entries with picks...`)
  }

  console.log(`  Inserting ${allPicks.length} picks...`)
  for (let batch = 0; batch < allPicks.length; batch += BATCH_SIZE * 10) {
    const slice = allPicks.slice(batch, batch + BATCH_SIZE * 10)
    await prisma.bracketPick.createMany({ data: slice, skipDuplicates: true })
    if (batch > 0 && batch % 10000 === 0) console.log(`    Inserted ${batch} picks...`)
  }
  console.log(`  Done: ${entryIds.length} entries, ${allPicks.length} picks created`)

  console.log("\n--- Phase 5: Scoring verification per round ---")
  const scoringResult = await prisma.bracketPick.groupBy({
    by: ["points"],
    _count: true,
    orderBy: { points: "asc" },
  })
  console.log("  Points distribution:")
  for (const row of scoringResult) {
    console.log(`    ${row.points} pts: ${row._count} picks`)
  }

  const correctPicks = await prisma.bracketPick.count({ where: { isCorrect: true } })
  const incorrectPicks = await prisma.bracketPick.count({ where: { isCorrect: false } })
  const totalPicks = await prisma.bracketPick.count()
  console.log(`  Correct: ${correctPicks}, Incorrect: ${incorrectPicks}, Total: ${totalPicks}`)
  console.log(`  Accuracy: ${((correctPicks / totalPicks) * 100).toFixed(1)}%`)

  console.log("\n--- Phase 6: Creating 1,000 chat messages ---")
  const msgData: { leagueId: string; userId: string; message: string; type: string }[] = []
  for (let i = 0; i < NUM_MESSAGES; i++) {
    msgData.push({
      leagueId: leagueIds[i % leagueIds.length],
      userId: userIds[Math.floor(Math.random() * userIds.length)],
      message: randomFrom(CHAT_MESSAGES),
      type: "text",
    })
  }

  for (let batch = 0; batch < msgData.length; batch += BATCH_SIZE * 5) {
    const slice = msgData.slice(batch, batch + BATCH_SIZE * 5)
    await prisma.bracketLeagueMessage.createMany({ data: slice })
    if (batch > 0 && batch % 500 === 0) console.log(`  Created ${batch} messages...`)
  }
  console.log(`  Done: ${NUM_MESSAGES} chat messages created`)

  console.log("\n--- Phase 7: Creating 100 feed events (winners / busted brackets) ---")
  const feedEvents: { tournamentId: string; leagueId: string; eventType: string; headline: string; detail: string; metadata: any }[] = []

  for (let i = 0; i < NUM_WINNERS; i++) {
    const leagueId = leagueIds[i % leagueIds.length]
    const userId = userIds[i % userIds.length]
    const username = `Test User ${i}`
    const totalPoints = 50 + Math.floor(Math.random() * 120)

    feedEvents.push({
      tournamentId: TOURNAMENT_ID,
      leagueId,
      eventType: "POOL_WINNER",
      headline: `${username} wins the pool!`,
      detail: `${username} finished with ${totalPoints} FanCred EDGE points to claim the championship.`,
      metadata: { userId, totalPoints, rank: 1 },
    })

    feedEvents.push({
      tournamentId: TOURNAMENT_ID,
      leagueId,
      eventType: "BRACKET_BUSTED",
      headline: `${username}'s bracket is busted!`,
      detail: `${username}'s championship pick was eliminated. Better luck next year!`,
      metadata: { userId, eliminatedIn: randomFrom(["Sweet 16", "Elite 8", "Final Four"]) },
    })
  }

  await prisma.bracketFeedEvent.createMany({ data: feedEvents })
  console.log(`  Done: ${feedEvents.length} feed events (${NUM_WINNERS} winners + ${NUM_WINNERS} busted brackets)`)

  console.log("\n--- Phase 8: Final counts verification ---")
  const finalCounts = {
    users: await prisma.appUser.count(),
    leagues: await prisma.bracketLeague.count(),
    members: await prisma.bracketLeagueMember.count(),
    entries: await prisma.bracketEntry.count(),
    picks: await prisma.bracketPick.count(),
    messages: await prisma.bracketLeagueMessage.count(),
    feedEvents: await prisma.bracketFeedEvent.count(),
  }

  console.log("\n========================================")
  console.log("  STRESS TEST SEED COMPLETE")
  console.log("========================================")
  console.log(`  Users:        ${finalCounts.users}`)
  console.log(`  Leagues:      ${finalCounts.leagues}`)
  console.log(`  Memberships:  ${finalCounts.members}`)
  console.log(`  Entries:      ${finalCounts.entries}`)
  console.log(`  Picks:        ${finalCounts.picks}`)
  console.log(`  Messages:     ${finalCounts.messages}`)
  console.log(`  Feed Events:  ${finalCounts.feedEvents}`)
  console.log("========================================\n")

  const topScorers = await prisma.$queryRaw`
    SELECT e.id, e.name, e."userId", SUM(p.points) as total_points
    FROM "BracketEntry" e
    JOIN "BracketPick" p ON p."entryId" = e.id
    GROUP BY e.id, e.name, e."userId"
    ORDER BY total_points DESC
    LIMIT 10
  ` as any[]

  console.log("  TOP 10 LEADERBOARD:")
  for (let i = 0; i < topScorers.length; i++) {
    console.log(`    #${i + 1}: ${topScorers[i].name} - ${topScorers[i].total_points} pts`)
  }
  console.log("")
}

main()
  .catch((e) => {
    console.error("Seed error:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
