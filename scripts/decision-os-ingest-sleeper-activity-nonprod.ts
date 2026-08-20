/**
 * Fantasy OS Suite — Phase D Increment 7.
 *
 * Sleeper imported-activity orchestration: connects a REAL, already-imported Sleeper league's real
 * trade/waiver/roster-move/draft-pick history (pulled from the public Sleeper API) to the
 * already-built, already-tested Decision OS ingestion pipeline — closing the gap
 * `docs/os/SLEEPER_OS_SUITE_PROOF_CHECKLIST.md` §5 named precisely without building.
 *
 * Reuses, unchanged:
 *   - `ingestSleeperImportedActivity` (Phase A Increment 4, `lib/decision-os/ingestion/sleeperActivityEmitter.ts`)
 *     — emitter → normalizer → writer, in one call.
 *   - `PrismaImportedActivityStore` (Phase A Increment 3) as the real store.
 *   - `buildManagerIdentityIndex` (Phase A Increment 1) to build the `ManagerIdentityIndex`.
 * This script's ONLY new logic is orchestration: fetching real Sleeper data for an
 * already-imported league and building a real, honest identity mapping for it (see
 * `decision-os-ingest-sleeper-activity-helpers.ts`) — no new Decision OS derivation.
 *
 * Manager identity resolution: for each real Sleeper roster owner, looks up
 * `UserProfile.sleeperUserId` (the real, persisted, unique reverse-lookup already used elsewhere in
 * this codebase — see `app/league/[leagueId]/page.tsx`) to find a linked AllFantasy account. Falls
 * back to an honest `stable_key`-only mapping (external-only attribution) when no AF account is
 * linked — the exact same pattern Decision OS Phase A already proved on fixtures, now applied to
 * real Sleeper data for the first time.
 *
 * Safety, mirroring every existing `scripts/decision-os-*-nonprod.ts` script exactly:
 *   - Skips cleanly without a DATABASE_URL.
 *   - Hard-refuses the production DB host (`ep-spring-tooth`).
 *   - Requires an EXPLICIT, already-imported AF league id — no auto-discovery, no production
 *     league enumeration, ever.
 *   - Read-only against AF-native tables (`League`, `LeagueTeam`, `Roster`, `UserProfile`) — this
 *     script only WRITES to `DecisionOsImportedActivity` (via the existing, audited writer), the
 *     same provider-neutral table Phase A already designed with zero AF-native FK coupling.
 *
 *   DATABASE_URL=<non-prod db> npx tsx scripts/decision-os-ingest-sleeper-activity-nonprod.ts \
 *     --afLeagueId=<AF leagueId already imported via decision-os-import-sleeper-nonprod.ts> \
 *     [--weeks=<N, default 18>] [--dryRun]
 *
 * `--dryRun` (Phase D Increment 10): runs every real step through fetching + identity-mapping +
 * building the activity payload, but stops BEFORE calling `ingestSleeperImportedActivity` — no write
 * happens. Prints the same counts a real run would, prefixed `DRY RUN`, plus a distinct
 * `SLEEPER_ACTIVITY_INGEST_DRY_RUN_OK` sentinel (never the real `SLEEPER_ACTIVITY_INGEST_OK`) so a
 * caller can tell dry-run output apart from a real write. Lets an operator verify a real Sleeper
 * league id, DB connectivity, and identity-mapping resolution before committing to a first real write
 * — the writer itself is already idempotent/safe-to-rerun (see the checklist), so this is an added
 * zero-write checkpoint, not a fix for an unsafe write path.
 *
 * Note the flag is `--afLeagueId`, not `--league` — the sibling
 * `decision-os-import-sleeper-nonprod.ts` uses `--league` for the SLEEPER SOURCE league id, the
 * opposite meaning. Deliberately different names to avoid a real copy/paste mix-up between the two
 * scripts in the same proof chain.
 *
 * Honesty caveat, matching Phase A's own established caveat exactly: this script has real,
 * type-correct logic that reuses only already-tested pipeline pieces, but has not been executed
 * against a live Sleeper league in this sandbox (no live network access here) — the same caveat
 * every prior "real Sleeper" proof in this workstream has carried.
 */
import { hasDatabaseUrl, resolveDatabaseUrl } from '../lib/env/database-url'
import {
  buildWeekRange,
  mapSleeperTransactionToRaw,
  mapSleeperDraftPickResponseItem,
  resolveDraftOccurredAt,
  getDraftId,
  buildSleeperManagerMapping,
  collectRosterOwnerIds,
  shouldWarnPossibleSilentFetchFailure,
} from './decision-os-ingest-sleeper-activity-helpers'

const PROD_HOST_MARKER = 'ep-spring-tooth'

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const hasFlag = (name: string) => process.argv.slice(2).includes(`--${name}`)

