import { config } from 'dotenv'
config({ path: '.env.local' }); config({ path: '.env' })
import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
const J = (r: any) => JSON.stringify(r, null, 1)

function starters(pd: any): string[] {
  const s = pd?.starters
  return Array.isArray(s) ? s.map(String).filter((x: string) => x && x !== '0') : []
}

async function main() {
  const leagues = await p.league.findMany({
    select: { id: true, name: true, platform: true },
  })
  const byPlatform = new Map<string, { leagues: number; ids: Set<string> }>()
  for (const l of leagues) {
    const plat = String(l.platform ?? 'unknown').toLowerCase()
    const rosters = await p.roster.findMany({ where: { leagueId: l.id }, select: { playerData: true } })
    if (!rosters.length) continue
    const e = byPlatform.get(plat) ?? { leagues: 0, ids: new Set<string>() }
    e.leagues++
    for (const r of rosters) for (const id of starters(r.playerData)) e.ids.add(id)
    byPlatform.set(plat, e)
  }

  for (const [plat, e] of byPlatform) {
    const ids = [...e.ids]
    if (!ids.length) { console.log(plat, 'no starter ids'); continue }
    const rows = await p.sportsPlayer.findMany({
      where: { sleeperId: { in: ids.slice(0, 5000) } },
      select: { sleeperId: true },
    })
    const resolved = new Set(rows.map((r) => r.sleeperId))
    const descriptive = ids.filter((i) => i.startsWith('name:')).length
    const unresolved = ids.filter((i) => !resolved.has(i) && !i.startsWith('name:'))
    console.log(J({
      platform: plat,
      leaguesWithRosters: e.leagues,
      distinctStarterIds: ids.length,
      resolvedToPlayerRow: resolved.size,
      descriptiveNameIds: descriptive,
      unresolvedOpaque: unresolved.length,
      sampleUnresolved: unresolved.slice(0, 6),
    }))
  }

  // Is there ANY espn bridge?
  const espnMap = await p.playerIdentityMap.count({ where: { espnId: { not: null } } }).catch(() => -1)
  console.log('PlayerIdentityMap rows with espnId:', espnMap)
  const spEspn = await p.sportsPlayer.count({ where: { source: 'espn' } }).catch(() => -1)
  console.log('SportsPlayer rows with source=espn:', spEspn)
}
main().finally(() => p.$disconnect())
