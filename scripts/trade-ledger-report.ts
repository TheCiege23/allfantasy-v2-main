/**
 * READ-ONLY. The advice ledger, trades (2026-11-15): does the trade grade mean anything?
 *
 *   railway run node --require ./scripts/_audit-preload.cjs --import tsx scripts/trade-ledger-report.ts \
 *     --confirm-host=<the database host> [--season=2026] [--limit=5000]
 *
 * Every `evaluateTrade()` call already saved its receipt in `trade_decision_snapshots`. This grades them:
 * for each graded receipt that says which player went which way, the players the "you" side RECEIVED
 * against the ones it GAVE, in standard PPR per week from the week-stats feed (`player_game_stats`), from
 * the first week not kicked off when the trade was evaluated through the last fully played week. Then,
 * by letter: how many, the mean net points per week, and how many came out ahead. If the grade works,
 * A trades out-score F trades. The rules are in lib/decision-os/trade/tradeLedger.ts; the reads are the
 * ones the maintenance cron's AllFantasy record uses (lib/chimmy-outcomes/ledgerGrading.ts), and week
 * boundaries come from the schedule table, so this report and the Receipts card agree.
 *
 * Refuses to start unless --confirm-host names the host Prisma will connect to. Counts and points only —
 * no user, league or player identifiers. Prints the host, never the URL.
 */
import { gradeTradeRows, outcomesByEvidence, yourTeamVsMarket } from '@/lib/decision-os/trade/tradeLedger'
import { completedThrough } from '@/lib/chimmy-outcomes/ledgerRecord'

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
  const { prisma } = await import('@/lib/prisma')
  const { resolveDatabaseUrl } = await import('@/lib/env/database-url')
  const { loadNflWeekCalendar, loadTradeLedgerInputs, nflSeasonFor } = await import('@/lib/chimmy-outcomes/ledgerGrading')
  const season = Number(arg('season') ?? String(nflSeasonFor(new Date())))
  const limit = Math.max(1, Number(arg('limit') ?? '5000') || 5000)
  const host = hostOf(resolveDatabaseUrl()) ?? hostOf(process.env.DATABASE_URL)
  if (!host || arg('confirm-host') !== host) {
    console.error(`Refusing to start: this would read the database at "${host}". Re-run with --confirm-host=${host} if that is the one you mean.`)
    process.exit(2)
  }
  const cal = await loadNflWeekCalendar(season, prisma)
  if (cal.size === 0) {
    console.error(`No ${season} NFL regular-season weeks in the schedule table, so no week can be proven over. Nothing graded.`)
    process.exit(1)
  }
  const through = completedThrough(cal, new Date())
  console.log(`trade-ledger-report: ${host} (read-only), season ${season}, graded through week ${through}\n`)

  const inputs = await loadTradeLedgerInputs(season, cal, { limit, db: prisma })
  const { rows, skips, pointsPerWeek } = inputs

  console.log(`Receipts read: ${inputs.read} (limit ${limit}); gradable ${rows.length}; skipped ${JSON.stringify(skips)}`)
  console.log(`Players in gradable receipts: ${inputs.idsTotal}, placed in the week-stats feed ${inputs.idsPlaced} (${inputs.idsTotal ? Math.round((inputs.idsPlaced / inputs.idsTotal) * 100) : 0}%)`)
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

  /*
   * The outcome check for trade learning (2026-11-22): did grades that rested on measured market evidence hold up as
   * often as grades on the chart alone? And, the fairer test of the roster adjustments: where the your-team letter and
   * the market letter disagreed on one deal, which held up? Redraft only — the measure is weeks of points.
   */
  const redraft = gradeTradeRows(rows.filter((r) => r.format === 'redraft'), through, pointsPerWeek)
  console.log('\nRedraft, by the market evidence each grade rested on (a grade with two kinds counts in both):')
  const byEvidence = outcomesByEvidence(redraft.scored)
  if (byEvidence.length === 0) console.log('  (none graded yet)')
  for (const o of byEvidence) {
    console.log(`  ${o.group.padEnd(13)} ${String(o.scored).padStart(4)} graded · ${o.decided} decided · held up ${o.held}${o.heldPct == null ? '' : ` (${o.heldPct}%)`} · net ${o.netPerWeek != null && o.netPerWeek >= 0 ? '+' : ''}${o.netPerWeek} PPR/week`)
  }
  const vs = yourTeamVsMarket(redraft.scored)
  console.log(`\nWhere the your-team letter differed from the market letter: ${vs.deals} deals, ${vs.bothDecided} decided both ways — your-team letter held up ${vs.yourTeamHeld}, market letter ${vs.marketHeld}.`)
  console.log('\nPaste everything above back. It contains counts and points only.')
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error('trade-ledger-report failed:', err instanceof Error ? err.message.split('\n').slice(-1)[0] : err)
  process.exit(1)
})
