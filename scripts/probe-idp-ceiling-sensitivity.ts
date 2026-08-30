/**
 * HOW FAR DOES A TRADE VERDICT MOVE WHEN THE IDP CEILING MOVES?
 *
 * `IDP_CEILING_DYNASTY` in lib/idp-kicker-values.ts is the one number in the IDP stack that
 * is explicitly NOT measured, and three routes to measuring it are already closed and
 * documented there (no vendor prices defenders; VORP ranks but does not price; revealed
 * preference explained 0.1% of trade imbalance).
 *
 * This probe does not try to measure it again. It measures the BLAST RADIUS: now that
 * defenders reach real trade grades, how much of a user-visible verdict rests on it?
 *
 * Scaling the ceiling scales every defender's price linearly (`idpValueForRank` returns
 * ceiling x share(rank), and the pricing branch derives impact/vorp as fixed multiples of
 * it), so multiplying the board is exactly equivalent to moving the constant — and it lets
 * the REAL grading path run at each setting rather than a re-derivation of it.
 */
import { PrismaClient } from '@prisma/client'

import {
  computeTradeDeltaFromUserTrades,
  type UserTrade,
  type ValuationContext,
} from '@/lib/hybrid-valuation'
import { loadLeagueTradeValues } from '@/lib/league-values/leagueTradeValues'
import { getPlayersBySport } from '@/lib/sleeper-client'

const prisma = new PrismaClient()

const BASE_CEILING = 5500
const CEILINGS = [1000, 2000, 3500, 5500, 8000, 11000]

type SleeperPlayer = {
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
  position?: string | null
}

function nameOf(p: SleeperPlayer | undefined): string | null {
  if (!p) return null
  const full = p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(' ')
  return full && full.trim() ? full.trim() : null
}

function idsOf(j: unknown): string[] {
  return Array.isArray(j) ? j.filter((x): x is string => typeof x === 'string') : []
}

