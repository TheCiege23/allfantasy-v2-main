/**
 * READ-ONLY. Solve the draft-pick curve from what managers actually paid. Never writes.
 *
 * THE PROBLEM. Five pick curves live in this repo and they disagree by construction. As a
 * share of a first-round pick, a second is worth 0.735 in `redraft/tradeBuilderAnalysis`,
 * 0.650 in `pick-valuation`, 0.600 in `engine/utv`, 0.480 in `trade-value/valueEngine` and
 * 0.277 in `dynasty-tiers` — a 2.7x spread, and 4.6x by the third round. Every dynasty trade
 * verdict inherits whichever curve the caller happened to import.
 *
 * WHY NOT JUST PICK ONE. Because that is choosing a favourite, and nothing distinguishes them
 * except who wrote them. The market cannot settle it either: the ingested FantasyCalc board
 * carries 398 rows and not one is a pick — only RB, WR, TE and QB.
 *
 * THE SOLVE. Offensive players DO have an independent market price, and trades now carry their
 * contents. For one side of a trade:
 *
 *     O = market value received − market value given        (players, known)
 *     x_r = picks received − picks given, in round r        (known counts)
 *
 * If the trade is fair, the two sides cancel: O + Σ_r v_r · x_r ≈ 0. That is one linear
 * equation per trade in five unknowns, and thousands of trades over-determine it. Least
 * squares gives the round values in the SAME UNITS as the player market, which is exactly the
 * property none of the five hand-built curves has.
 *
 * ⚠ IT ASSUMES TRADES ARE FAIR ON AVERAGE. Both sides accepted, so neither believed they were
 * being robbed, but managers disagree and a league with one shark tilts its sample. The
 * residual spread is reported so a tidy answer cannot be mistaken for a precise one.
 */
import { PrismaClient } from '@prisma/client'

import { hasIdpScoring, isIdpPosition } from '../lib/core-app/scoringNotes'
import { extractScoringSettings } from '../lib/projections/leagueScoring'

const prisma = new PrismaClient()

const MIN_SEASON = Number(process.argv[2] ?? 2024)
const MAX_ROUND = 5
/** Picks further out than this are dropped: their discount is a second unknown. */
const MAX_YEARS_OUT = 2

function slots(settings: unknown): string[] {
  const s = (settings ?? {}) as Record<string, unknown>
  const raw = (s.roster_positions as unknown) ?? (s.rosterPositions as unknown)
  return Array.isArray(raw) ? raw.map((x) => String(x).toUpperCase()) : []
}
function qbFormat(starters: string[]): 'ONE_QB' | 'SUPERFLEX' {
  if (starters.some((s) => s.includes('SUPER_FLEX') || s === 'SUPERFLEX' || s === 'SF')) return 'SUPERFLEX'
  return starters.filter((s) => s === 'QB').length > 1 ? 'SUPERFLEX' : 'ONE_QB'
}

/** Solve A·v = b by normal equations with Gaussian elimination. Small and dense; no deps. */
function leastSquares(rows: number[][], targets: number[], n: number): number[] | null {
  const ata = Array.from({ length: n }, () => new Array(n).fill(0))
  const atb = new Array(n).fill(0)
  for (let k = 0; k < rows.length; k++) {
    for (let i = 0; i < n; i++) {
      atb[i] += rows[k][i] * targets[k]
      for (let j = 0; j < n; j++) ata[i][j] += rows[k][i] * rows[k][j]
    }
  }
  // Ridge term: without it a round that barely appears makes the system singular.
  for (let i = 0; i < n; i++) ata[i][i] += 1e-6

  const m = ata.map((r, i) => [...r, atb[i]])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r
    if (Math.abs(m[piv][col]) < 1e-9) return null
    ;[m[col], m[piv]] = [m[piv], m[col]]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = m[r][col] / m[col][col]
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c]
    }
  }
  return m.map((r, i) => r[n] / m[i][i])
}

