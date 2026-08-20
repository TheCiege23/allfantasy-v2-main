/**
 * Rebuild the Decision OS intelligence snapshots by replaying `domain_events`.
 *
 * WHY THIS EXISTS
 * `rebuildIntelligenceSnapshots` has lived in `lib/intelligence/projections/snapshotProjection.ts`
 * since it was written, with NO caller outside one integration test. So the only way to run it was
 * to hand-write a throwaway script — against production, under time pressure, with no dry run and
 * no before/after. This is that runner, written once and reviewable.
 *
 * WHEN TO RUN IT
 * After a change to how events are PROJECTED, when the existing snapshots were computed by the old
 * logic and are therefore wrong. The case this was written for: PR #520 established that 7,740 of
 * 7,833 production `domain_events` are `transaction.waiver.window_processed` carrying
 * `processed: 0` — a heartbeat saying nothing happened. Those were being counted, inflating
 * `waiverCount` so the AI was told a league had ~687 waiver events when it really had 0-2.
 * `isNoOpEvent` now suppresses them, but only for events projected AFTER that shipped. Snapshots
 * built before it still carry the inflated counts until they are rebuilt.
 *
 * WHAT IT DOES -- READ THIS BEFORE RUNNING
 * `rebuildIntelligenceSnapshots` is destructive by design. It DELETES every row of
 * `intelligence_manager_snapshot` and `intelligence_league_snapshot`, plus this projection's rows
 * in `intelligence_processed_event`, and only then replays. There is a window during which
 * Decision OS has no snapshots and will answer `evidence_unavailable`.
 *
 * That window is the real risk, not data loss: snapshots are DERIVED state. `domain_events` -- the
 * source of truth -- is never written or deleted here, so a failed or half-finished run is fixed by
 * running this again, not by a restore.
 *
 * SAFETY
 *  - Dry run by DEFAULT. It prints the current census and what a rebuild would replay, and exits
 *    without writing. You must pass `--confirm` to make it write.
 *  - Prints the resolved target as `endpoint/database (label)` -- never a connection string -- via
 *    the same identity module every other guard in this repo uses.
 *  - Targeting PRODUCTION additionally requires `ALLOW_PROD_REBUILD=1`, but ONLY to write. The
 *    census runs against production without it: reading counts is harmless, and production is the
 *    one target whose numbers an operator actually needs to see before deciding. Gating the read
 *    behind the same flag forced them to assert they accept a destructive window just to look.
 *    Unlike the `*-nonprod.ts` scripts this one is *allowed* to touch production -- that is its
 *    whole purpose -- so the flag is an acknowledgement of the write, not a refusal.
 *  - Refuses a target it cannot identify at all, so a typo in DATABASE_URL cannot quietly rebuild
 *    something unexpected.
 *
 *   # census only, writes nothing:
 *   node --env-file=.env.local --import tsx scripts/rebuild-intelligence-snapshots.ts
 *
 *   # the real thing:
 *   ALLOW_PROD_REBUILD=1 node --env-file=.env.local --import tsx scripts/rebuild-intelligence-snapshots.ts --confirm
 */
import { PrismaClient } from '@prisma/client'
import { describeDbTarget, identifyDbTarget, resolveDatabaseUrlFromDisk } from './_db-target-identity'
// Import the projection DIRECTLY, not through the `lib/intelligence` barrel: the barrel re-exports
// server-only-tainted modules that throw under tsx/Node. Same reason `run-outbox-relay.ts` does it.
import { rebuildIntelligenceSnapshots } from '../lib/intelligence/projections/snapshotProjection'

const argv = process.argv.slice(2)
const confirmed = argv.includes('--confirm')
const batchSize = Number(
  (argv.find((a) => a.startsWith('--batch-size=')) ?? '--batch-size=500').split('=')[1],
)

/** The event type that #520 established is 98.8% of the store and must not be counted. */
const NO_OP_TYPE = 'transaction.waiver.window_processed'

