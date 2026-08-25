/**
 * READ-ONLY. What shape does the market's value-by-position-rank curve actually have?
 *
 * The IDP tier ladder is hand-built and its top rung is FLAT: ranks 1, 2 and 3 all price at
 * 5,500, which says the best linebacker in the league is worth exactly what the third-best is.
 * No real market looks like that. Rather than invent a gradient, this measures the decay of
 * the one market we do hold — FantasyCalc, on offensive players — so the ladder's SHAPE can be
 * taken from data while its ceiling stays a product decision.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  for (const [format, qbFormat] of [
    ['REDRAFT', 'ONE_QB'],
    ['DYNASTY', 'ONE_QB'],
  ] as const) {
    const latest = await prisma.playerValueSnapshot.aggregate({
      where: { source: 'FANTASYCALC', format, qbFormat },
      _max: { capturedAt: true },
    })
    const rows = await prisma.playerValueSnapshot.findMany({
      where: { source: 'FANTASYCALC', format, qbFormat, capturedAt: latest._max.capturedAt! },
      select: { position: true, value: true, name: true },
    })
    console.log(`\n=== ${format} ${qbFormat} — ${rows.length} rows ===`)

    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      const sorted = rows
        .filter((r) => (r.position ?? '').toUpperCase() === pos)
        .sort((a, b) => b.value - a.value)
      if (sorted.length < 40) continue
      const top = sorted[0].value
      const at = (r: number) => (sorted[r - 1] ? sorted[r - 1].value / top : null)
      const fmt = (v: number | null) => (v == null ? '  —  ' : v.toFixed(3))
      console.log(
        `  ${pos}  n=${String(sorted.length).padStart(3)}  ` +
          `r1 ${fmt(at(1))}  r2 ${fmt(at(2))}  r3 ${fmt(at(3))}  r5 ${fmt(at(5))}  ` +
          `r8 ${fmt(at(8))}  r15 ${fmt(at(15))}  r25 ${fmt(at(25))}  r40 ${fmt(at(40))}`,
      )
    }

    /*
     * Pooled decay, normalised per position so positions with different absolute levels can be
     * averaged. This is the curve the IDP ladder should borrow.
     */
    const RANKS = [1, 2, 3, 5, 8, 15, 25, 40, 60, 90, 130]
    const acc = new Map<number, number[]>()
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      const sorted = rows
        .filter((r) => (r.position ?? '').toUpperCase() === pos)
        .sort((a, b) => b.value - a.value)
      if (sorted.length < 40) continue
      const top = sorted[0].value
      for (const r of RANKS) {
        const v = sorted[r - 1]
        if (!v) continue
        const arr = acc.get(r) ?? []
        arr.push(v.value / top)
        acc.set(r, arr)
      }
    }
    console.log('  pooled decay (share of the position-1 value):')
    const parts: string[] = []
    for (const r of RANKS) {
      const a = acc.get(r)
      if (!a || a.length === 0) continue
      const mean = a.reduce((x, y) => x + y, 0) / a.length
      parts.push(`r${r}=${mean.toFixed(3)}`)
    }
    console.log('    ' + parts.join('  '))
  }

  // The very top, spelled out — this is the flatness the ladder gets wrong.
  const latest = await prisma.playerValueSnapshot.aggregate({
    where: { source: 'FANTASYCALC', format: 'REDRAFT', qbFormat: 'ONE_QB' },
    _max: { capturedAt: true },
  })
  const rb = (
    await prisma.playerValueSnapshot.findMany({
      where: {
        source: 'FANTASYCALC',
        format: 'REDRAFT',
        qbFormat: 'ONE_QB',
        position: 'RB',
        capturedAt: latest._max.capturedAt!,
      },
      select: { name: true, value: true },
    })
  ).sort((a, b) => b.value - a.value)
  console.log('\ntop of the RB board, where the ladder says "all equal":')
  rb.slice(0, 5).forEach((r, i) => console.log(`  RB${i + 1} ${r.name.padEnd(22)} ${r.value}`))
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 300) : e))
  .finally(() => prisma.$disconnect())
