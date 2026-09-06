/**
 * The league-free defender board, read against real data. READ-ONLY.
 *
 *   npx tsx scripts/probe-canonical-defender-board.ts
 *   npx tsx scripts/probe-canonical-defender-board.ts --redraft
 *
 * ⚠ COVERAGE IS THE POINT, NOT THE TOP OF THE BOARD. This exists to answer "how many of the 719
 * rostered defenders and kickers does this actually price", because a chart that covers the
 * famous names and nobody else has not closed the gap it was built for. The names are a sanity
 * check on the ordering; the counts are the result.
 *
 * ⚠ AND THE FLOOR SHARE IS REPORTED DELIBERATELY. `idp-curve-tail-vs-real-trades` measured 47.8%
 * of league-priced defenders sitting on one shared floor value, and concluded the disagreement
 * with the market is about ORDERING rather than spread — so do NOT read a large floor band as a
 * reason to widen the curve. It is reported so the number is visible, not so it gets tuned.
 */
import { PrismaClient } from '@prisma/client'

import { loadCanonicalDefenderBoard } from '../lib/values/canonicalDefenderBoard'

const prisma = new PrismaClient()

async function main() {
  const isDynasty = !process.argv.includes('--redraft')
  const board = await loadCanonicalDefenderBoard({ prisma, isDynasty })

  console.log(
    `reference league: ${board.reference.numTeams} teams · ${board.reference.idpStarters} IDP starters ` +
      `(${board.reference.slots.join(', ')}) · ${board.reference.scoringFormat} scoring · ` +
      `${isDynasty ? 'dynasty' : 'redraft'} curve`,
  )
  console.log(`replacement sits around defender #${board.reference.numTeams * board.reference.idpStarters + 1}`)

  if (board.skipped) {
    console.log(`\nSKIPPED: ${board.skipped} — no board produced.`)
    return
  }

  console.log(`\ncandidates (distinct sleeperIds): ${board.candidates}`)
  console.log(`admitted as defenders:            ${board.coverage?.defenders ?? 'n/a'}`)
  console.log(`projected:                        ${board.coverage?.projected ?? 'n/a'}`)
  console.log(`priced (non-null VORP):           ${board.coverage?.priced ?? 'n/a'}`)
  console.log(`carrying a value:                 ${board.valueBySleeperId.size}`)
  if (board.projectedFor) console.log(`projected for:                    ${board.projectedFor.season} wk ${board.projectedFor.week}`)

  const values = [...board.valueBySleeperId.values()]
  if (values.length === 0) {
    console.log('\nNo defender carried a value — nothing to describe.')
    return
  }
  const floor = Math.min(...values)
  const atFloor = values.filter((v) => v === floor).length
  console.log(
    `\nfloor value ${floor}: ${atFloor} of ${values.length} defenders (${((100 * atFloor) / values.length).toFixed(1)}%)`,
  )

  const ids = [...board.valueBySleeperId.keys()]
  const names = await prisma.sportsPlayer.findMany({
    where: { sleeperId: { in: ids } },
    select: { sleeperId: true, name: true, position: true, team: true },
  })
  const nameBy = new Map<string, { name: string; position: string | null; team: string | null }>()
  for (const n of names) if (n.sleeperId && !nameBy.has(n.sleeperId)) nameBy.set(n.sleeperId, n)

  const top = [...board.valueBySleeperId.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
  console.log('\ntop of the board — a sanity check on ORDERING, not a claim about exchange rate:')
  for (const [id, value] of top) {
    const m = nameBy.get(id)
    const vorp = board.vorpBySleeperId.get(id)
    console.log(
      `  ${String(value).padStart(5)}  ${String(m?.name ?? id).padEnd(24)} ` +
        `${String(m?.position ?? '?').padEnd(4)} ${String(m?.team ?? '').padEnd(4)} ` +
        `vorp ${vorp == null ? 'n/a' : vorp.toFixed(1)}`,
    )
  }
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 400) : e))
  .finally(() => prisma.$disconnect())
