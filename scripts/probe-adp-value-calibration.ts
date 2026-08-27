/**
 * Can ADP price the IDP ceiling? READ-ONLY.
 *
 *   npx tsx scripts/probe-adp-value-calibration.ts
 *
 * The IDP value ceiling is the one number in the valuation stack chosen by stance rather than
 * measurement: dynasty is 5,500 by explicit decision, redraft is 3,500 and unconfirmed, and the
 * two are inverted relative to how markets usually treat defenders. `AdpDataRecord` looked like
 * the missing anchor, because it is the ONLY source we hold that ranks defenders and offensive
 * players on one board — `PlayerValueSnapshot` contains zero defenders.
 *
 * ⚠ IT ANSWERS THE RANKING QUESTION AND NOT THE PRICING ONE, WHICH IS THE SAME WALL VORP HIT.
 * Measured 2026-08-26 on the freshest dynasty board (consensus/standard, s2026w35):
 *
 *   Spearman(ADP, FantasyCalc value) = 0.840 across 286 paired offensive players
 *
 *   ADP 1-25    n=19  median 6,428   range 1,705-11,197
 *   ADP 25-60   n=34  median 3,682   range 1,883-6,808
 *   ADP 60-120  n=44  median 2,085   range    85-5,019
 *   ADP 120-250 n=66  median 1,408   range    43-3,812
 *
 * So ADP orders trade value well and prices it terribly — a 6.5x spread inside the top band, and
 * 59x below it. Micah Parsons sits at ADP 6.6, which lands him in a band whose median is 6,428
 * and whose members run from 1,705 to 11,197. A ceiling cannot be moved on an estimate with that
 * much slack: the honest reading is that 5,500 sits inside the plausible range and slightly
 * below its centre, so the dynasty stance is defensible and mildly conservative.
 *
 * ⚠ THE REDRAFT BOARD CANNOT BE USED AT ALL, AND NOT FOR A SUBTLE REASON. Defender share by ADP
 * decile on the freshest redraft board runs 11% 99% 99% 60% 19% 57% 70% 71% 13% 1% — two
 * consecutive deciles that are almost entirely defenders. That is a block of defenders appended
 * to an offensive list, not a draft anybody held. The dynasty board interleaves properly (6% 37%
 * 40% 38% 65% 60% 57% 57% 38% 42%, first defender 6th overall), which is what a real IDP draft
 * looks like.
 *
 * Conclusion: the redraft ceiling stays a stance decision. It cannot be derived from this data.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const IDP = new Set(['LB', 'DL', 'DB', 'DE', 'DT', 'CB', 'S', 'SS', 'FS', 'EDGE'])

const norm = (s: string) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[.'’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

function spearman(a: number[], b: number[]): number {
  const rank = (x: number[]) => {
    const idx = x.map((v, i) => [v, i] as const).sort((m, n) => m[0] - n[0])
    const r = new Array<number>(x.length)
    idx.forEach(([, i], k) => (r[i] = k + 1))
    return r
  }
  const ra = rank(a)
  const rb = rank(b)
  const n = a.length
  const ma = ra.reduce((s, v) => s + v, 0) / n
  const mb = rb.reduce((s, v) => s + v, 0) / n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const x = ra[i] - ma
    const y = rb[i] - mb
    num += x * y
    da += x * x
    db += y * y
  }
  return num / Math.sqrt(da * db)
}

async function freshestSnapshot(format: string) {
  return prisma.adpDataRecord.findFirst({
    where: { sport: 'NFL', format, source: 'consensus', scoring: 'standard' },
    orderBy: { createdAt: 'desc' },
    select: { season: true, week: true, createdAt: true },
  })
}

async function main() {
  for (const format of ['dynasty', 'redraft']) {
    const snap = await freshestSnapshot(format)
    if (!snap) {
      console.log(`${format}: no snapshot`)
      continue
    }
    const rows = await prisma.adpDataRecord.findMany({
      where: {
        sport: 'NFL',
        format,
        source: 'consensus',
        scoring: 'standard',
        season: snap.season,
        week: snap.week,
      },
      select: { adp: true, position: true, playerName: true },
      orderBy: { adp: 'asc' },
    })
    const board = rows.filter((r): r is typeof r & { adp: number } => typeof r.adp === 'number')

    /*
     * Defender density by decile is the test for whether this is a draft or a concatenation.
     * A real IDP board starts nearly all offence and mixes defenders in; a merged list shows a
     * block of consecutive deciles that are almost entirely one side of the ball.
     */
    const dec = Array.from({ length: 10 }, () => ({ idp: 0, tot: 0 }))
    board.forEach((r, i) => {
      const d = Math.min(9, Math.floor((i / board.length) * 10))
      dec[d].tot++
      if (IDP.has((r.position ?? '').toUpperCase())) dec[d].idp++
    })
    const firstIdp = board.findIndex((r) => IDP.has((r.position ?? '').toUpperCase()))
    console.log(`\n${format} — freshest snapshot s${snap.season}w${snap.week}, ${board.length} players`)
    console.log(`  defender share by decile: ${dec.map((d) => `${d.tot ? Math.round((d.idp / d.tot) * 100) : 0}%`).join(' ')}`)
    console.log(`  first defender: #${firstIdp + 1} ${board[firstIdp]?.playerName} at ${board[firstIdp]?.adp}`)

    if (format !== 'dynasty') {
      console.log('  → not usable as an anchor if two consecutive deciles are near-100% defenders')
      continue
    }

    const off = board.filter(
      (r) => !IDP.has((r.position ?? '').toUpperCase()) && r.position !== 'DEF' && r.position !== 'K',
    )
    const players = await prisma.sportsPlayer.findMany({
      where: { sport: 'NFL', name: { in: off.map((r) => r.playerName) }, sleeperId: { not: null } },
      select: { sleeperId: true, name: true },
    })
    const byName = new Map<string, string>()
    for (const x of players) if (x.sleeperId && !byName.has(norm(x.name))) byName.set(norm(x.name), x.sleeperId)

    const snapshots = await prisma.playerValueSnapshot.findMany({
      where: {
        sleeperId: { in: [...byName.values()] },
        source: 'FANTASYCALC',
        format: 'DYNASTY',
        qbFormat: 'ONE_QB',
      },
      orderBy: { capturedAt: 'desc' },
      select: { sleeperId: true, value: true },
    })
    const value = new Map<string, number>()
    for (const r of snapshots) if (!value.has(r.sleeperId)) value.set(r.sleeperId, r.value)

    const pairs: Array<[number, number]> = []
    for (const r of off) {
      const sid = byName.get(norm(r.playerName))
      if (!sid) continue
      const v = value.get(sid)
      if (v == null) continue
      pairs.push([r.adp, v])
    }

    console.log(`  paired offensive players: ${pairs.length}`)
    if (pairs.length < 20) {
      console.log('  → too few pairs to say anything')
      continue
    }
    // Negated so that a LOWER adp lining up with a HIGHER value reads as a positive correlation.
    const rho = spearman(pairs.map((x) => x[0]), pairs.map((x) => -x[1]))
    console.log(`  Spearman(ADP, value) = ${rho.toFixed(3)}`)
    for (const [lo, hi] of [
      [1, 25],
      [25, 60],
      [60, 120],
      [120, 250],
    ]) {
      const b = pairs.filter((x) => x[0] >= lo && x[0] < hi).map((x) => x[1]).sort((a, c) => a - c)
      if (b.length > 3) {
        console.log(
          `    ADP ${lo}-${hi}: n=${b.length} median=${b[Math.floor(b.length / 2)]} range ${b[0]}-${b[b.length - 1]}`,
        )
      }
    }
    console.log('  → ranks well, prices badly. The spread inside a band is wider than the')
    console.log('    difference between the ceilings under discussion, so it cannot move one.')
  }
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 400) : e))
  .finally(() => prisma.$disconnect())
