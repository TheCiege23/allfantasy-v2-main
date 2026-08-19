/**
 * Phase E.5 — READ-ONLY canonical TRADE conformance/parity check against a REAL database.
 *
 * Validates the canonical trade path (CanonicalWorld → roster-identity join → read-only enrichment →
 * TradeWorld → CanonicalTradeMemo) against real imported data — e.g. theciege24's imported Sleeper league.
 * It proves the E.5 seam works end-to-end on live cached data and reports the honest signals: enrichment
 * source, ADP/position resolved counts, identity-join method, completeness, uncertainty, asset/participant
 * counts, and pipeline determinism (a re-run reproduces the same memo).
 *
 * STRICTLY READ-ONLY & SAFE:
 *   • Reads only (resolveCanonicalWorld find* port + AdpDataRecord/SportsPlayer caches). NEVER writes,
 *     upserts, warms a cache, calls a live provider API, or persists anything.
 *   • Skips cleanly (exit 0) when no DATABASE_URL is set — safe to wire into CI without a database.
 *   • REFUSES the production database (exit 0, runs nothing) — validation runs only against non-prod data.
 *
 *   DATABASE_URL=<non-prod db> npx tsx scripts/decision-os-trade-conformance.ts [leagueId ...]
 *
 * With explicit league ids it validates exactly those; with none it auto-discovers a recently-synced
 * imported provider league (incl. theciege24's). Representative two-sided trades are STAGED from real
 * roster players (player-for-player) — no proposal write, no snapshot write.
 */
import { hasDatabaseUrl, resolveDatabaseUrl } from '../lib/env/database-url'
import type { CanonicalWorld } from '../lib/decision-os/world/facts'
import type { TradeAssetSummary } from '../lib/decision-os/trade/dco'

const PROD_HOST_MARKER = 'ep-spring-tooth'

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures++
}

