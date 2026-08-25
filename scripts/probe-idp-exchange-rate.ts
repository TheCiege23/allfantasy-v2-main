/**
 * READ-ONLY. What exchange rate do this product's own managers actually use? Never writes.
 *
 * THE QUESTION. Our IDP values are anchored to a ceiling nobody validated — what a top
 * defender is worth against a top receiver was a product decision, and no vendor sells the
 * answer. But every completed IDP-for-offence trade is a pair of managers agreeing on a price,
 * and those are now in the table.
 *
 * THE ESTIMATOR. For each two-sided trade, let
 *   O = (offence value A received) − (offence value A gave)
 *   I = (IDP value A received)     − (IDP value A gave)     [in our current units]
 * If a trade is fair, the two sides cancel: O + k·I ≈ 0, where k is the multiplier our IDP
 * scale is wrong by. Regressing through the origin gives k = −Σ(O·I) / Σ(I²).
 *   k ≈ 1  our ceiling is about right
 *   k < 1  we over-value defenders
 *   k > 1  we under-value them
 *
 * ⚠ IT ASSUMES TRADES ARE FAIR ON AVERAGE, WHICH IS THE WHOLE LOAD-BEARING CLAIM. Both sides
 * accepted, so neither believed they were being robbed — but managers disagree, and a league
 * with one shark produces a systematically tilted sample. The residual spread is reported for
 * exactly that reason, and a wide one means the number should not be trusted as a point
 * estimate however tidy it looks.
 *
 * ⚠ AND IT PRICES OLD TRADES WITH TODAY'S VALUES. A 2024 deal is scored with a 2026 board, so
 * the run is restricted to recent seasons and the season mix is printed.
 */
import { PrismaClient } from '@prisma/client'

import { hasIdpScoring, isIdpPosition } from '../lib/core-app/scoringNotes'
import { extractScoringSettings } from '../lib/projections/leagueScoring'
import { loadLeagueIdpVorp } from '../lib/idp-projections/leagueIdpVorp'
import { FIRST_ROUND_IN_MARKET_UNITS, pickRoundShare } from '../lib/pick-curve'

const prisma = new PrismaClient()

const MIN_SEASON = Number(process.argv[2] ?? 2025)

function slots(settings: unknown): string[] {
  const s = (settings ?? {}) as Record<string, unknown>
  const raw = (s.roster_positions as unknown) ?? (s.rosterPositions as unknown)
  return Array.isArray(raw) ? raw.map((x) => String(x).toUpperCase()) : []
}
function qbFormat(starters: string[]): 'ONE_QB' | 'SUPERFLEX' {
  if (starters.some((s) => s.includes('SUPER_FLEX') || s === 'SUPERFLEX' || s === 'SF')) return 'SUPERFLEX'
  return starters.filter((s) => s === 'QB').length > 1 ? 'SUPERFLEX' : 'ONE_QB'
}

