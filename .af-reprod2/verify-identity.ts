import { config } from 'dotenv'
config({ path: '.env.local' }); config({ path: '.env' })
import { createRequire } from 'node:module'
const req = createRequire(__filename)
req.cache[req.resolve('server-only')] = {
  id: req.resolve('server-only'), filename: req.resolve('server-only'), loaded: true, exports: {},
} as unknown as NodeModule

async function main() {
  const { prisma } = await import('../lib/prisma')
  const { getMyTeamData } = await import('../lib/core-app/myTeam')
  const { getMatchupData } = await import('../lib/core-app/matchup')

  for (const plat of ['espn', 'sleeper', 'manual']) {
    const team = await prisma.leagueTeam.findFirst({
      where: { claimedByUserId: { not: null }, league: { platform: plat } },
      select: { leagueId: true, claimedByUserId: true, league: { select: { name: true } } },
    })
    if (!team?.claimedByUserId) { console.log(`\n[${plat}] no claimed team`); continue }
    const uid = team.claimedByUserId
    const mt = await getMyTeamData(team.leagueId, uid).catch((e) => { console.log('myTeam err', e.message); return null })
    const mu = await getMatchupData(team.leagueId, uid).catch((e) => { console.log('matchup err', e.message); return null })
    console.log(`\n=== [${plat}] ${team.league?.name} ===`)
    if (mt) {
      const slots = mt.starters.available ? mt.starters.data : []
      const filled = slots.filter((s) => !s.empty)
      console.log(`  myTeam slots=${slots.length} filled=${filled.length} named=${filled.filter((s) => s.player).length}`)
      console.log(`  benchChecks=${slots.filter((s) => s.benchCheck).length}`)
      console.log(`  identityNote: ${mt.identityNote ?? 'null'}`)
    }
    if (mu) {
      const ln = mu.lineups.available ? mu.lineups.data : []
      const you = ln.filter((s) => s.you && !s.you.empty)
      console.log(`  matchup slots=${ln.length} yourFilled=${you.length} named=${you.filter((s) => s.you!.name).length}`)
      console.log(`  identityNote: ${mu.identityNote ?? 'null'}`)
    }
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error('ERR', e); process.exit(1) })