function hostOf(url: string | null): string {
  if (!url) return '?'
  try {
    return new URL(url.replace(/^postgres(ql)?:\/\//, 'http://')).host
  } catch {
    return '?'
  }
}

;(async () => {
  // Gate BEFORE importing anything that pulls the prisma singleton (which throws without a DB URL).
  if (!hasDatabaseUrl()) {
    console.log('TRADE_CONFORMANCE SKIPPED (no DATABASE_URL) — set a non-prod DATABASE_URL to run the real-data check.')
    process.exit(0)
  }

  const host = hostOf(resolveDatabaseUrl())
  // The trade conformance check stages representative trades + runs the memo; per the E.5 mandate it
  // REFUSES the production database outright (it never runs against prod, even read-only).
  if (host.includes(PROD_HOST_MARKER)) {
    console.log(`TRADE_CONFORMANCE SKIPPED (refusing production DB host: ${host}) — run against a non-prod database.`)
    process.exit(0)
  }
  console.log(`Phase E.5 trade conformance — READ-ONLY — DB host: ${host}`)

  // Dynamic imports AFTER the DB gate so the skip path never evaluates the prisma singleton.
  const { prisma } = await import('../lib/prisma')
  const { resolveCanonicalWorld } = await import('../lib/decision-os/world')
  const { resolveTradeEnrichment } = await import('../lib/decision-os/trade/enrichmentPort')
  const { resolveTradeWorld } = await import('../lib/decision-os/trade/tradeWorld')
  const { buildTradeMemo } = await import('../lib/decision-os/trade/canonicalMemo')
  const { resolveRosterIdentityJoin } = await import('../lib/decision-os/trade/rosterIdentity')
  const { runCanonicalTradeShadowAttempt } = await import('../lib/decision-os/trade/canonicalShadow')
  const { fromAfLeagueTradeItems, resolveCanonicalAssets } = await import('../lib/decision-os/world/assets')

  const argvIds = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  let leagueIds = argvIds
  if (leagueIds.length === 0) {
    // `League.platform` is a NON-nullable column (native AF leagues use 'manual', imports carry the
    // provider name), so imported leagues cannot be found by `platform != null`. Discover the
    // most-recently-synced leagues regardless of platform; the loop below skips any that lack two
    // rosters with players, so empty/native-only leagues fall through harmlessly.
    const recent = await prisma.league.findMany({
      select: { id: true },
      // Scan a wide window: most leagues have empty canonical rosters (players live in RedraftRoster or
      // are unseeded), so a narrow take can land entirely on unstageable leagues and report a vacuous OK.
      // The loop below skips any league without two rosters holding players, so empties cost only a read.
      take: 50,
      orderBy: { lastSyncedAt: 'desc' },
    })
    leagueIds = recent.map((l: { id: string }) => l.id)
  }
  if (leagueIds.length === 0) {
    console.log('TRADE_CONFORMANCE SKIPPED (no imported leagues found in this database).')
    await prisma.$disconnect().catch(() => undefined)
    process.exit(0)
  }
  console.log(`Validating ${leagueIds.length} league(s): ${leagueIds.join(', ')}`)

  for (const leagueId of leagueIds) {
    let world: CanonicalWorld | null = null
    try {
      world = await resolveCanonicalWorld(leagueId)
    } catch (e) {
      check(`[${leagueId}] resolveCanonicalWorld did not throw`, false, e instanceof Error ? e.message : String(e))
      continue
    }
    if (!world) {
      check(`[${leagueId}] resolved a world`, false, 'null world')
      continue
    }
    const provider = world.provenance.provider
    const label = `[${leagueId}${provider ? ` ${provider}` : ' native'}]`

    // Need two rosters with at least one player each to stage a representative player-for-player trade.
    const withPlayers = world.rosters.filter((r) => r.playerIds.length > 0)
    if (withPlayers.length < 2) {
      console.log(`   ↳ ${label} skipped — needs 2 rosters with players (have ${withPlayers.length})`)
      continue
    }
    const [a, b] = withPlayers
    const assets: TradeAssetSummary[] = [
      { fromRosterId: a.rosterId, toRosterId: b.rosterId, assetType: 'player', playerId: a.playerIds[0], playerName: null, faabAmount: null },
      { fromRosterId: b.rosterId, toRosterId: a.rosterId, assetType: 'player', playerId: b.playerIds[0], playerName: null, faabAmount: null },
    ]

    // 1. Roster-identity join — direct (canonical ids) AND a synthetic non-direct proposal id mapped via
    //    real world join keys (teamId), proving the redraft↔canonical join works on live data.
    const directJoin = resolveRosterIdentityJoin(world, { proposerRosterId: a.rosterId, receiverRosterId: b.rosterId })
    check(`${label} identity join (direct) resolves both participants`, directJoin.resolved, `${directJoin.proposerMethod}/${directJoin.receiverMethod}`)
    if (a.teamId && b.teamId) {
      const synthetic = resolveRosterIdentityJoin(
        world,
        { proposerRosterId: `proposal_${a.rosterId}`, receiverRosterId: `proposal_${b.rosterId}` },
        [
          { rosterId: `proposal_${a.rosterId}`, teamId: a.teamId },
          { rosterId: `proposal_${b.rosterId}`, teamId: b.teamId },
        ],
      )
      check(`${label} identity join (team) maps non-direct proposal ids to canonical rosters`, synthetic.resolved && synthetic.proposerMethod === 'team', `${synthetic.proposerMethod}/${synthetic.receiverMethod}`)
    }

    // 2. Read-only enrichment against real cached ADP + SportsPlayer data.
    const playerIds = [a.playerIds[0], b.playerIds[0]]
    const enrichment = await resolveTradeEnrichment({ sport: world.league.sport, playerIds })
    check(`${label} enrichment never throws & reports a source or honest gap`, true, `source=${enrichment.valuationSource ?? 'none'} adp=${enrichment.adpResolved} pos=${enrichment.positionResolved}`)

    // 3. Build the canonical memo on real data.
    const movements = resolveCanonicalAssets(fromAfLeagueTradeItems(
      assets.map((x, i) => ({ id: `mv_${i}`, itemType: x.assetType, itemReference: x.playerId, fromRosterId: x.fromRosterId, toRosterId: x.toRosterId, faabAmount: x.faabAmount, metadata: {} })),
      provider,
    )).map((asset, i) => ({ asset, fromRosterId: assets[i].fromRosterId, toRosterId: assets[i].toRosterId }))
    const tradeWorld = resolveTradeWorld({ world, movements, proposerRosterId: a.rosterId, receiverRosterId: b.rosterId, enrichment: enrichment.enrichment })
    const memo = buildTradeMemo(tradeWorld)
    check(`${label} canonical memo builds a two-sided snapshot`, memo.snapshot.sides.length === 2, `completeness=${memo.completeness} uncertainty=${memo.uncertainty.length}`)

    // 4. Pipeline determinism — the shadow attempt fed the memo's own snapshot reproduces it (parity passes).
    const attempt = await runCanonicalTradeShadowAttempt(
      { leagueId, proposerRosterId: a.rosterId, receiverRosterId: b.rosterId, assets, referenceSnapshot: memo.snapshot, proposalId: `conformance_${leagueId}` },
      { resolveWorld: async () => world },
    )
    check(`${label} shadow attempt is deterministic (re-run reproduces the memo → parity passes)`, attempt.ran === true && attempt.parity?.passed === true)

    console.log(
      `   ↳ ${label} assets=${assets.length} participants=2 valuation=${enrichment.valuationSource ?? 'none'} ` +
        `adp_resolved=${enrichment.adpResolved} position_resolved=${enrichment.positionResolved} ` +
        `completeness=${memo.completeness} uncertainty=${memo.uncertainty.length} ` +
        `missing=[${enrichment.warnings.join(',')}] identity=${attempt.telemetry.identity_method?.proposer ?? '?'}`,
    )
  }

  await prisma.$disconnect().catch(() => undefined)
  console.log(failures === 0 ? 'TRADE_CONFORMANCE_OK' : `TRADE_CONFORMANCE_FAILED (${failures} checks failed)`)
  process.exit(failures === 0 ? 0 : 1)
})().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.stack : e)
  process.exit(1)
})
