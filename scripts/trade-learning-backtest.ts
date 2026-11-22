/**
 * Trade-learning backtest (2026-11-22): do the learned pick values, contend/rebuild premiums and need premiums predict
 * what LATER trades cost, better than the grade without them? READ-ONLY.
 *
 *   railway run npm run backtest:trade-learning -- --confirm-host=<the database host you mean>
 *   options: --since-season=2020   first season read (the structural pass's own window)
 *            --cutoff=YYYY-MM-DD    train before, test on/after (default: the date 75% of trades had happened by)
 *            --json                 machine-readable result on stdout
 *
 * 🛑 IT REFUSES TO START UNLESS --confirm-host EQUALS THE HOST PRISMA WILL CONNECT TO. In this repo an unset
 * DATABASE_URL is not "no database" — @prisma/client fills it from .env on import (CLAUDE.md). The target is named by
 * the person running it, every time, and only its host is ever printed.
 *
 * Every read goes through `gatherFormatObservations` — the daily market run's own gather — plus one findMany of trade
 * dates. That gather writes nothing (the stamping and table writes are separate functions this never calls). Nothing
 * is fetched from any provider.
 *
 * The method and what it does NOT answer: `lib/trade-market/learnedMarketBacktest.ts`. What it prints is counts,
 * percentages and errors — no user ids, league names or trade ids — so it is safe to paste back.
 */
import type { NeedObservation } from '@/lib/trade-market/needMarketLearner'
import type { PickObservation } from '@/lib/trade-market/pickMarketLearner'
import type { PostureObservation } from '@/lib/trade-market/postureMarketLearner'
import {
  backtestNeed,
  backtestPicks,
  backtestPosture,
  cutoffAtShare,
  describeBacktest,
  type DatedObservation,
  type LearnerBacktest,
} from '@/lib/trade-market/learnedMarketBacktest'

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

function hostOf(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).hostname : null
  } catch {
    return null
  }
}

async function main() {
  const confirmHost = arg('confirm-host')
  const sinceSeason = Number(arg('since-season') ?? 2020)
  const asJson = process.argv.includes('--json')
  const cutoffArg = arg('cutoff')
  const cutoffGiven = cutoffArg ? new Date(`${cutoffArg}T00:00:00Z`) : null
  if (cutoffGiven && Number.isNaN(cutoffGiven.getTime())) throw new Error('--cutoff must be YYYY-MM-DD')
  if (!Number.isInteger(sinceSeason)) throw new Error('--since-season must be a year')

  const { prisma } = await import('@/lib/prisma')
  const { resolveDatabaseUrl } = await import('@/lib/env/database-url')
  const host = hostOf(resolveDatabaseUrl()) ?? hostOf(process.env.DATABASE_URL)
  if (!host) throw new Error('No database URL is set. Run under the environment that holds it (e.g. `railway run`).')
  if (!confirmHost || confirmHost !== host) {
    console.error(`Refusing to start: this would read the database at "${host}".`)
    console.error(`If that is the one you mean, re-run with --confirm-host=${host}`)
    process.exit(2)
  }
  const log = (s: string) => (asJson ? console.error(s) : console.log(s))
  log(`trade-learning-backtest: reading ${host} (read-only), seasons ${sinceSeason}+`)

  const { gatherFormatObservations } = await import('@/lib/trade-market/formatMarkets')
  const now = new Date()
  const g = await gatherFormatObservations(prisma as never, { sinceSeason, now, env: process.env })

  // Every observation carries its trade id; one read gives each trade its date.
  const ids = new Set<string>()
  for (const m of [g.byBookPicks, g.byBookPosture, g.byBookNeed]) for (const v of m.values()) for (const o of v.observations) ids.add(o.transactionId)
  const dateOf = new Map<string, Date>()
  const all = [...ids]
  for (let i = 0; i < all.length; i += 5000) {
    const rows = await prisma.leagueTrade.findMany({ where: { transactionId: { in: all.slice(i, i + 5000) } }, select: { transactionId: true, tradeDate: true } })
    for (const r of rows) if (r.tradeDate && !dateOf.has(r.transactionId)) dateOf.set(r.transactionId, r.tradeDate)
  }
  const dated = <O extends { transactionId: string }>(obs: O[]): Array<DatedObservation<O>> =>
    obs.flatMap((o) => (dateOf.has(o.transactionId) ? [{ obs: o, tradeDate: dateOf.get(o.transactionId)! }] : []))

  const cutoff = cutoffGiven ?? cutoffAtShare([...dateOf.values()])
  if (!cutoff) throw new Error('Not enough dated trades to split.')
  log(`cutoff ${cutoff.toISOString().slice(0, 10)}: trades before it train, trades on or after it test`)

  const results: LearnerBacktest[] = []
  for (const [book, v] of g.byBookPicks) results.push(backtestPicks(book, dated<PickObservation>(v.observations), cutoff))
  for (const [book, v] of g.byBookPosture) results.push(backtestPosture(book, dated<PostureObservation>(v.observations), cutoff))
  for (const [book, v] of g.byBookNeed) results.push(backtestNeed(book, dated<NeedObservation>(v.observations), cutoff))

  if (asJson) {
    console.log(JSON.stringify({ host, cutoff: cutoff.toISOString(), sinceSeason, results }, null, 2))
    return
  }
  for (const r of results) {
    console.log(`\n${describeBacktest(r)}`)
    for (const row of r.rows.filter((x) => x.testTrades > 0)) {
      const fmt = (p: number | null) => (p == null ? '—' : `${p > 0 ? '+' : ''}${p}%`)
      console.log(
        `  ${row.row.padEnd(18)} earlier ${fmt(row.trainPct).padStart(7)} (${row.trainTrades})  later ${fmt(row.testPct).padStart(7)} (${row.testTrades})  ` +
          `error ${row.plain.meanError ?? '—'} → ${row.learned.meanError ?? '—'}${row.sameDirection === false ? '  ⚠ flipped' : ''}`,
      )
    }
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(async () => {
    const { prisma } = await import('@/lib/prisma')
    await prisma.$disconnect().catch(() => {})
  })
