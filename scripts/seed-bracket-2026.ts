import { randomUUID } from 'crypto'
import { prisma } from '../lib/prisma'
import { assertSafeSeedTarget } from './_assert-safe-seed-target'

const REGIONS = ['East', 'West', 'South', 'Midwest'] as const

const TEAMS: Record<string, Array<{ seed: number; name: string }>> = {
  East: [
    { seed: 1, name: 'Duke' },
    { seed: 16, name: 'Norfolk State' },
    { seed: 8, name: 'Wisconsin' },
    { seed: 9, name: 'Drake' },
    { seed: 5, name: 'Marquette' },
    { seed: 12, name: 'UC San Diego' },
    { seed: 4, name: 'Kentucky' },
    { seed: 13, name: 'Vermont' },
    { seed: 6, name: 'Illinois' },
    { seed: 11, name: 'Xavier' },
    { seed: 3, name: 'Tennessee' },
    { seed: 14, name: 'Colgate' },
    { seed: 7, name: 'Clemson' },
    { seed: 10, name: 'New Mexico' },
    { seed: 2, name: 'Purdue' },
    { seed: 15, name: 'Bryant' },
  ],
  West: [
    { seed: 1, name: 'Arizona' },
    { seed: 16, name: 'Grambling' },
    { seed: 8, name: 'Cincinnati' },
    { seed: 9, name: 'VCU' },
    { seed: 5, name: 'Texas Tech' },
    { seed: 12, name: 'James Madison' },
    { seed: 4, name: 'Oregon' },
    { seed: 13, name: 'High Point' },
    { seed: 6, name: 'San Diego State' },
    { seed: 11, name: 'Texas' },
    { seed: 3, name: 'Iowa State' },
    { seed: 14, name: 'Lipscomb' },
    { seed: 7, name: 'Florida Atlantic' },
    { seed: 10, name: 'Oklahoma' },
    { seed: 2, name: 'Nebraska' },
    { seed: 15, name: 'Morehead State' },
  ],
  South: [
    { seed: 1, name: 'Michigan' },
    { seed: 16, name: 'Alabama State' },
    { seed: 8, name: 'Louisville' },
    { seed: 9, name: 'Creighton' },
    { seed: 5, name: 'Memphis' },
    { seed: 12, name: 'Colorado State' },
    { seed: 4, name: 'Texas A&M' },
    { seed: 13, name: 'Yale' },
    { seed: 6, name: 'Ole Miss' },
    { seed: 11, name: 'North Carolina' },
    { seed: 3, name: 'Alabama' },
    { seed: 14, name: 'SIU Edwardsville' },
    { seed: 7, name: 'Baylor' },
    { seed: 10, name: 'Arkansas' },
    { seed: 2, name: 'Michigan State' },
    { seed: 15, name: 'McNeese' },
  ],
  Midwest: [
    { seed: 1, name: 'UConn' },
    { seed: 16, name: "Mount St. Mary's" },
    { seed: 8, name: 'Kansas' },
    { seed: 9, name: 'Connecticut' },
    { seed: 5, name: 'St. John\'s' },
    { seed: 12, name: 'Bradley' },
    { seed: 4, name: 'Houston' },
    { seed: 13, name: 'McNeese State' },
    { seed: 6, name: 'Missouri' },
    { seed: 11, name: 'UCLA' },
    { seed: 3, name: 'Kansas State' },
    { seed: 14, name: 'Omaha' },
    { seed: 7, name: 'Gonzaga' },
    { seed: 10, name: 'Mississippi State' },
    { seed: 2, name: 'Florida' },
    { seed: 15, name: 'Boise State' },
  ],
}

type NodeInsert = {
  tournamentId: string
  round: number
  region: string | null
  slot: string
  seedHome: number | null
  seedAway: number | null
  homeTeamName: string | null
  awayTeamName: string | null
  nextNodeId: string | null
  nextNodeSide: string | null
}

