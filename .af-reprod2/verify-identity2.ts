import { config } from 'dotenv'
config({ path: '.env.local' }); config({ path: '.env' })
import { createRequire } from 'node:module'
const req = createRequire(__filename)
req.cache[req.resolve('server-only')] = {
  id: req.resolve('server-only'), filename: req.resolve('server-only'), loaded: true, exports: {},
} as unknown as NodeModule

async function main() {
  const { identityGapNote } = await import('../lib/core-app/identityGap')
  console.log('--- unit: the three states + the silences ---')
  const cases = [
    ['espn none named',   { platform: 'espn', total: 8, named: 0, priced: 0 }],
    ['espn all named/0 priced', { platform: 'espn', total: 8, named: 8, priced: 0 }],
    ['sleeper all named/0 priced', { platform: 'sleeper', total: 10, named: 10, priced: 0 }],
    ['sleeper healthy',   { platform: 'sleeper', total: 10, named: 10, priced: 10 }],
    ['sleeper 1 unpriced (must be SILENT)', { platform: 'sleeper', total: 10, named: 10, priced: 9 }],
    ['partial named',     { platform: 'sleeper', total: 10, named: 7, priced: 7 }],
    ['nothing attempted', { platform: 'espn', total: 0, named: 0, priced: 0 }],
  ] as const
  for (const [label, c] of cases) {
    const n = identityGapNote(c as any)
    console.log(`  ${label}: ${n ? n.slice(0, 90) + '…' : 'SILENT'}`)
  }

  const { prisma } = await import('../lib/prisma')
  const { getMyTeamData } = await import('../lib/core-app/myTeam')
  console.log('\n--- live ---')
  for (const plat of ['espn', 'sleeper']) {
    const t = await prisma.leagueTeam.findFirst({
      where: { claimedByUserId: { not: null }, league: { platform: plat } },
      select: { leagueId: true, claimedByUserId: true, league: { select: { name: true } } },
    })
    if (!t?.claimedByUserId) continue
    const d = await getMyTeamData(t.leagueId, t.claimedByUserId)
    const sl = d?.starters.available ? d.starters.data : []
    const filled = sl.filter((s) => !s.empty)
    console.log(`  [${plat}] ${t.league?.name}: filled=${filled.length} named=${filled.filter((s) => s.player).length} priced=${filled.filter((s) => s.player?.afProjectedPoints != null).length} benchChecks=${sl.filter((s) => s.benchCheck).length}`)
    console.log(`    note: ${d?.identityNote ?? 'SILENT'}`)
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error('ERR', e); process.exit(1) })