async function main() {
  const leagues = await prisma.league.findMany({
    select: { id: true, name: true, settings: true, leagueType: true },
  })

  const rows: number[][] = []
  const targets: number[] = []
  const why = { noPicks: 0, unpriced: 0, idpInvolved: 0, farFuture: 0, noPlayers: 0 }
  let tradesSeen = 0

  for (const league of leagues) {
    const isDynasty = (league.leagueType ?? '').toLowerCase().includes('dynasty')
    if (!isDynasty) continue
    const starters = slots(league.settings)
    const leagueIsIdp = hasIdpScoring(extractScoringSettings(league.settings))

    const facts = await prisma.transactionFact.findMany({
      where: { leagueId: league.id, type: 'trade', season: { gte: MIN_SEASON } },
      select: { payload: true, season: true },
    })
    if (facts.length === 0) continue

    const ids = new Set<string>()
    for (const f of facts) {
      const pl = (f.payload ?? {}) as any
      for (const k of ['playersInIds', 'playersOutIds']) {
        if (Array.isArray(pl[k])) for (const id of pl[k]) if (typeof id === 'string') ids.add(id)
      }
    }
    if (ids.size === 0) continue

    const players = await prisma.sportsPlayer.findMany({
      where: { sleeperId: { in: [...ids] } },
      select: { sleeperId: true, position: true },
    })
    const posOf = new Map<string, string | null>()
    for (const p of players) if (p.sleeperId && !posOf.has(p.sleeperId)) posOf.set(p.sleeperId, p.position)

    const fc = await prisma.playerValueSnapshot.findMany({
      where: {
        sleeperId: { in: [...ids] },
        source: 'FANTASYCALC',
        format: 'DYNASTY',
        qbFormat: qbFormat(starters),
      },
      orderBy: { capturedAt: 'desc' },
      select: { sleeperId: true, value: true },
    })
    const marketOf = new Map<string, number>()
    for (const r of fc) if (!marketOf.has(r.sleeperId)) marketOf.set(r.sleeperId, r.value)

    // One observation per trade: the two sides are mirror images.
    const seen = new Set<string>()
    for (const f of facts) {
      const pl = (f.payload ?? {}) as any
      const txn = pl.sleeperTransactionId
      if (!txn || seen.has(txn)) continue
      seen.add(txn)
      tradesSeen++

      const picks = Array.isArray(pl.pickDetail) ? pl.pickDetail : []
      if (picks.length === 0) { why.noPicks++; continue }

      // This side's roster, taken from the payload's own roster list.
      const rosterIds: number[] = Array.isArray(pl.rosterIds) ? pl.rosterIds : []
      if (rosterIds.length !== 2) continue
      const me = rosterIds[0]

      let O = 0
      let sawPlayer = false
      let bad = false
      for (const [key, sign] of [['playersInIds', 1], ['playersOutIds', -1]] as const) {
        for (const pid of pl[key] ?? []) {
          const pos = posOf.get(pid)
          // An IDP asset would import our unvalidated defensive ceiling into the answer.
          if (leagueIsIdp && isIdpPosition(pos)) { bad = true; why.idpInvolved++; break }
          const v = marketOf.get(pid)
          if (v == null) { bad = true; why.unpriced++; break }
          O += sign * v
          sawPlayer = true
        }
        if (bad) break
      }
      if (bad) continue
      if (!sawPlayer) { why.noPlayers++; continue }

      const x = new Array(MAX_ROUND).fill(0)
      let farFuture = false
      for (const pk of picks) {
        const round = Number((pk as any).round)
        const pickSeason = Number((pk as any).season)
        const owner = Number((pk as any).owner_id)
        const prev = Number((pk as any).previous_owner_id)
        if (!Number.isFinite(round) || round < 1 || round > MAX_ROUND) continue
        if (Number.isFinite(pickSeason) && Number.isFinite(f.season)) {
          if (pickSeason - (f.season as number) > MAX_YEARS_OUT) { farFuture = true; break }
        }
        if (owner === me) x[round - 1] += 1
        else if (prev === me) x[round - 1] -= 1
      }
      if (farFuture) { why.farFuture++; continue }
      if (x.every((v) => v === 0)) continue

      rows.push(x)
      targets.push(-O)
    }
  }

  console.log(`dynasty trades examined (season >= ${MIN_SEASON}): ${tradesSeen}`)
  console.log(`  excluded: ${JSON.stringify(why)}`)
  console.log(`  usable equations (players + picks): ${rows.length}`)

  const perRound = new Array(MAX_ROUND).fill(0)
  for (const r of rows) for (let i = 0; i < MAX_ROUND; i++) if (r[i] !== 0) perRound[i]++
  console.log(`  trades touching each round: ${perRound.join(', ')}`)

  if (rows.length < 40) {
    console.log('\nToo few equations to solve a curve. Reported, not forced.')
    return
  }

  const free = leastSquares(rows, targets, MAX_ROUND)
  if (free) {
    console.log('')
    console.log('UNCONSTRAINED least squares (the honest first answer, reported either way):')
    console.log('  ' + free.map((x, i) => `r${i + 1}=${x.toFixed(0)}`).join('  '))
    const ok = free.every((x, i) => (i === 0 || x <= free[i - 1] + 1e-9) && x >= 0)
    console.log(
      ok
        ? '  monotone and non-negative.'
        : '  ⚠ NOT MONOTONE / NEGATIVE. A later pick cannot be worth more than an earlier one in',
    )
    if (!ok) console.log('    the same draft, and none is worth less than nothing. This fit is chasing noise.')
  }

  /*
   * Constrained fit: v_r = v1 x exp(-lambda(r-1)).
   *
   * ⚠ TWO PARAMETERS INSTEAD OF FIVE, AND THE CONSTRAINT IS A REAL PRIOR RATHER THAN A
   * CONVENIENCE. A fourth-round pick cannot be worth more than a third in the same draft, and
   * no pick is worth a negative amount - the free fit produced both, because rounds 4 and 5
   * appear in only 177 and 24 trades and it had enough freedom to chase them. Exponential
   * decay is monotone and positive by construction, so noise cannot express itself as an
   * impossible shape; it can only widen the residual, where it stays visible.
   *
   * lambda is grid-searched and v1 solved linearly at each step, since the problem is linear
   * once lambda is fixed.
   */
  let best: { lambda: number; v1: number; sse: number } | null = null
  for (let lambda = 0.05; lambda <= 3.0; lambda += 0.01) {
    const shape = Array.from({ length: MAX_ROUND }, (_, i) => Math.exp(-lambda * i))
    let num = 0
    let den = 0
    for (let k = 0; k < rows.length; k++) {
      const proj = rows[k].reduce((acc, xi, i) => acc + xi * shape[i], 0)
      num += proj * targets[k]
      den += proj * proj
    }
    if (den <= 0) continue
    const v1 = num / den
    if (v1 <= 0) continue
    let sse = 0
    for (let k = 0; k < rows.length; k++) {
      const pred = rows[k].reduce((acc, xi, i) => acc + xi * shape[i] * v1, 0)
      sse += (targets[k] - pred) ** 2
    }
    if (!best || sse < best.sse) best = { lambda, v1, sse }
  }
  if (!best) {
    console.log('')
    console.log('No constrained fit converged.')
    return
  }

  const bestFit = best
  const v = Array.from({ length: MAX_ROUND }, (_, i) => bestFit.v1 * Math.exp(-bestFit.lambda * i))
  console.log('')
  console.log(`CONSTRAINED fit (monotone, positive): v1=${bestFit.v1.toFixed(0)}, decay=${bestFit.lambda.toFixed(2)}`)
  console.log('pick values in FantasyCalc dynasty units:')
  for (let i = 0; i < MAX_ROUND; i++) {
    console.log(`  round ${i + 1}: ${v[i].toFixed(0).padStart(6)}   (${(v[i] / v[0]).toFixed(3)} of a 1st)`)
  }

  const resid = rows.map((r, k) => targets[k] - r.reduce((acc, xi, i) => acc + xi * v[i], 0))
  const meanAbs = resid.reduce((acc, r) => acc + Math.abs(r), 0) / resid.length
  const meanAbsT = targets.reduce((acc, t) => acc + Math.abs(t), 0) / targets.length
  console.log('')
  console.log(`  mean |residual| ${meanAbs.toFixed(0)} against mean |player side| ${meanAbsT.toFixed(0)}`)
  console.log(`  explains ${(100 * (1 - meanAbs / meanAbsT)).toFixed(1)}% of the average trade imbalance`)

  /*
   * WHICH OF THE FIVE IS LEAST WRONG.
   *
   * The solve above cannot confidently INVENT a curve — it explains too little of the variance
   * for that. But it can RANK the curves that already exist, which is the actual question:
   * five of them disagree and one has to be canonical. Each curve's SHAPE is held fixed and
   * only its scale is fitted, so this asks "given that a first-rounder is worth whatever it is
   * worth, does this curve's shape match how managers actually trade?" A curve that is simply
   * denominated differently is not penalised; a curve with the wrong shape is.
   */
  const shapes: Record<string, number[]> = {
    solved: v.map((x) => x / v[0]),
    tradeBuilder: [1, 50 / 68, 34 / 68, 22 / 68, 14 / 68],
    pickValuation: [1, 0.65, 0.4, 0.2, 0.1],
    utv: [1, 450 / 750, 250 / 750, 150 / 750, 80 / 750],
    valueEngine: [1, 1200 / 2500, 600 / 2500, 320 / 2500, 180 / 2500],
    dynastyTiers: [1, 180 / 650, 70 / 650, 25 / 650, 0.01],
  }

  const scored = Object.entries(shapes).map(([name, shape]) => {
    let num = 0
    let den = 0
    for (let k = 0; k < rows.length; k++) {
      const proj = rows[k].reduce((acc, xi, i) => acc + xi * shape[i], 0)
      num += proj * targets[k]
      den += proj * proj
    }
    const scale = den > 0 ? num / den : 0
    let abs = 0
    for (let k = 0; k < rows.length; k++) {
      const pred = rows[k].reduce((acc, xi, i) => acc + xi * shape[i] * scale, 0)
      abs += Math.abs(targets[k] - pred)
    }
    return { name, shape, scale, mae: abs / rows.length }
  })
  scored.sort((a, b) => a.mae - b.mae)

  console.log('')
  console.log('curve shapes ranked by fit to observed trades (best-fit scale, lower MAE = better):')
  console.log('  curve            MAE   implied 1st   shape (share of a 1st)')
  for (const s of scored) {
    console.log(
      `  ${s.name.padEnd(14)} ${s.mae.toFixed(0).padStart(5)}   ${s.scale.toFixed(0).padStart(6)}       ` +
        s.shape.map((x) => x.toFixed(3)).join('  '),
    )
  }
  const spread = scored[scored.length - 1].mae - scored[0].mae
  console.log('')
  console.log(
    `  best-to-worst MAE spread: ${spread.toFixed(0)} on a mean |player side| of ${meanAbsT.toFixed(0)} ` +
      `(${((100 * spread) / meanAbsT).toFixed(1)}%)`,
  )
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 400) : e))
  .finally(() => prisma.$disconnect())