async function main() {
  const leagues = await prisma.league.findMany({
    select: { id: true, name: true, platformLeagueId: true, leagueType: true },
  })
  const histories = await prisma.leagueTradeHistory.findMany({
    select: { id: true, sleeperLeagueId: true },
  })

  const historyIdsByPlatform = new Map<string, string[]>()
  for (const h of histories) {
    const arr = historyIdsByPlatform.get(h.sleeperLeagueId) ?? []
    arr.push(h.id)
    historyIdsByPlatform.set(h.sleeperLeagueId, arr)
  }

  const players = (await getPlayersBySport('nfl').catch(() => null)) as Record<
    string,
    SleeperPlayer
  > | null
  if (!players) {
    console.log('no sleeper player index')
    return
  }

  const rows: Array<{
    league: string
    recv: string
    gave: string
    defRecv: number
    defGave: number
    nRecv: number
    nGave: number
    grades: string[]
    pcts: number[]
    defSums: number[]
    stable: boolean
    oneSided: boolean
  }> = []

  let idpLeagues = 0
  let fcCache: ValuationContext['fantasyCalcPlayers'] | undefined

  for (const lg of leagues) {
    const pid = lg.platformLeagueId
    if (!pid) continue
    const histIds = historyIdsByPlatform.get(pid)
    if (!histIds?.length) continue

    const board = await loadLeagueTradeValues({
      prisma,
      platformLeagueId: pid,
      isDynasty: true,
      prefetched: { players },
    })
    if (board.byNameLower.size === 0) continue
    idpLeagues++

    const trades = await prisma.leagueTrade.findMany({
      where: { historyId: { in: histIds } },
      select: {
        transactionId: true,
        playersGiven: true,
        playersReceived: true,
        season: true,
      },
    })

    const seen = new Set<string>()
    const deduped = trades.filter((t) => {
      if (seen.has(t.transactionId)) return false
      seen.add(t.transactionId)
      return true
    })

    for (const t of deduped) {
      const recvNames = idsOf(t.playersReceived)
        .map((id) => nameOf(players[id]))
        .filter((n): n is string => !!n)
      const gaveNames = idsOf(t.playersGiven)
        .map((id) => nameOf(players[id]))
        .filter((n): n is string => !!n)
      if (!recvNames.length || !gaveNames.length) continue

      const isDef = (n: string) =>
        board.byNameLower.get(n.toLowerCase().trim())?.basis === 'idp-vorp'
      const defRecv = recvNames.filter(isDef)
      const defGave = gaveNames.filter(isDef)
      if (!defRecv.length && !defGave.length) continue

      const grades: string[] = []
      const pcts: number[] = []
      /*
       * 🛑 THE BUILT-IN POSITIVE CONTROL, AND IT IS NOT DECORATION.
       *
       * The first run of this probe reported the verdict identical to one decimal across an
       * 11x range and I nearly wrote that up as a stability finding. It was a no-op: the raw
       * IDP board carries no `basis` field, so `v.basis === 'idp-vorp' ? scale : leave` took
       * the else-branch for every entry and scaled nothing at all. The sweep was comparing
       * the shipped ceiling against itself six times.
       *
       * `defSum` is the sum the sweep is supposed to be moving. If it does not move, the
       * probe is broken and the stability it reports is worthless — so it is printed on
       * every row rather than asserted somewhere out of sight.
       */
      const defSums: number[] = []

      for (const ceiling of CEILINGS) {
        const k = ceiling / BASE_CEILING
        const scaled = new Map<
          string,
          { value: number; position: string; basis: 'idp-vorp' | 'kicker-flat' }
        >()
        for (const [name, v] of board.byNameLower) {
          scaled.set(name, {
            value: v.basis === 'idp-vorp' ? Math.round(v.value * k) : v.value,
            position: v.position,
            basis: v.basis,
          })
        }

        const ctx = {
          isDynasty: true,
          leagueValueByNameLower: scaled,
          ...(fcCache ? { fantasyCalcPlayers: fcCache } : {}),
        } as ValuationContext

        const trade: UserTrade = {
          transactionId: t.transactionId,
          timestamp: Date.now(),
          parties: [
            { userId: 'A', playersReceived: recvNames.map((n) => ({ name: n })), picksReceived: [] },
            { userId: 'B', playersReceived: gaveNames.map((n) => ({ name: n })), picksReceived: [] },
          ],
        }

        defSums.push(
          [...defRecv, ...defGave].reduce(
            (sum, n) => sum + (scaled.get(n.toLowerCase().trim())?.value ?? 0),
            0,
          ),
        )

        const delta = await computeTradeDeltaFromUserTrades(trade, 'A', ctx)
        if (!delta) break
        fcCache = fcCache ?? (ctx.fantasyCalcPlayers as ValuationContext['fantasyCalcPlayers'])
        grades.push(delta.grade)
        pcts.push(delta.percentDiff)
      }

      if (grades.length !== CEILINGS.length) continue

      rows.push({
        league: lg.name ?? '(unnamed)',
        recv: recvNames.join(' + '),
        gave: gaveNames.join(' + '),
        defRecv: defRecv.length,
        defGave: defGave.length,
        nRecv: recvNames.length,
        nGave: gaveNames.length,
        grades,
        pcts,
        defSums,
        stable: new Set(grades).size === 1,
        oneSided: defRecv.length === 0 || defGave.length === 0,
      })
    }
  }

  console.log(`\nIDP leagues with a board AND trades: ${idpLeagues}`)
  console.log(`trades containing at least one priced defender: ${rows.length}`)

  const stable = rows.filter((r) => r.stable)
  const oneSided = rows.filter((r) => r.oneSided)
  const bothSides = rows.filter((r) => !r.oneSided)

  console.log(`\nceilings swept: ${CEILINGS.join('  ')}  (shipped = ${BASE_CEILING})`)
  console.log(`grade UNCHANGED across the whole sweep: ${stable.length}/${rows.length}`)
  console.log(`  defenders on ONE side only: ${oneSided.length}  (stable ${oneSided.filter((r) => r.stable).length})`)
  console.log(`  defenders on BOTH sides:    ${bothSides.length}  (stable ${bothSides.filter((r) => r.stable).length})`)

  for (const r of rows) {
    console.log(`\n${r.stable ? 'STABLE' : 'MOVES '} ${r.oneSided ? '[1-sided]' : '[2-sided]'} [${r.league}]`)
    console.log(`   recv: ${r.recv}`)
    console.log(`   gave: ${r.gave}`)
    console.log(`   defenders ${r.defRecv}/${r.nRecv} vs ${r.defGave}/${r.nGave}`)
    console.log(`   grades: ${r.grades.join('  ')}`)
    console.log(`   pct:    ${r.pcts.map((p) => p.toFixed(1)).join('  ')}`)
    const moved = new Set(r.defSums).size > 1
    console.log(`   defSum: ${r.defSums.join('  ')}${moved ? '' : '   <-- CONTROL FAILED: board did not move'}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
