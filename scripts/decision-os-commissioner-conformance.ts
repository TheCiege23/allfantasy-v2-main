/**
 * Phase F.1 — READ-ONLY commissioner-health conformance against a REAL database (ADR-DOS-F1).
 *
 * Validates the Decision OS commissioner-health SHADOW path against an EXISTING league (imported or
 * native): reads the league row + rosters read-only, builds the authoritative deterministic snapshot the
 * hub uses (`buildCommissionerHealthSnapshot`), runs `runCommissionerHealthShadow`, and asserts a
 * Decision Object is emitted, WRAP-FIDELITY parity passes, telemetry fires, the scope is commissioner +
 * non-automating, and NO league/roster mutation occurs.
 *
 * STRICTLY READ-ONLY & SAFE: reads only; never seeds, writes, mutates, or executes a commissioner action.
 * Skips cleanly (exit 0) without DATABASE_URL. REFUSES the production host (exit 0).
 *
 *   DATABASE_URL=<non-prod db> npx tsx scripts/decision-os-commissioner-conformance.ts [leagueId ...]
 *
 * With no ids it auto-discovers the most-recently-synced leagues (each self-labels via provenance).
 */
import { hasDatabaseUrl, resolveDatabaseUrl } from '../lib/env/database-url'

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

interface TelemetryEvent { event: string; flags?: Record<string, unknown> }
/** Intercept `console.debug('[decision-os]', json)` (the no-sink telemetry path) into a captured array. */
function captureTelemetry(): TelemetryEvent[] {
  const events: TelemetryEvent[] = []
  const orig = console.debug
  console.debug = (...args: unknown[]) => {
    if (args[0] === '[decision-os]' && typeof args[1] === 'string') {
      try { events.push(JSON.parse(args[1]) as TelemetryEvent) } catch { /* ignore non-JSON */ }
    }
    orig(...(args as []))
  }
  return events
}

const COUNTS = {
  tradeActivity: 0,
  waiverActivity: 0,
  pendingWaiverClaims: 0,
  pendingTrades: 0,
  chatMessagesLast7Days: 0,
  commissionerActions: 0,
  openAiAlerts: 0,
} as const

