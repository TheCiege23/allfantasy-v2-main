/**
 * Assemble manager trade tendencies from ingested trades. READ-ONLY unless `--write` is passed.
 *
 *   npx tsx scripts/probe-manager-tendencies.ts           # dry run, prints what it would write
 *   npx tsx scripts/probe-manager-tendencies.ts --write   # persists
 *
 * `manager_trade_tendencies` is read by `CrossLeagueUserStatsService` and has never had a
 * writer. It could not have one: the trade facts recorded that a trade happened and not what
 * was in it. Now that contents are ingested, every column except `trades_sent` is computable.
 *
 * ⚠ THE IDENTITY CHAIN IS THE PART THAT BREAKS SILENTLY. `TransactionFact.rosterId` is
 * Sleeper's numeric roster id; `manager_trade_tendencies.user_id` is queried against the
 * SLEEPER USER id (`resolveManagerIds` unions the app user id with the profile's
 * `sleeperUserId`). The bridge is `LeagueTeam`, unique on `(leagueId, externalId)`, whose
 * `externalId` IS that roster id. Get it wrong and every row is written under a key nothing
 * ever queries — which looks exactly like a working writer.
 */
import { PrismaClient } from '@prisma/client'

import { computeManagerTendencies, type TradeSideObservation } from '../lib/psychological-profiles/ManagerTendencyBuilder'
import { FIRST_ROUND_IN_MARKET_UNITS, pickRoundShare } from '../lib/pick-curve'

