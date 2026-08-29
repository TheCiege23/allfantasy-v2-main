/**
 * READ-ONLY. Does the devy board's second opinion actually fire, and how much do the two
 * orderings disagree in production? Never writes.
 *
 * The question it answers: Fantrax NCAAF ADP is real draft behaviour, the scouting composite
 * is derived. They agree only weakly (Spearman 0.380), so the board reports the disagreement
 * rather than averaging it. This shows what a manager would actually be told.
 */
import { PrismaClient } from '@prisma/client'
import { buildDevyValueBoard } from '../lib/devy/devyValueBoard'

const prisma = new PrismaClient()

async function main() {
  const players = await prisma.devyPlayer.findMany({
    where: { graduatedToNFL: false },
    select: {
      id: true, name: true, position: true, school: true,
      draftEligibleYear: true, classYear: true, draftProjectionScore: true,
      recruitingComposite: true, breakoutAge: true, projectedDraftRound: true, devyAdp: true,
    },
  })
  const season = new Date().getUTCFullYear()
  const board = buildDevyValueBoard(players, season)

  console.log(`pool=${players.length} ranked=${board.ranked} unranked=${board.unranked}`)
  console.log(`coverage=${(board.coverage * 100).toFixed(1)}%  adpCoverage=${board.adpCoverage}  contested=${board.contested}`)

  const withCorr = board.entries.filter((e) => e.corroboration != null)
  const byConf = new Map<string, number>()
  for (const e of withCorr) byConf.set(e.corroboration!.confidence, (byConf.get(e.corroboration!.confidence) ?? 0) + 1)
  console.log(`\ncorroborated pool = ${withCorr.length}`)
  for (const [k, v] of [...byConf.entries()].sort()) console.log(`  ${k.padEnd(14)} ${v}`)

  console.log('\ntop of the board (value order):')
  for (const e of board.entries.slice(0, 6)) {
    console.log(
      `  ${String(e.name).padEnd(22)} ${String(e.position).padEnd(3)} ` +
        `globalScout=${String(e.devyRank).padStart(4)} ` +
        /* Like-for-like: both over the rated pool. See DevyCorroboration. */
        `inPool(scout/adp)=${String(e.corroboration?.scoutRankInPool ?? '-').padStart(3)}/${String(e.corroboration?.adpRankInPool ?? '-').padStart(3)} ` +
        `value=${String(e.value.value ?? '-').padStart(5)} ${e.corroboration?.confidence ?? 'uncorroborated'}`,
    )
  }

  const contested = withCorr
    .filter((e) => e.corroboration!.confidence === 'contested')
    .sort((a, b) => b.corroboration!.rankGap - a.corroboration!.rankGap)
    .slice(0, 4)
  console.log('\nmost contested (what a manager gets told):')
  for (const e of contested) console.log(`  ${e.corroboration!.note}`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
