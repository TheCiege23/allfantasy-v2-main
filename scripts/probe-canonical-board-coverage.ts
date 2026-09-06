/**
 * Does the canonical board close the gap it was built for? READ-ONLY.
 *
 *   npx tsx scripts/probe-canonical-board-coverage.ts
 *
 * 🛑 "IT PRICES 724 DEFENDERS" IS NOT THE ANSWER. The gap is 628 rostered defenders with no
 * league-free price, so the only figure that settles it is how many of THOSE the board reaches.
 * A chart covering 724 players who are mostly not rostered has not closed anything — and a board
 * measured against its own output rather than against the need is the shape of a check that
 * cannot fail.
 */
import { PrismaClient } from '@prisma/client'

import { loadCanonicalDefenderBoard } from '../lib/values/canonicalDefenderBoard'

const prisma = new PrismaClient()

const IDP = ['LB', 'ILB', 'OLB', 'DL', 'DE', 'DT', 'NT', 'DB', 'CB', 'S', 'SS', 'FS']

async function main() {
  const board = await loadCanonicalDefenderBoard({ prisma, isDynasty: true })

  const rostered = await prisma.redraftRosterPlayer.findMany({
    where: { droppedAt: null, sport: 'NFL', position: { in: IDP } },
    select: { playerId: true, playerName: true, position: true },
  })
  const distinct = new Map<string, { playerName: string; position: string }>()
  for (const r of rostered) if (!distinct.has(r.playerId)) distinct.set(r.playerId, r)

  let priced = 0
  const unpriced: Array<{ name: string; pos: string }> = []
  for (const [id, meta] of distinct) {
    if (board.valueBySleeperId.has(id)) priced++
    else unpriced.push({ name: meta.playerName, pos: meta.position })
  }

  console.log(`ROSTERED DEFENDERS (the population the gap is about)`)
  console.log(`  distinct rostered: ${distinct.size}`)
  console.log(`  priced by board:   ${priced}   (${((100 * priced) / distinct.size).toFixed(1)}%)`)
  console.log(`  still unpriced:    ${unpriced.length}`)

  const byPos = new Map<string, number>()
  for (const u of unpriced) byPos.set(u.pos, (byPos.get(u.pos) ?? 0) + 1)
  console.log(`  unpriced by position: ${[...byPos].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  ')}`)
  console.log(`  a sample of the unpriced: ${unpriced.slice(0, 8).map((u) => u.name).join(', ')}`)

  /* How much of the board actually discriminates, rather than sharing the floor. */
  const values = [...board.valueBySleeperId.values()]
  const floor = Math.min(...values)
  const above = values.filter((v) => v > floor).length
  console.log(`\nDISCRIMINATING RANGE`)
  console.log(`  above the floor: ${above} of ${values.length}`)
  console.log(`  at the floor:    ${values.length - above}`)
  console.log(
    `  NOTE: ${board.reference.numTeams} x ${board.reference.idpStarters} = ` +
      `${board.reference.numTeams * board.reference.idpStarters} starting slots, so most of a ` +
      `${values.length}-deep pool is genuinely below replacement. That is arithmetic, not a curve defect.`,
  )
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 400) : e))
  .finally(() => prisma.$disconnect())
