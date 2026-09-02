import { config } from 'dotenv'
config({ path: '.env.local' }); config({ path: '.env' })
import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

function starters(pd: any): string[] {
  const s = pd?.starters
  return Array.isArray(s) ? s.map(String).filter((x: string) => x && x !== '0') : []
}

async function main() {
  const espn = await p.league.findMany({ where: { platform: 'espn' }, select: { id: true } })
  const ids = new Set<string>()
  for (const l of espn) {
    const rosters = await p.roster.findMany({ where: { leagueId: l.id }, select: { playerData: true } })
    for (const r of rosters) for (const i of starters(r.playerData)) ids.add(i)
  }
  const all = [...ids]
  const hits = await p.sportsPlayer.findMany({
    where: { externalId: { in: all } },
    select: { externalId: true, name: true, position: true, team: true, sport: true, source: true, sleeperId: true },
  })
  console.log('externalId hits:', hits.length)
  const bySport: Record<string, number> = {}
  for (const h of hits) bySport[String(h.sport)] = (bySport[String(h.sport)] ?? 0) + 1
  console.log('by sport:', JSON.stringify(bySport))
  console.log(JSON.stringify(hits.slice(0, 12), null, 1))
}
main().finally(() => p.$disconnect())
