/** READ-ONLY. Does the ESPN matchup board resolve now? Delete after use. */
import { prisma } from '@/lib/prisma'
import { getMatchupData } from '@/lib/core-app/matchup'
async function main() {
  const teams = await prisma.leagueTeam.findMany({
    where: { claimedByUserId: { not: null }, league: { platform: { equals: 'espn', mode: 'insensitive' } } },
    select: { leagueId: true, claimedByUserId: true, league: { select: { name: true } } }, take: 3,
  })
  for (const t of teams) {
    const d = await getMatchupData(t.leagueId, t.claimedByUserId as string).catch((e) => {
      console.log('THREW:', String(e).slice(0, 160)); return null })
    if (!d) { console.log(`${t.league?.name}: null`); continue }
    if (!d.lineups.available) { console.log(`${d.league.name}: lineups unavailable — ${d.lineups.reason}`); continue }
    const slots = d.lineups.data
    const cells = slots.flatMap((s) => [s.you, s.opponent]).filter(Boolean) as any[]
    const named = cells.filter((c) => c.name != null && !c.empty).length
    const priced = cells.filter((c) => c.projected != null).length
    const empty = cells.filter((c) => c.empty).length
    console.log(`\n${d.league.name}: cells=${cells.length} named=${named} priced=${priced} empty=${empty}`)
    console.log('  identityNote:', (d as any).identityNote ?? '(none)')
    for (const s of slots.slice(0, 5)) {
      const f = (c: any) => c ? `${(c.name ?? 'UNRESOLVED').slice(0,18).padEnd(18)}${c.position ?? '-'} ${c.projected ?? '-'}` : '(none)'
      console.log(`   ${String(s.slotLabel).padEnd(10)} | ${f(s.you)} | ${f(s.opponent)}`)
    }
  }
}
main().catch((e) => { console.error('FAILED:', String(e).slice(0,300)); process.exitCode = 1 }).finally(() => prisma.$disconnect())
