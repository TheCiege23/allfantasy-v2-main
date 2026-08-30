/**
 * Is it safe to turn NEXT_PUBLIC_USE_ALLFANTASY_ADP on?
 *
 * READ-ONLY. Issues SELECTs only, so it is safe to point at any environment.
 *
 * 🛑 WHY THIS SCRIPT EXISTS. `AllFantasyAdpSnapshot` is keyed on a sha256 over seven fields. The
 * writer built that tuple from `DraftSession`; the reader built it from `League`. When they
 * disagreed the reader found zero rows — and `readSnapshotForLeague` never falls back to market
 * ADP by design, so the draft room rendered em-dashes, which is EXACTLY what it renders when we
 * genuinely have no samples. A broken flag and a cold table are indistinguishable in the UI.
 *
 * Both sides now derive through `lib/adp/draftContextKey.ts`, so they cannot drift silently again.
 * This script is the check that says so out loud before anyone flips the flag in production, and
 * the thing to re-run afterwards if the board ever goes blank.
 *
 * It answers three questions the UI cannot:
 *   1. For a real league, does the hash the reader will query actually have rows behind it?
 *   2. How fresh are those rows? (The daily recompute spent a long stretch writing nothing.)
 *   3. Is the writer producing boards that no league will ever ask for? An orphan hash is the
 *      fingerprint of a writer/reader disagreement, and it survives even when one league happens
 *      to line up by luck.
 *
 * Run it the way every other audit script here runs - `npx tsx` alone will NOT work, because
 * this imports `@/lib/prisma`, which pulls in `server-only`; `_audit-preload.cjs` stubs that and
 * `--env-file` supplies DATABASE_URL:
 *
 *   node --env-file=.env --require ./scripts/_audit-preload.cjs --import tsx scripts/audit-allfantasy-adp-readiness.ts
 *
 * Append --league=<leagueId> to check one league, or --limit=25 to widen the sample.
 *
 * No npm alias is registered for it deliberately: package.json carried another session's
 * uncommitted edits when this landed, and adding a line would have meant either sweeping their
 * work into this commit or leaving a stray edit for someone else to sweep. Add
 * `"adp:readiness"` next to `"adp:audit"` when the file is quiet.
 */

import { prisma } from '@/lib/prisma'
import { buildContextHash } from '@/lib/adp/computeAllFantasyAdp'
import { buildDraftContext } from '@/lib/adp/draftContextKey'

