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
      if ((side.picks ?? 0) > 0) { why.hasPicks++; continue }

      let O = 0
      let I = 0
      let sawIdp = false
      let sawOffence = false
      let unpriced = false

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
  console.log(`\nimplied multiplier on our current IDP scale: k = ${k.toFixed(3)}`)
  console.log(
    k > 1
      ? '  k > 1 -> managers pay MORE for defenders than our board does; we UNDER-value them.'
      : '  k < 1 -> managers pay LESS for defenders than our board does; we OVER-value them.',
  )

  // Residual spread: how much of the imbalance the single multiplier actually explains.
  const resid = obs.map((o) => o.O + k * o.I)
  const meanAbs = resid.reduce((s, r) => s + Math.abs(r), 0) / resid.length
  const meanAbsO = obs.reduce((s, o) => s + Math.abs(o.O), 0) / obs.length
  console.log(`  mean |residual| ${meanAbs.toFixed(0)} against mean |offence side| ${meanAbsO.toFixed(0)}`)

  // Per-trade implied k, to see whether the estimate is a consensus or an average of chaos.
  const ks = obs.map((o) => -o.O / o.I).filter((x) => Number.isFinite(x) && x > -20 && x < 20).sort((a, b) => a - b)
  const q = (f: number) => ks[Math.floor(f * (ks.length - 1))]
  console.log(`  per-trade k: median ${q(0.5).toFixed(2)}, IQR ${q(0.25).toFixed(2)}..${q(0.75).toFixed(2)}, n=${ks.length}`)
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 400) : e))
  .finally(() => prisma.$disconnect())