async function seed() {
  // Fail closed before the first write — see scripts/_assert-safe-seed-target.ts.
  assertSafeSeedTarget('seed-bracket-2026')

  console.log('Seeding 2026 bracket nodes...')

  const tournament = await (prisma as any).bracketTournament.findUnique({
    where: { sport_season: { sport: 'ncaam', season: 2026 } },
    select: { id: true },
  })
  if (!tournament) {
    console.error('No tournament found for ncaam/2026. Create one first.')
    process.exit(1)
  }
  const TOURNAMENT_ID = tournament.id

  const existing = await (prisma as any).bracketNode.count({ where: { tournamentId: TOURNAMENT_ID } })
  if (existing > 0) {
    console.log(`Already have ${existing} nodes for this tournament. Deleting and re-seeding...`)
    await (prisma as any).bracketNode.deleteMany({ where: { tournamentId: TOURNAMENT_ID } })
  }

  const allNodes: Array<NodeInsert & { id: string }> = []

  function makeId() {
    return randomUUID()
  }

  for (const region of REGIONS) {
    const teams = TEAMS[region]
    const r1Matchups = [
      [teams[0], teams[1]],
      [teams[2], teams[3]],
      [teams[4], teams[5]],
      [teams[6], teams[7]],
      [teams[8], teams[9]],
      [teams[10], teams[11]],
      [teams[12], teams[13]],
      [teams[14], teams[15]],
    ]

    const r1Nodes: string[] = []
    for (let i = 0; i < 8; i++) {
      const id = makeId()
      r1Nodes.push(id)
      allNodes.push({
        id,
        tournamentId: TOURNAMENT_ID,
        round: 1,
        region,
        slot: `R1-${region}-${i + 1}`,
        seedHome: r1Matchups[i][0].seed,
        seedAway: r1Matchups[i][1].seed,
        homeTeamName: r1Matchups[i][0].name,
        awayTeamName: r1Matchups[i][1].name,
        nextNodeId: null,
        nextNodeSide: null,
      })
    }

    const r2Nodes: string[] = []
    for (let i = 0; i < 4; i++) {
      const id = makeId()
      r2Nodes.push(id)
      allNodes.push({
        id,
        tournamentId: TOURNAMENT_ID,
        round: 2,
        region,
        slot: `R2-${region}-${i + 1}`,
        seedHome: null,
        seedAway: null,
        homeTeamName: null,
        awayTeamName: null,
        nextNodeId: null,
        nextNodeSide: null,
      })
      const topChild = allNodes.find(n => n.id === r1Nodes[i * 2])!
      topChild.nextNodeId = id
      topChild.nextNodeSide = 'home'
      const bottomChild = allNodes.find(n => n.id === r1Nodes[i * 2 + 1])!
      bottomChild.nextNodeId = id
      bottomChild.nextNodeSide = 'away'
    }

    const s16Nodes: string[] = []
    for (let i = 0; i < 2; i++) {
      const id = makeId()
      s16Nodes.push(id)
      allNodes.push({
        id,
        tournamentId: TOURNAMENT_ID,
        round: 3,
        region,
        slot: `S16-${region}-${i + 1}`,
        seedHome: null,
        seedAway: null,
        homeTeamName: null,
        awayTeamName: null,
        nextNodeId: null,
        nextNodeSide: null,
      })
      const topChild = allNodes.find(n => n.id === r2Nodes[i * 2])!
      topChild.nextNodeId = id
      topChild.nextNodeSide = 'home'
      const bottomChild = allNodes.find(n => n.id === r2Nodes[i * 2 + 1])!
      bottomChild.nextNodeId = id
      bottomChild.nextNodeSide = 'away'
    }

    const e8Id = makeId()
    allNodes.push({
      id: e8Id,
      tournamentId: TOURNAMENT_ID,
      round: 4,
      region,
      slot: `E8-${region}`,
      seedHome: null,
      seedAway: null,
      homeTeamName: null,
      awayTeamName: null,
      nextNodeId: null,
      nextNodeSide: null,
    })
    const s16Top = allNodes.find(n => n.id === s16Nodes[0])!
    s16Top.nextNodeId = e8Id
    s16Top.nextNodeSide = 'home'
    const s16Bottom = allNodes.find(n => n.id === s16Nodes[1])!
    s16Bottom.nextNodeId = e8Id
    s16Bottom.nextNodeSide = 'away'
  }

  const e8Nodes = allNodes.filter(n => n.round === 4)

  const ff1Id = makeId()
  allNodes.push({
    id: ff1Id,
    tournamentId: TOURNAMENT_ID,
    round: 5,
    region: null,
    slot: 'FF-1',
    seedHome: null,
    seedAway: null,
    homeTeamName: null,
    awayTeamName: null,
    nextNodeId: null,
    nextNodeSide: null,
  })
  const eastE8 = e8Nodes.find(n => n.slot === 'E8-East')!
  eastE8.nextNodeId = ff1Id
  eastE8.nextNodeSide = 'home'
  const westE8 = e8Nodes.find(n => n.slot === 'E8-West')!
  westE8.nextNodeId = ff1Id
  westE8.nextNodeSide = 'away'

  const ff2Id = makeId()
  allNodes.push({
    id: ff2Id,
    tournamentId: TOURNAMENT_ID,
    round: 5,
    region: null,
    slot: 'FF-2',
    seedHome: null,
    seedAway: null,
    homeTeamName: null,
    awayTeamName: null,
    nextNodeId: null,
    nextNodeSide: null,
  })
  const southE8 = e8Nodes.find(n => n.slot === 'E8-South')!
  southE8.nextNodeId = ff2Id
  southE8.nextNodeSide = 'home'
  const midwestE8 = e8Nodes.find(n => n.slot === 'E8-Midwest')!
  midwestE8.nextNodeId = ff2Id
  midwestE8.nextNodeSide = 'away'

  const champId = makeId()
  allNodes.push({
    id: champId,
    tournamentId: TOURNAMENT_ID,
    round: 6,
    region: null,
    slot: 'CHAMP',
    seedHome: null,
    seedAway: null,
    homeTeamName: null,
    awayTeamName: null,
    nextNodeId: null,
    nextNodeSide: null,
  })
  const ff1 = allNodes.find(n => n.id === ff1Id)!
  ff1.nextNodeId = champId
  ff1.nextNodeSide = 'home'
  const ff2 = allNodes.find(n => n.id === ff2Id)!
  ff2.nextNodeId = champId
  ff2.nextNodeSide = 'away'

  console.log(`Inserting ${allNodes.length} bracket nodes...`)

  for (const node of allNodes) {
    await (prisma as any).bracketNode.create({ data: node })
  }

  console.log('Done! Bracket summary:')
  console.log(`  Round 1 (Round of 64): ${allNodes.filter(n => n.round === 1).length} games`)
  console.log(`  Round 2 (Round of 32): ${allNodes.filter(n => n.round === 2).length} games`)
  console.log(`  Round 3 (Sweet 16):    ${allNodes.filter(n => n.round === 3).length} games`)
  console.log(`  Round 4 (Elite 8):     ${allNodes.filter(n => n.round === 4).length} games`)
  console.log(`  Round 5 (Final Four):  ${allNodes.filter(n => n.round === 5).length} games`)
  console.log(`  Round 6 (Championship):${allNodes.filter(n => n.round === 6).length} game`)
  console.log(`  Total: ${allNodes.length} nodes`)

  await prisma.$disconnect()
}

seed().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