async function census(prisma: PrismaClient, label: string) {
  const [events, league, manager, processed] = await Promise.all([
    prisma.domainEvent.count(),
    prisma.intelligenceLeagueSnapshot.count(),
    prisma.intelligenceManagerSnapshot.count(),
    prisma.intelligenceProcessedEvent.count(),
  ])
  console.log(`\n── ${label} ─────────────────────────────`)
  console.log(`  domain_events                 ${events}`)
  console.log(`  intelligence_league_snapshot  ${league}`)
  console.log(`  intelligence_manager_snapshot ${manager}`)
  console.log(`  intelligence_processed_event  ${processed}`)

  const top = await prisma.intelligenceLeagueSnapshot.findMany({
    select: { leagueId: true, waiverCount: true, tradeCount: true, totalEvents: true },
    orderBy: { waiverCount: 'desc' },
    take: 5,
  })
  if (top.length > 0) {
    console.log('  highest waiverCount (the counter #520 deflates):')
    for (const r of top) {
      console.log(
        `    waivers=${String(r.waiverCount).padStart(5)} trades=${String(r.tradeCount).padStart(4)}` +
          ` total=${String(r.totalEvents).padStart(5)}  ${r.leagueId}`,
      )
    }
  }
  return { events, league, manager, processed }
}

void (async () => {
  const url = resolveDatabaseUrlFromDisk()
  const target = identifyDbTarget(url)
  console.log(`target: ${describeDbTarget(url)}`)

  if (target.kind === 'unknown' || target.kind === 'unparseable') {
    console.error(
      `\nREFUSED: cannot identify this database (${describeDbTarget(url)}).\n` +
        `  A rebuild DELETES every snapshot row, so it never runs against a target it cannot name.\n` +
        `  Add it to KNOWN_SAFE_TARGETS in scripts/db-target-identity.cjs, or fix DATABASE_URL.\n`,
    )
    process.exit(1)
  }

  // NOTE: the production gate is deliberately NOT here. It guards the WRITE, below, not the read.
  // Putting it in front of the census made the dry run refuse on production — which is exactly the
  // target whose numbers an operator most needs to see, and it forced them to assert they accept a
  // destructive window just to look. A read-only census earns no such assertion.
  const prisma = new PrismaClient()
  try {
    const before = await census(prisma, 'BEFORE')

    // How much of the replay is the no-op heartbeat? Reported so the expected shrink is known in
    // advance rather than discovered afterwards.
    const noOps = await prisma.domainEvent.count({ where: { type: NO_OP_TYPE } })
    const pct = before.events > 0 ? ((noOps / before.events) * 100).toFixed(1) : '0.0'
    console.log(`\n  ${noOps} of ${before.events} events (${pct}%) are ${NO_OP_TYPE}.`)
    console.log('  Those are marked processed but NOT counted, so snapshot counters should fall.')

    if (!confirmed) {
      console.log(
        `\nDRY RUN — nothing was written. This would delete ${before.league} league snapshot(s), ` +
          `${before.manager} manager snapshot(s) and ${before.processed} processed-event marker(s), ` +
          `then replay ${before.events} event(s).`,
      )
      console.log(
        target.kind === 'production'
          ? '  To do it: re-run with --confirm and ALLOW_PROD_REBUILD=1.'
          : '  Re-run with --confirm to do it.',
      )
      return
    }

    // The write gate. Reached only with --confirm, so the census above is always available.
    if (target.kind === 'production' && process.env.ALLOW_PROD_REBUILD !== '1') {
      console.error(
        `\nREFUSED: this is PRODUCTION and ALLOW_PROD_REBUILD is not set.\n` +
          `  Rebuilding is a legitimate production operation, but it deletes every snapshot row first\n` +
          `  and Decision OS answers evidence_unavailable until the replay finishes.\n` +
          `  The census above is accurate — re-run with ALLOW_PROD_REBUILD=1 once you accept that window.\n`,
      )
      process.exit(1)
    }

    console.log(`\nRebuilding (batchSize=${batchSize})… snapshots are unavailable until this finishes.`)
    const startedAt = Date.now()
    const { rebuilt } = await rebuildIntelligenceSnapshots(prisma, { batchSize })
    console.log(`Replayed ${rebuilt} event(s) in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`)

    const after = await census(prisma, 'AFTER')
    console.log('\n── DELTA ─────────────────────────────')
    console.log(`  league snapshots  ${before.league} → ${after.league}`)
    console.log(`  manager snapshots ${before.manager} → ${after.manager}`)
    console.log(`  processed markers ${before.processed} → ${after.processed}`)
    console.log('REBUILD_OK')
  } finally {
    await prisma.$disconnect().catch(() => undefined)
  }
})()
