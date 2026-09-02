import { config } from 'dotenv'
config({ path: '.env.local' }); config({ path: '.env' })
import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

function starters(pd: any): string[] {
  const s = pd?.starters
  return Array.isArray(s) ? s.map(String).filter((x: string) => x && x !== '0') : []
}

async function main() {
  const espn = await p.league.findMany({ where: { platform: 'espn' }, select: { id: true, name: true } })
  const ids = new Set<string>()
  for (const l of espn) {
    const rosters = await p.roster.findMany({ where: { leagueId: l.id }, select: { playerData: true } })
    for (const r of rosters) for (const i of starters(r.playerData)) ids.add(i)
  }
  const all = [...ids]
  console.log('espn leagues:', espn.length, 'distinct starter ids:', all.length)

  const viaMap = await p.playerIdentityMap.findMany({
    where: { espnId: { in: all } },
    select: { espnId: true, sleeperId: true, fullName: true },
  }).catch((e) => { console.log('map query failed:', e.message.slice(0, 120)); return [] as any[] })
  console.log('bridged via PlayerIdentityMap.espnId:', viaMap.length, '/', all.length)
  console.log('sample:', JSON.stringify(viaMap.slice(0, 5)))

  // Any other column anywhere holding these ids?
  const spExternal = await p.sportsPlayer.count({ where: { externalId: { in: all } } }).catch(() => -1)
  console.log('SportsPlayer.externalId matches:', spExternal)
  const playerExternal = await p.player.count({ where: { externalId: { in: all } } }).catch(() => -1)
  console.log('Player.externalId matches:', playerExternal)

  // What DOES the espn league's LeagueTeam/roster carry for names?
  const lt = await p.leagueTeam.findMany({
    where: { leagueId: { in: espn.map((e) => e.id) } },
    select: { teamName: true, ownerName: true },
    take: 4,
  })
  console.log('espn LeagueTeam sample:', JSON.stringify(lt))
}
main().finally(() => p.$disconnect())