const prisma = new PrismaClient()
const WRITE = process.argv.includes('--write')

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
  const leagues = await prisma.league.findMany({
    where: { platform: { equals: 'sleeper', mode: 'insensitive' } },
    select: { id: true, name: true, settings: true, leagueType: true },
  })

  const observations: TradeSideObservation[] = []
  let unmappedRosters = 0
  let sidesSeen = 0

  for (const league of leagues) {
    const facts = await prisma.transactionFact.findMany({
      where: { leagueId: league.id, type: 'trade' },
      select: { payload: true, rosterId: true, season: true },
    })
    if (facts.length === 0) continue

    // roster id -> sleeper user id
    const teams = await prisma.leagueTeam.findMany({
      where: { leagueId: league.id },
      select: { externalId: true, platformUserId: true },
    })
    const ownerOf = new Map<string, string>()
    for (const t of teams) if (t.platformUserId) ownerOf.set(String(t.externalId), t.platformUserId)

    const ids = new Set<string>()
    for (const f of facts) {
      const pl = (f.payload ?? {}) as any
      for (const k of ['playersInIds', 'playersOutIds']) {
        if (Array.isArray(pl[k])) for (const id of pl[k]) if (typeof id === 'string') ids.add(id)
      }
    }

    const players = await prisma.sportsPlayer.findMany({
      where: { sleeperId: { in: [...ids] } },
      select: { sleeperId: true, age: true },
    })
    const ageOf = new Map<string, number>()
    for (const p of players) {
      if (p.sleeperId && typeof p.age === 'number' && !ageOf.has(p.sleeperId)) ageOf.set(p.sleeperId, p.age)
    }

    const isDynasty = (league.leagueType ?? '').toLowerCase().includes('dynasty')
    const fc = await prisma.playerValueSnapshot.findMany({
      where: {
        sleeperId: { in: [...ids] },
        source: 'FANTASYCALC',
        format: isDynasty ? 'DYNASTY' : 'REDRAFT',
        qbFormat: qbFormat(slots(league.settings)),
      },
      orderBy: { capturedAt: 'desc' },
      select: { sleeperId: true, value: true },
    })
    const valueOf = new Map<string, number>()
    for (const r of fc) if (!valueOf.has(r.sleeperId)) valueOf.set(r.sleeperId, r.value)

    for (const f of facts) {
      const pl = (f.payload ?? {}) as any
      const txn = pl.sleeperTransactionId
      if (!txn || !Array.isArray(pl.playersInIds)) continue
      sidesSeen++

      const rosterId = String(f.rosterId ?? '')
      const managerKey = ownerOf.get(rosterId)
      if (!managerKey) { unmappedRosters++; continue }

      let received = 0
      let given = 0
      let priceable = true
      const agesReceived: number[] = []
      const agesGiven: number[] = []

      for (const [key, into, ages] of [
        ['playersInIds', 'in', agesReceived],
        ['playersOutIds', 'out', agesGiven],
      ] as const) {
        for (const pid of pl[key] ?? []) {
          const v = valueOf.get(pid)
          if (v == null) priceable = false
          else if (into === 'in') received += v
          else given += v
          const a = ageOf.get(pid)
          if (typeof a === 'number') ages.push(a)
        }
      }

      let picksReceived = 0
      let picksGiven = 0
      const me = Number(rosterId)
      for (const pk of (pl.pickDetail ?? []) as Array<Record<string, unknown>>) {
        const round = Number(pk.round)
        if (!Number.isFinite(round) || round < 1) continue
        const value = FIRST_ROUND_IN_MARKET_UNITS * pickRoundShare(round)
        if (Number(pk.owner_id) === me) { picksReceived++; received += value }
        else if (Number(pk.previous_owner_id) === me) { picksGiven++; given += value }
      }

      observations.push({
        managerKey,
        leagueId: league.id,
        transactionId: String(txn),
        valueReceived: priceable ? received : null,
        valueGiven: priceable ? given : null,
        picksReceived,
        picksGiven,
        agesReceived,
        agesGiven,
      })
    }
  }

  const rows = computeManagerTendencies(observations)
  const pct = (a: number, b: number) => (b === 0 ? 'n/a' : `${((a / b) * 100).toFixed(1)}%`)

  console.log(`trade sides seen:          ${sidesSeen}`)
  console.log(`  roster not mapped to an owner: ${unmappedRosters} (${pct(unmappedRosters, sidesSeen)})`)
  console.log(`  usable observations:           ${observations.length}`)
  console.log('')
  console.log(`managers with any trade history: ${rows.length}`)
  console.log(`  with an overpay ratio:   ${rows.filter((r) => r.avg_overpay_ratio != null).length}`)
  console.log(`  with a pick preference:  ${rows.filter((r) => r.prefers_picks != null).length}`)
  console.log(`  with an age preference:  ${rows.filter((r) => r.prefers_youth != null).length}`)
  console.log(`  everything null (too thin): ${rows.filter((r) => r.avg_overpay_ratio == null && r.prefers_picks == null && r.prefers_youth == null).length}`)

  const withRatio = rows.filter((r) => r.avg_overpay_ratio != null)
  if (withRatio.length > 0) {
    const rs = withRatio.map((r) => r.avg_overpay_ratio!).sort((a, b) => a - b)
    const q = (f: number) => rs[Math.floor(f * (rs.length - 1))]
    console.log(`  overpay ratio: median ${q(0.5).toFixed(2)}, IQR ${q(0.25).toFixed(2)}..${q(0.75).toFixed(2)}`)
    const risk = new Map<string, number>()
    for (const r of withRatio) risk.set(r.risk_tolerance!, (risk.get(r.risk_tolerance!) ?? 0) + 1)
    console.log(`  risk tolerance: ${JSON.stringify(Object.fromEntries(risk))}`)
  }

  console.log('')
  console.log('most-traded managers:')
  for (const r of rows.slice(0, 8)) {
    console.log(
      `  ${r.user_id.padEnd(20)} trades=${String(r.trades_accepted).padStart(3)} leagues=${r.leagues_played}` +
        `  ratio=${r.avg_overpay_ratio?.toFixed(2) ?? '—'}  picks=${r.prefers_picks ?? '—'}` +
        `  youth=${r.prefers_youth ?? '—'}  risk=${r.risk_tolerance ?? '—'}`,
    )
  }

  if (!WRITE) {
    console.log('')
    console.log('DRY RUN — nothing written. Pass --write to persist.')
    return
  }

  const { writeManagerTendencies } = await import('../lib/psychological-profiles/ManagerTendencyWriter')
  const res = await writeManagerTendencies(rows, prisma as never)
  console.log('')
  console.log('WROTE:', JSON.stringify(res))
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 400) : e))
  .finally(() => prisma.$disconnect())
