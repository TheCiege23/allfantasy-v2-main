/**
 * READ-ONLY. The advice ledger, trades (2026-11-15): does the trade grade mean anything?
 *
 *   railway run node --require ./scripts/_audit-preload.cjs --import tsx scripts/trade-ledger-report.ts \
 *     --confirm-host=<the database host> [--season=2026] [--season-opener=2026-09-10] [--limit=5000]
 *
 * Every `evaluateTrade()` call already saved its receipt in `trade_decision_snapshots`. This grades them:
 * for each graded receipt that says which player went which way, the players the "you" side RECEIVED
 * against the ones it GAVE, in standard PPR per week from the week-stats feed (`player_game_stats`), from
 * the first week not kicked off when the trade was evaluated through the last fully played week. Then,
 * by letter: how many, the mean net points per week, and how many came out ahead. If the grade works,
 * A trades out-score F trades. The rules are in lib/decision-os/trade/tradeLedger.ts.
 *
 * Refuses to start unless --confirm-host names the host Prisma will connect to. Counts and points only —
 * no user, league or player identifiers. Prints the host, never the URL.
 */
import { completedThroughWeek, firstUnplayedWeek } from '@/lib/shared-services/draft/backtest/backtestInputs'
import { gradeTradeRows, tradeLedgerRow, type TradeLedgerRow } from '@/lib/decision-os/trade/tradeLedger'

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
  const season = Number(arg('season') ?? '2026')
  const opener = new Date(`${arg('season-opener') ?? '2026-09-10'}T00:00:00Z`)
  const limit = Math.max(1, Number(arg('limit') ?? '5000') || 5000)
  const { prisma } = await import('@/lib/prisma')
  const { resolveDatabaseUrl } = await import('@/lib/env/database-url')
  const host = hostOf(resolveDatabaseUrl()) ?? hostOf(process.env.DATABASE_URL)
  if (!host || arg('confirm-host') !== host) {
    console.error(`Refusing to start: this would read the database at "${host}". Re-run with --confirm-host=${host} if that is the one you mean.`)
    process.exit(2)
  }
  const through = completedThroughWeek(opener, new Date())
  console.log(`trade-ledger-report: ${host} (read-only), season ${season}, graded through week ${through}\n`)

  const snaps = await prisma.$queryRaw<Array<{ is_trade: boolean; completed: boolean; surface: string | null; captured_at: Date; receipt: unknown }>>`
    SELECT s."tradeId" IS NOT NULL AS is_trade,
           COALESCE(t.status IN ('accepted', 'processed', 'completed'), false) AS completed,
           s.surface, s."capturedAt" AS captured_at, s."evaluationReceipt" AS receipt
    FROM trade_decision_snapshots s
    LEFT JOIN af_league_trades t ON t.id = s."tradeId"
    WHERE s."evaluationReceipt" IS NOT NULL
      AND s."capturedAt" >= ${new Date(Date.UTC(season, 7, 1))} AND s."capturedAt" < ${new Date(Date.UTC(season + 1, 1, 15))}
    ORDER BY s."capturedAt" DESC
    LIMIT ${limit}`

  const skips: Record<string, number> = {}
  const rows: Array<TradeLedgerRow & { completed: boolean }> = []
  for (const s of snaps) {
    const r = tradeLedgerRow({ receipt: s.receipt, surface: s.surface, isTrade: s.is_trade, fromWeek: firstUnplayedWeek(opener, new Date(s.captured_at)) })
    if ('skip' in r) skips[r.skip] = (skips[r.skip] ?? 0) + 1
    else rows.push({ ...r, completed: s.completed })
  }

  // The week-stats feed is keyed by Sleeper id. A receipt's player id is a Sleeper id, or a SportsPlayer
  // row id that carries one; anything else is unplaced, and its row is unscored rather than zero.
  const feed = await prisma.$queryRaw<Array<{ pid: string; wk: number; p: number | null }>>`
    SELECT "playerId" AS pid, "weekOrRound" AS wk,
           SUM(COALESCE((normalized_stat_map->>'pts_ppr')::float8,
                        CASE WHEN normalized_stat_map->>'scored' = 'false' THEN NULL ELSE "fantasyPoints" END)) AS p
    FROM player_game_stats
    WHERE "sportType" IN ('NFL', 'nfl') AND season = ${season}
    GROUP BY 1, 2`
  const byPid = new Map<string, Map<number, number>>()
  for (const f of feed) {
    if (f.p == null) continue
    const m = byPid.get(f.pid) ?? new Map<number, number>()
    m.set(Number(f.wk), Number(f.p))
    byPid.set(f.pid, m)
  }
  const ids = [...new Set(rows.flatMap((r) => [...r.getPlayerIds, ...r.givePlayerIds]))]
  const notInFeed = ids.filter((id) => !byPid.has(id))
  const mapped = notInFeed.length
    ? await prisma.sportsPlayer.findMany({ where: { id: { in: notInFeed } }, select: { id: true, sleeperId: true } })
    : []
  const toSleeper = new Map(mapped.filter((m) => m.sleeperId).map((m) => [m.id, m.sleeperId!.trim()]))
  const placed = (id: string) => (byPid.has(id) ? id : toSleeper.get(id) && byPid.has(toSleeper.get(id)!) ? toSleeper.get(id)! : null)
  const idsPlaced = ids.filter((id) => placed(id) != null).length

  const pointsPerWeek = (list: readonly string[], from: number, to: number): number | null => {
    const weeks = to - from + 1
    if (weeks <= 0) return null
    let total = 0
    for (const id of list) {
      const sid = placed(id)
      if (!sid) return null
      const m = byPid.get(sid)!
      for (let w = from; w <= to; w++) total += m.get(w) ?? 0
    }
    return total / weeks
  }

  console.log(`Receipts read: ${snaps.length} (limit ${limit}); gradable ${rows.length}; skipped ${JSON.stringify(skips)}`)
  console.log(`Players in gradable receipts: ${ids.length}, placed in the week-stats feed ${idsPlaced} (${ids.length ? Math.round((idsPlaced / ids.length) * 100) : 0}%)`)
  console.log(`Deals that also moved picks or FAAB (graded on their players only): ${rows.filter((r) => r.nonPlayerAssets).length}`)

  const table = (label: string, subset: typeof rows) => {
    const g = gradeTradeRows(subset, through, pointsPerWeek)
    console.log(`\n${label}: ${subset.length} rows · pending ${g.pending} · unscored ${g.unscored}`)
    if (g.byLetter.size === 0) {
      console.log('  (none graded yet)')
      return
    }
    for (const letter of ['A', 'B', 'C', 'D', 'F']) {
      const s = g.byLetter.get(letter)
      if (!s) continue
      console.log(`  ${letter}: ${String(s.n).padStart(4)} trades · net ${s.netPerWeek >= 0 ? '+' : ''}${s.netPerWeek} PPR/week for "you" · came out ahead ${s.positive} / behind ${s.negative}`)
    }
  }
  table('Redraft, every evaluation', rows.filter((r) => r.format === 'redraft'))
  table('Redraft, trades actually completed', rows.filter((r) => r.format === 'redraft' && r.completed))
  table('Dynasty/keeper, every evaluation (priced for years — a weak weekly signal)', rows.filter((r) => r.format === 'dynasty'))
  table('Other/unknown format', rows.filter((r) => r.format === 'other'))
  console.log('\nPaste everything above back. It contains counts and points only.')
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error('trade-ledger-report failed:', err instanceof Error ? err.message.split('\n').slice(-1)[0] : err)
  process.exit(1)
})