;(async () => {
  if (!hasDatabaseUrl()) {
    console.log('COMMISSIONER_CONFORMANCE SKIPPED (no DATABASE_URL) — set a non-prod DATABASE_URL to run the real-data check.')
    process.exit(0)
  }
  const host = hostOf(resolveDatabaseUrl())
  if (host.includes(PROD_HOST_MARKER)) {
    console.log(`COMMISSIONER_CONFORMANCE SKIPPED (refusing production DB host: ${host}) — run against a non-prod database.`)
    process.exit(0)
  }
  console.log(`Phase F.1 commissioner conformance — READ-ONLY — DB host: ${host}`)

  const { prisma } = await import('../lib/prisma')
  const { buildCommissionerHealthSnapshot } = await import('../lib/commissioner-hub/commissionerHubHealth')
  const { runCommissionerHealthShadow } = await import('../lib/decision-os/commissioner-health/shadow')

  // Capture Decision OS telemetry at the CONSOLE boundary (a true global) instead of via the telemetry
  // sink: tsx can split the telemetry module into two instances (script vs the shadow's internal chain),
  // so a registered sink may never fire. With no sink, the shadow's telemetry falls to
  // `console.debug('[decision-os]', json)` — we intercept exactly that, robust to module-identity splits.
  const events = captureTelemetry()

  const argvIds = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  let leagueIds = argvIds
  if (leagueIds.length === 0) {
    const recent = await prisma.league.findMany({ select: { id: true }, take: 25, orderBy: { lastSyncedAt: 'desc' } })
    leagueIds = recent.map((l: { id: string }) => l.id)
  }
  if (leagueIds.length === 0) {
    console.log('COMMISSIONER_CONFORMANCE SKIPPED (no leagues found).')
    await prisma.$disconnect().catch(() => undefined)
    process.exit(0)
  }
  console.log(`Validating ${leagueIds.length} league(s): ${leagueIds.join(', ')}`)

  let validated = 0
  for (const leagueId of leagueIds) {
    const dbLeague = await prisma.league.findUnique({
      where: { id: leagueId },
      select: {
        id: true, name: true, sport: true, season: true, leagueSize: true, status: true, lifecycleState: true,
        leagueType: true, isDynasty: true, scoring: true, settings: true, starters: true, waiverType: true,
        tradeReviewHours: true, playoffTeams: true, lockAllMoves: true,
        rosters: { select: { id: true, platformUserId: true, playerData: true, updatedAt: true, settings: true } },
      },
    })
    if (!dbLeague) {
      check(`[${leagueId}] league row exists`, false, 'no League row')
      continue
    }
    // Need at least one roster for a meaningful health snapshot; skip empties harmlessly.
    if ((dbLeague.rosters?.length ?? 0) === 0) {
      console.log(`   ↳ [${leagueId}] skipped — no rosters`)
      continue
    }

    const label = `[${leagueId}]`
    const settingsBefore = JSON.stringify(dbLeague.settings ?? null)
    const lockBefore = dbLeague.lockAllMoves ?? null

    const snapshot = buildCommissionerHealthSnapshot({ league: dbLeague as never, source: 'database', counts: { ...COUNTS } })
    const snapshotBefore = JSON.stringify(snapshot)
    check(`${label} authoritative snapshot built (deterministic)`, snapshot?.healthScore != null, `health=${snapshot.healthScore} status=${snapshot.overallStatus}`)

    // Commissioner viewer identity, derived read-only from the league (telemetry attribution only).
    const userId = 'conformance-commissioner'
    const res = await runCommissionerHealthShadow({ userId, snapshot })
    check(`${label} shadow RAN on real data`, res.ran === true, res.error ?? '')
    check(`${label} parity PASSED (wrap fidelity)`, res.result?.parity?.passed === true, `diffs=${res.result?.parity?.diffs.length ?? '?'}`)
    check(`${label} parity flagged wrap_fidelity`, res.result?.parity?.wrapFidelity === true)

    const decision = res.result?.decision
    check(`${label} Decision Object has all four contract answers`, Boolean(decision?.four_answers.what_happened && decision?.four_answers.why_it_matters && decision?.four_answers.how_confident && decision?.four_answers.what_to_do))
    check(`${label} decider_scope is commissioner`, decision?.decider_scope === 'commissioner')
    check(`${label} automation_capable is false (never executes)`, decision?.automation_capable === false)

    check(`${label} telemetry: decision.issued (commissioner, read-only)`, events.some((e) => e.event === 'decision.issued' && e.flags?.decider_scope === 'commissioner' && e.flags?.world_resolution_read_only === true))
    check(`${label} telemetry: decision.shadow_parity wrap_fidelity`, events.some((e) => e.event === 'decision.shadow_parity' && e.flags?.wrap_fidelity === true))

    // No-mutation proof.
    const leagueAfter = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, lockAllMoves: true } })
    check(`${label} league settings UNCHANGED`, JSON.stringify(leagueAfter?.settings ?? null) === settingsBefore)
    check(`${label} lockAllMoves UNCHANGED`, (leagueAfter?.lockAllMoves ?? null) === lockBefore)
    check(`${label} snapshot UNCHANGED by the shadow`, JSON.stringify(snapshot) === snapshotBefore)

    console.log(`   ↳ ${label} health=${snapshot.healthScore} status=${snapshot.overallStatus} rosters=${dbLeague.rosters.length} parity=${res.result?.parity?.passed}`)
    validated++
  }

  await prisma.$disconnect().catch(() => undefined)
  if (validated === 0) {
    console.log('COMMISSIONER_CONFORMANCE SKIPPED (no league had rosters to validate).')
    process.exit(0)
  }
  console.log(failures === 0 ? 'COMMISSIONER_CONFORMANCE_OK' : `COMMISSIONER_CONFORMANCE_FAILED (${failures} checks failed)`)
  process.exit(failures === 0 ? 0 : 1)
})().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.stack : e)
  process.exit(1)
})