function hostOf(url: string | null): string {
  if (!url) return '?'
  try {
    return new URL(url.replace(/^postgres(ql)?:\/\//, 'http://')).host
  } catch {
    return '?'
  }
}

;(async () => {
  if (!hasDatabaseUrl()) {
    console.log('SLEEPER_ACTIVITY_INGEST SKIPPED (no DATABASE_URL) — set a non-prod DATABASE_URL to run this.')
    process.exit(0)
  }
  const dbUrl = resolveDatabaseUrl()
  const host = hostOf(dbUrl)
  if (host.includes(PROD_HOST_MARKER)) {
    console.error(`REFUSED: resolved DB host (${host}) is the PRODUCTION host. This runner writes activity rows and must NEVER touch production.`)
    process.exit(1)
  }

  // Deliberately named `--afLeagueId=` (not `--league=`, which the sibling
  // `decision-os-import-sleeper-nonprod.ts` uses for the SLEEPER SOURCE league id — the opposite
  // meaning). Using the same flag name across the two scripts in this proof chain would be a real,
  // easy copy/paste mistake for an operator running the runbook end-to-end.
  const leagueId = arg('afLeagueId')?.trim()
  if (!leagueId) {
    console.error('REFUSED: --afLeagueId=<AF leagueId from step 1> is required. This script never auto-discovers leagues.')
    process.exit(1)
  }
  const weeks = Number.parseInt(arg('weeks') ?? '18', 10)
  const dryRun = hasFlag('dryRun')

  console.log(`Sleeper activity ingestion orchestration — DB host: ${host}${dryRun ? ' (DRY RUN — no writes)' : ''}`)
  console.log(`league=${leagueId} weeks=1..${Math.max(1, Math.min(18, Number.isFinite(weeks) ? weeks : 18))}`)

  const { prisma } = await import('../lib/prisma')
  const { ingestSleeperImportedActivity } = await import('../lib/decision-os/ingestion/sleeperActivityEmitter')
  const { buildManagerIdentityIndex } = await import('../lib/decision-os/ingestion/importedActivityNormalizer')
  const { PrismaImportedActivityStore } = await import('../lib/decision-os/ingestion/prismaImportedActivityStore')
  const { getLeagueRosters, getLeagueTransactions, getLeagueDrafts, getDraftPicks } = await import('../lib/sleeper-client')

  try {
    // 1) Look up the already-imported AF league — must be a real Sleeper-provider league.
    const league = await prisma.league.findFirst({
      where: { id: leagueId },
      select: { id: true, platform: true, platformLeagueId: true, season: true, name: true },
    })
    if (!league) {
      console.error(`REFUSED: no League found for id "${leagueId}".`)
      process.exit(1)
    }
    if (league.platform !== 'sleeper' || !league.platformLeagueId) {
      console.error(`REFUSED: League "${leagueId}" is not a Sleeper-imported league (platform=${league.platform ?? 'null'}).`)
      process.exit(1)
    }
    const sourceLeagueId = league.platformLeagueId
    console.log(`Resolved AF league "${league.name ?? ''}" (${leagueId}) → Sleeper source league ${sourceLeagueId}`)

    // 2) Ensure the DecisionOsImportedActivity model is actually generated in this environment —
    //    honest refusal, matching Increment 4's own `snapshot_store_unavailable` precedent, rather
    //    than a confusing runtime crash mid-ingest.
    const delegate = (prisma as unknown as { decisionOsImportedActivity?: unknown }).decisionOsImportedActivity
    if (!delegate) {
      console.error('REFUSED: the decisionOsImportedActivity Prisma delegate is not generated in this environment (run `prisma generate` against a schema that includes it first).')
      process.exit(1)
    }
    const store = new PrismaImportedActivityStore(
      delegate as ConstructorParameters<typeof PrismaImportedActivityStore>[0],
    )

    // 3) Fetch REAL rosters (public Sleeper API) — the source of real roster-owner Sleeper user ids.
    const rosters = await getLeagueRosters(sourceLeagueId)
    if (rosters.length === 0) {
      console.error(`REFUSED: Sleeper returned zero rosters for league ${sourceLeagueId} — nothing to attribute activity to.`)
      process.exit(1)
    }
    const ownerIds = collectRosterOwnerIds(rosters)
    console.log(`Fetched ${rosters.length} real rosters, ${ownerIds.length} distinct manager(s).`)

    // 4) Build a REAL identity index — af_id via the real UserProfile.sleeperUserId reverse-lookup
    //    (honest — an AF account is only linked when this returns a real row), else an honest
    //    stable_key-only external-only mapping. Never fabricates an AF account.
    const resolveAfUserId = async (sleeperUserId: string): Promise<string | null> => {
      const profile = await prisma.userProfile.findFirst({
        where: { sleeperUserId },
        select: { userId: true },
      })
      return profile?.userId ?? null
    }
    const mappings = await Promise.all(ownerIds.map((id) => buildSleeperManagerMapping(id, resolveAfUserId)))
    const identityIndex = buildManagerIdentityIndex(mappings)
    const externalOnlyCount = mappings.filter((m) => !m.af_id).length
    console.log(`Identity mappings: ${mappings.length - externalOnlyCount} linked to a real AF account, ${externalOnlyCount} external-only (no AF account).`)

    // 5) Fetch REAL transactions across the season's weeks (Sleeper's endpoint is per-week).
    const rawTransactions = (
      await Promise.all(buildWeekRange(weeks).map((week) => getLeagueTransactions(sourceLeagueId, week)))
    ).flat()
    const transactions = rawTransactions.map(mapSleeperTransactionToRaw)
    console.log(`Fetched ${transactions.length} real transaction(s) across the requested weeks.`)

    // 6) Fetch REAL draft picks (Sleeper's draft-pick endpoint is per-draft, discovered via the
    //    league's drafts list). Uses the draft's own real start_time when present — never invents one.
    const drafts = await getLeagueDrafts(sourceLeagueId)
    let draftPicks: ReturnType<typeof mapSleeperDraftPickResponseItem>[] = []
    let draftPicksOccurredAt: string | null = null
    if (drafts.length > 0) {
      const draft = drafts[0]
      const draftId = getDraftId(draft)
      draftPicksOccurredAt = resolveDraftOccurredAt(draft)
      if (draftId) {
        const rawPicks = await getDraftPicks(draftId)
        draftPicks = rawPicks.map((p) => mapSleeperDraftPickResponseItem(p, draftId, league.season?.toString()))
      }
    }
    const validDraftPicks = draftPicks.filter((p): p is NonNullable<typeof p> => p !== null)
    console.log(`Fetched ${validDraftPicks.length} real draft pick(s)${draftPicksOccurredAt ? ` (occurredAt=${draftPicksOccurredAt})` : ' (no real draft timestamp available — will be honestly skipped)'}.`)

    if (shouldWarnPossibleSilentFetchFailure(rosters.length, transactions.length, validDraftPicks.length)) {
      console.warn(
        'WARNING: rosters resolved, but zero transactions AND zero draft picks were fetched. This may be a ' +
          'genuinely quiet league — or a silently-failed Sleeper API fetch (lib/sleeper-client.ts catches every ' +
          'fetch error and returns []). Before trusting a zero result, manually verify the Sleeper source league ' +
          `id (${sourceLeagueId}) is correct and reachable, e.g. by checking ` +
          `https://api.sleeper.app/v1/league/${sourceLeagueId}/transactions/1 directly in a browser.`,
      )
    }

    // 7) Dry run stops here — no write. Everything above (league lookup, delegate check, real
    //    fetches, real identity mapping) already ran for real; only the write itself is skipped.
    if (dryRun) {
      console.log(
        `DRY RUN — would ingest: transactions=${transactions.length} draftPicks=${validDraftPicks.length} ` +
          `rosters=${rosters.length} identityMappings=${mappings.length} (linked=${mappings.length - externalOnlyCount} external-only=${externalOnlyCount})`,
      )
      console.log(`SLEEPER_ACTIVITY_INGEST_DRY_RUN_OK leagueId=${leagueId}`)
      console.log(`Next (real write): re-run this exact command without --dryRun.`)
      await prisma.$disconnect().catch(() => undefined)
      process.exit(0)
    }

    // Ingest — the existing, unchanged Phase A pipeline: emitter → normalizer → writer → store.
    const result = await ingestSleeperImportedActivity(
      {
        // Sleeper's own id for the fetches/ids; `leagueId` here is AllFantasy's canonical League.id
        // (the script's --afLeagueId argument), which belongs in `afLeagueId`, not the provider column.
        providerLeagueId: sourceLeagueId,
        afLeagueId: leagueId,
        transactions,
        draftPicks: validDraftPicks,
        rosters,
        draftPicksOccurredAt,
      },
      identityIndex,
      store,
    )

    console.log(`Writer summary: total=${result.writer.total} created=${result.writer.created} updated=${result.writer.updated} skipped=${result.writer.skipped}`)
    if (Object.keys(result.writer.skippedReasons).length > 0) {
      console.log(`  writer skip reasons: ${JSON.stringify(result.writer.skippedReasons)}`)
    }
    console.log(`  external-only-manager records: ${result.writer.externalOnlyManagerRecords}`)
    console.log(`  persisted by type: ${JSON.stringify(result.writer.persistedByActivityType)}`)
    if (result.emitterSkipped.length > 0) {
      console.log(`Emitter skipped ${result.emitterSkipped.length} item(s): ${JSON.stringify(result.emitterSkipped.slice(0, 5))}${result.emitterSkipped.length > 5 ? ' …' : ''}`)
    }
    if (result.normalizerSkipped.length > 0) {
      console.log(`Normalizer skipped ${result.normalizerSkipped.length} item(s).`)
    }

    console.log(`SLEEPER_ACTIVITY_INGEST_OK leagueId=${leagueId} created=${result.writer.created} updated=${result.writer.updated}`)
    console.log(`Next: DATABASE_URL=<this db> npx tsx scripts/decision-os-suite-conformance.ts --leagueIds=${leagueId}`)
    await prisma.$disconnect().catch(() => undefined)
    process.exit(0)
  } catch (e) {
    await prisma.$disconnect().catch(() => undefined)
    console.error('SLEEPER_ACTIVITY_INGEST_FAILED (exception)', e instanceof Error ? e.stack : e)
    process.exit(1)
  }
})().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.stack : e)
  process.exit(1)
})