function argValue(name: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

function hoursSince(d: Date | null): number | null {
  if (!d) return null
  return Math.round(((Date.now() - d.getTime()) / 3_600_000) * 10) / 10
}

async function main() {
  const leagueId = argValue('league')
  const limit = Math.min(Math.max(Number(argValue('limit') ?? 10) || 10, 1), 100)

  const totalSnapshots = await prisma.allFantasyAdpSnapshot.count()
  const realSnapshots = await prisma.allFantasyAdpSnapshot.count({ where: { draftMode: 'real' } })
  const newest = await prisma.allFantasyAdpSnapshot.findFirst({
    orderBy: { lastUpdatedAt: 'desc' },
    select: { lastUpdatedAt: true },
  })

  console.log('=== AllFantasyAdpSnapshot ===')
  console.log(`  rows total:            ${totalSnapshots}`)
  console.log(`  rows draftMode=real:   ${realSnapshots}`)
  console.log(
    `  newest lastUpdatedAt:  ${newest?.lastUpdatedAt?.toISOString() ?? 'NONE'}` +
      (newest ? `  (${hoursSince(newest.lastUpdatedAt)}h ago)` : ''),
  )
  if (totalSnapshots === 0) {
    console.log('\n  🛑 The table is EMPTY. The flag would render em-dashes for every league.')
    console.log('     Run the recompute first: npm run recompute:allfantasy-adp -- --apply')
  }

  const leagues = await prisma.league.findMany({
    where: leagueId ? { id: leagueId } : { draftSessions: { isNot: null } },
    select: {
      id: true,
      name: true,
      sport: true,
      season: true,
      scoring: true,
      isDynasty: true,
      leagueVariant: true,
      leagueSize: true,
      settings: true,
      draftSessions: { select: { draftType: true, teamCount: true, status: true } },
    },
    take: leagueId ? 1 : limit,
  })

  if (leagues.length === 0) {
    console.log(
      leagueId
        ? `\n  No league found with id ${leagueId}.`
        : '\n  No leagues with a draft session were found.',
    )
  }

  console.log(`\n=== Per-league readiness (${leagues.length}) ===`)
  let ready = 0
  for (const league of leagues) {
    const context = buildDraftContext({
      league: {
        sport: String(league.sport),
        season: Number(league.season),
        scoring: league.scoring,
        isDynasty: league.isDynasty,
        leagueVariant: league.leagueVariant,
        leagueSize: league.leagueSize,
        settings: league.settings,
      },
      session: league.draftSessions ?? null,
    })
    const hash = buildContextHash(context)
    const rows = await prisma.allFantasyAdpSnapshot.count({
      where: { contextHash: hash, draftMode: 'real' },
    })
    if (rows > 0) ready++

    const label = rows > 0 ? `${rows} players` : 'EM-DASHES (no rows)'
    console.log(`\n  ${league.name ?? league.id}  [${league.id}]`)
    console.log(
      `    context: ${context.sport} ${context.leagueType} ${context.draftType} ` +
        `${context.scoringFormat} ${context.rosterFormat} ${context.teamCount}-team ${context.season}`,
    )
    console.log(`    session: ${league.draftSessions ? league.draftSessions.status : 'none'}`)
    console.log(`    hash:    ${hash}  ->  ${label}`)
  }

  /*
   * Orphan boards. A contextHash the writer produced that NO league resolves to is the fingerprint
   * of a writer/reader disagreement — and unlike the per-league check above, it cannot be masked
   * by one league happening to line up. Sampled against the leagues read here, so read it as a
   * signal to investigate rather than a census.
   */
  const writtenHashes = await prisma.allFantasyAdpSnapshot.groupBy({
    by: ['contextHash'],
    where: { draftMode: 'real' },
    _count: { _all: true },
  })
  const readableHashes = new Set(
    leagues.map((league) =>
      buildContextHash(
        buildDraftContext({
          league: {
            sport: String(league.sport),
            season: Number(league.season),
            scoring: league.scoring,
            isDynasty: league.isDynasty,
            leagueVariant: league.leagueVariant,
            leagueSize: league.leagueSize,
            settings: league.settings,
          },
          session: league.draftSessions ?? null,
        }),
      ),
    ),
  )
  const orphans = writtenHashes.filter((h) => !readableHashes.has(h.contextHash))

  console.log('\n=== Boards written vs boards asked for ===')
  console.log(`  distinct contextHashes written (real): ${writtenHashes.length}`)
  console.log(`  matched by the ${leagues.length} league(s) sampled above: ${writtenHashes.length - orphans.length}`)
  console.log(`  unmatched by this sample:              ${orphans.length}`)
  if (orphans.length) {
    console.log('  (unmatched is EXPECTED for boards belonging to leagues outside this sample,')
    console.log("   and for the 'imported' boards built from DraftFact. Investigate only if a")
    console.log('   league you sampled reads em-dashes while a similar board exists here.)')
    for (const o of orphans.slice(0, 8)) {
      console.log(`    ${o.contextHash}  ${o._count._all} rows`)
    }
  }

  console.log('\n=== Verdict ===')
  if (leagues.length === 0) {
    console.log('  INCONCLUSIVE — no leagues sampled.')
  } else if (ready === leagues.length) {
    console.log(`  READY — all ${leagues.length} sampled league(s) resolve to populated boards.`)
  } else if (ready === 0) {
    console.log(`  NOT READY — 0 of ${leagues.length} sampled league(s) would show any ADP.`)
    console.log('  Turning the flag on now renders em-dashes, which looks like "no data yet".')
  } else {
    console.log(`  PARTIAL — ${ready} of ${leagues.length} sampled league(s) resolve to rows.`)
    console.log('  Check whether the empty ones simply have no drafts, or a context nothing wrote.')
  }

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error('[audit-allfantasy-adp-readiness] failed:', err)
  await prisma.$disconnect()
  process.exit(1)
})