async function main() {
  const leagues = (
    await prisma.league.findMany({
      select: { id: true, name: true, settings: true, leagueType: true },
    })
  ).filter((l) => hasIdpScoring(extractScoringSettings(l.settings)))

  type Obs = { league: string; season: number; O: number; I: number }
  const obs: Obs[] = []
  const seasonMix = new Map<number, number>()
  let tradesSeen = 0
  let mixedTrades = 0
  let unpricedSkips = 0
  const why = { hasPicks: 0, offenceOnly: 0, idpOnly: 0, empty: 0, netIdpZero: 0 }

  for (const league of leagues) {
    const starters = slots(league.settings)
    const isDynasty = (league.leagueType ?? '').toLowerCase().includes('dynasty')

    const rosters = await prisma.roster.findMany({
      where: { leagueId: league.id },
      select: { playerData: true },
    })
    const rosterIds = new Set<string>()
    for (const r of rosters) {
      const pd = (r.playerData ?? {}) as Record<string, unknown>
      for (const k of ['starters', 'players']) {
        const arr = pd[k]
        if (Array.isArray(arr)) for (const v of arr) if (typeof v === 'string' && v !== '0') rosterIds.add(v)
      }
    }

    const facts = await prisma.transactionFact.findMany({
      where: { leagueId: league.id, type: 'trade', season: { gte: MIN_SEASON } },
      select: { payload: true, rosterId: true, season: true },
    })
    if (facts.length === 0) continue

    // Every player id that appears anywhere in these trades, plus the current rosters.
    const ids = new Set<string>(rosterIds)
    for (const f of facts) {
      const pl = (f.payload ?? {}) as any
      for (const k of ['playersInIds', 'playersOutIds']) {
        if (Array.isArray(pl[k])) for (const id of pl[k]) if (typeof id === 'string') ids.add(id)
      }
    }
    if (ids.size === 0) continue

    const players = await prisma.sportsPlayer.findMany({
      where: { sleeperId: { in: [...ids] } },
      select: { sleeperId: true, position: true, name: true },
    })
    const posOf = new Map<string, string | null>()
    const nameOf = new Map<string, string>()
    for (const p of players) {
      if (p.sleeperId && !posOf.has(p.sleeperId)) {
        posOf.set(p.sleeperId, p.position)
        nameOf.set(p.sleeperId, p.name)
      }
    }

    // Offence: the market. IDP: our computed board.
    const fc = await prisma.playerValueSnapshot.findMany({
      where: {
        sleeperId: { in: [...ids] },
        source: 'FANTASYCALC',
        format: isDynasty ? 'DYNASTY' : 'REDRAFT',
        qbFormat: qbFormat(starters),
      },
      orderBy: { capturedAt: 'desc' },
      select: { sleeperId: true, value: true },
    })
    const marketOf = new Map<string, number>()
    for (const r of fc) if (!marketOf.has(r.sleeperId)) marketOf.set(r.sleeperId, r.value)

    const idp = await loadLeagueIdpVorp({
      prisma,
      leagueId: league.id,
      rosterPositions: starters,
      rosterPlayerIds: [...ids],
      numTeams: rosters.length || 12,
      isDynasty,
    })

    /* One observation per trade, taken from ONE side. Both sides are mirror images, so
     * including both would double every point and halve nothing. */
    const byTxn = new Map<string, any[]>()
    for (const f of facts) {
      const pl = (f.payload ?? {}) as any
      const txn = pl.sleeperTransactionId
      if (!txn || !Array.isArray(pl.playersInIds)) continue
      const arr = byTxn.get(txn) ?? []
      arr.push({ ...pl, season: f.season })
      byTxn.set(txn, arr)
    }

    for (const [, sides] of byTxn) {
      tradesSeen++
      const side = sides[0]
      /* Picks are excluded rather than guessed at. A trade containing one is dropped, because
       * pricing it would import whichever of the three disagreeing pick curves we picked. */
      // No longer dropped — see the pick pricing below.


      let O = 0
      let I = 0
      let sawIdp = false
      let sawOffence = false
      let unpriced = false

      /*
       * ⚠ PICKS ARE PRICED NOW, AND THAT IS THE WHOLE REASON THIS RE-RUN EXISTS. 86% of trades
       * in these leagues contain one, so dropping them left 11 usable observations. The curve
       * is the collapsed canonical shape and the anchor is the ~950 FantasyCalc dynasty units
       * a first-rounder solved to across 771 trades — both measured, neither asserted.
       *
       * Picks land on the OFFENCE side of the equation because they are denominated in market
       * units, which is the same side the player prices are on. Far-future picks are dropped
       * rather than discounted: their time decay is a separate unknown and guessing it would
       * feed straight into the answer.
       */
      for (const pk of (side.pickDetail ?? []) as Array<Record<string, unknown>>) {
        const round = Number(pk.round)
        const pickSeason = Number(pk.season)
        const owner = Number(pk.owner_id)
        const prev = Number(pk.previous_owner_id)
        if (!Number.isFinite(round) || round < 1) continue
        if (
          Number.isFinite(pickSeason) &&
          Number.isFinite(side.season) &&
          pickSeason - Number(side.season) > 2
        ) {
          unpriced = true
          break
        }
        const value = FIRST_ROUND_IN_MARKET_UNITS * pickRoundShare(round)
        const meRoster = Array.isArray(side.rosterIds) ? Number(side.rosterIds[0]) : NaN
        if (owner === meRoster) { O += value; sawOffence = true }
        else if (prev === meRoster) { O -= value; sawOffence = true }
      }

      for (const [key, sign] of [['playersInIds', 1], ['playersOutIds', -1]] as const) {
        for (const pid of side[key] ?? []) {
          const pos = posOf.get(pid)
          if (isIdpPosition(pos)) {
            const v = idp.valueBySleeperId.get(pid)
            if (v == null) { unpriced = true; continue }
            I += sign * v
            sawIdp = true
          } else {
            const v = marketOf.get(pid)
            if (v == null) { unpriced = true; continue }
            O += sign * v
            sawOffence = true
          }
        }
      }

      if (unpriced) { unpricedSkips++; continue }
      // Only a trade that crosses the boundary says anything about the exchange rate.
      if (!sawIdp && !sawOffence) { why.empty++; continue }
      if (!sawIdp) { why.offenceOnly++; continue }
      if (!sawOffence) { why.idpOnly++; continue }
      if (I === 0) { why.netIdpZero++; continue }
      mixedTrades++
      seasonMix.set(side.season, (seasonMix.get(side.season) ?? 0) + 1)
      obs.push({ league: league.name ?? league.id, season: side.season, O, I })
    }
  }

  console.log(`trades examined (season >= ${MIN_SEASON}): ${tradesSeen}`)
  console.log(`  skipped, an asset could not be priced: ${unpricedSkips}`)
  console.log(`  usable IDP-for-offence trades:         ${mixedTrades}`)
  console.log(`  season mix: ${JSON.stringify(Object.fromEntries([...seasonMix].sort()))}`)
  console.log(`  excluded: ${JSON.stringify(why)}`)

  if (obs.length < 12) {
    console.log('\nToo few crossing trades to estimate an exchange rate. Reported, not forced.')
    return
  }

  const num = obs.reduce((s, o) => s + o.O * o.I, 0)
  const den = obs.reduce((s, o) => s + o.I * o.I, 0)
  const k = -num / den

  const resid = obs.map((o) => o.O + k * o.I)
  const meanAbs = resid.reduce((s, r) => s + Math.abs(r), 0) / resid.length
  const meanAbsO = obs.reduce((s, o) => s + Math.abs(o.O), 0) / obs.length
  const explained = 1 - meanAbs / meanAbsO

  const ks = obs
    .map((o) => -o.O / o.I)
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b)
  const q = (f: number) => ks[Math.floor(f * (ks.length - 1))]
  const iqrLo = q(0.25)
  const iqrHi = q(0.75)

  console.log('')
  console.log(`  point estimate k = ${k.toFixed(3)}`)
  console.log(`  mean |residual| ${meanAbs.toFixed(0)} against mean |offence side| ${meanAbsO.toFixed(0)}`)
  console.log(`  explains ${(explained * 100).toFixed(1)}% of the trade imbalance`)
  console.log(`  per-trade k: median ${q(0.5).toFixed(2)}, IQR ${iqrLo.toFixed(2)}..${iqrHi.toFixed(2)}, n=${ks.length}`)

  /*
   * ⚠ A NUMBER CAME OUT, AND IT IS NOT AN ANSWER. Two independent checks have to pass before
   * this is worth acting on, and the estimator refuses rather than handing over a figure that
   * would look like a measurement in a commit message.
   *
   *   1. The single multiplier has to explain something. If the residual is the same size as
   *      the signal, the regression has fitted nothing and its slope is an artefact.
   *   2. Managers have to broadly agree. An interquartile range that spans zero means a
   *      quarter of trades imply defenders are worth LESS than nothing, which is not a price —
   *      it is the assumption of fairness failing.
   */
  const explainsEnough = explained > 0.1
  const agrees = iqrLo > 0
  console.log('')
  if (explainsEnough && agrees) {
    console.log(
      k > 1
        ? `VERDICT: usable. k = ${k.toFixed(2)} > 1 — managers pay MORE than our board; we under-value defenders.`
        : `VERDICT: usable. k = ${k.toFixed(2)} < 1 — managers pay LESS than our board; we over-value defenders.`,
    )
    return
  }
  console.log('VERDICT: NOT USABLE. The exchange rate is not measurable from this data.')
  if (!explainsEnough) {
    console.log(
      `  the multiplier explains ${(explained * 100).toFixed(1)}% of the imbalance — the residual is` +
        ' the same size as the signal, so the slope is an artefact of the fit, not a price.',
    )
  }
  if (!agrees) {
    console.log(
      `  per-trade k ranges ${iqrLo.toFixed(2)}..${iqrHi.toFixed(2)} across the middle half of trades.` +
        ' A negative implied value is not a cheaper defender, it is the fairness assumption failing.',
    )
  }
  console.log(
    '  Managers trade on need, not on market parity: accepted trades routinely differ by' +
      ' thousands of points, and the IDP signal is hundreds. That noise does not average out at' +
      ' this sample size, and more trades of the same kind will not fix it.',
  )
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 400) : e))
  .finally(() => prisma.$disconnect())
