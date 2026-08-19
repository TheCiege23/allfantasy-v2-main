/**
 * Phase F.1 — READ-ONLY waiver conformance against a REAL database (ADR-DOS-F1).
 *
 * Validates the Decision OS waiver SHADOW path against an EXISTING league (imported or native): the
 * route-seam loader reads the league's REAL waiver settings + a roster's FAAB/priority/size, the real
 * deterministic recommender (`runWaiverAIService`) produces suggestions, the shadow is fed those same
 * suggestions, and WRAP-FIDELITY parity proves the wrapper adds no drift. The Decision OS NEVER executes
 * a claim — proven by zero waiverClaim/waiverTransaction deltas.
 *
 * Identity (ADR-DOS-F1 / F1-IDENTITY-1): there is no authenticated user headless, so the VIEWER is derived
 * read-only from the league (`prisma.roster.findFirst → platformUserId`) and injected via the loader's
 * `loadLinkedPlatformUserIds` dep — the ONLY override; every other read is the real loader. The recommender
 * input is representative (as trade conformance stages a representative trade); the real-league dimension is
 * the World facts (settings/FAAB/priority) the loader reads from the actual league.
 *
 * STRICTLY READ-ONLY & SAFE: reads only; never seeds, writes, or executes a claim. Skips without
 * DATABASE_URL (exit 0). REFUSES the production host (exit 0).
 *
 *   DATABASE_URL=<non-prod db> npx tsx scripts/decision-os-waiver-conformance.ts [leagueId ...]
 */
import { hasDatabaseUrl, resolveDatabaseUrl } from '../lib/env/database-url'
import type { WaiverAIServiceInput } from '../lib/waiver-ai-engine'

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

;(async () => {
  if (!hasDatabaseUrl()) {
    console.log('WAIVER_CONFORMANCE SKIPPED (no DATABASE_URL) — set a non-prod DATABASE_URL to run the real-data check.')
    process.exit(0)
  }
  const host = hostOf(resolveDatabaseUrl())
  if (host.includes(PROD_HOST_MARKER)) {
    console.log(`WAIVER_CONFORMANCE SKIPPED (refusing production DB host: ${host}) — run against a non-prod database.`)
    process.exit(0)
  }
  console.log(`Phase F.1 waiver conformance — READ-ONLY — DB host: ${host}`)

  const { prisma } = await import('../lib/prisma')
  const { runWaiverAIService } = await import('../lib/waiver-ai-engine')
  const { loadWaiverWorldFacts, defaultWaiverLoaderDeps } = await import('../lib/decision-os/waiver/loader')
  const { runWaiverShadowForEngine } = await import('../lib/decision-os/waiver/shadow')

  // Telemetry captured at the console boundary (robust to tsx telemetry-module-instance splits). See
  // ADR-DOS-F1 / decision-os-commissioner-conformance.ts.
  const events = captureTelemetry()

  const argvIds = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  let leagueIds = argvIds
  if (leagueIds.length === 0) {
    const recent = await prisma.league.findMany({ select: { id: true }, take: 50, orderBy: { lastSyncedAt: 'desc' } })
    leagueIds = recent.map((l: { id: string }) => l.id)
  }
  if (leagueIds.length === 0) {
    console.log('WAIVER_CONFORMANCE SKIPPED (no leagues found).')
    await prisma.$disconnect().catch(() => undefined)
    process.exit(0)
  }
  console.log(`Validating up to ${leagueIds.length} league(s): ${leagueIds.join(', ')}`)

  let validated = 0
  for (const leagueId of leagueIds) {
    // Derive a viewer read-only: a roster's platformUserId is exactly what the loader keys on.
    // NB: this Prisma client rejects null-based filters (`{ not: null }` / `NOT:{x:null}`), so we read a
    // few rosters and pick the first owned one in JS instead of filtering on null in the query.
    const candidateRosters = await prisma.roster.findMany({
      where: { leagueId },
      select: { platformUserId: true },
      take: 25,
    })
    const viewerPlatformUserId = candidateRosters
      .map((r: { platformUserId: string | null }) => r.platformUserId)
      .find((id: string | null): id is string => typeof id === 'string' && id.length > 0)
    if (!viewerPlatformUserId) {
      // No unified Roster with an owner → not a waiver-stageable league here; skip harmlessly.
      continue
    }
    const userId = viewerPlatformUserId // headless: the viewer IS the platform user we resolved

    // Inject ONLY identity resolution; every other read stays the real loader (real settings/FAAB/priority).
    const loaderDeps = { ...defaultWaiverLoaderDeps, loadLinkedPlatformUserIds: async () => [viewerPlatformUserId] }

    const facts = await loadWaiverWorldFacts(userId, leagueId, loaderDeps)
    if (!facts) {
      continue // settings/roster didn't resolve for this league — skip
    }
    const label = `[${leagueId}]`
    check(`${label} loader read real settings + roster (rosterId present)`, Boolean(facts.rosterId), `rosterId=${facts.rosterId}`)
    check(`${label} loader resolved a normalized waiver type`, typeof facts.settings.normalizedWaiverType === 'string' && facts.settings.normalizedWaiverType.length > 0, `type=${facts.settings.normalizedWaiverType}`)

    // Baseline: no claim/transaction execution.
    const claimsBefore = await prisma.waiverClaim.count({ where: { leagueId } }).catch(() => 0)
    const txBefore = await prisma.waiverTransaction.count({ where: { leagueId } }).catch(() => 0)

    // Representative recommender input (the real-league dimension is the loaded World facts above).
    const engineInput: WaiverAIServiceInput = {
      sport: facts.sport,
      leagueId,
      leagueSettings: { numTeams: 12 },
      roster: [{ id: 'cf-rb', name: 'Conformance RB', position: 'RB', team: 'BUF', slot: 'bench', age: 26, value: 1200 }],
      availablePlayers: [
        { playerId: 'cf-fa1', playerName: 'Free Agent RB', position: 'RB', team: 'KC', value: 1800 },
        { playerId: 'cf-fa2', playerName: 'Free Agent WR', position: 'WR', team: 'MIA', value: 1500 },
      ],
      goal: 'balanced',
      maxResults: 8,
    }
    const analysis = await runWaiverAIService(engineInput)
    check(`${label} recommender produced deterministic suggestions`, (analysis.deterministic?.suggestions?.length ?? 0) >= 1, `n=${analysis.deterministic?.suggestions?.length}`)

    const res = await runWaiverShadowForEngine(
      { userId, leagueId, engineInput, legacyAnalysis: analysis },
      { loadWorldFacts: (u, l) => loadWaiverWorldFacts(u, l, loaderDeps) },
    )
    check(`${label} shadow RAN on real data`, res.ran === true, res.error ?? '')
    check(`${label} parity PASSED (wrap fidelity)`, res.result?.parity?.passed === true, `diffs=${res.result?.parity?.diffs.length ?? '?'}`)
    check(`${label} parity flagged wrap_fidelity`, res.result?.parity?.wrapFidelity === true)

    const decision = res.result?.decision
    check(`${label} Decision Object has all four contract answers`, Boolean(decision?.four_answers.what_happened && decision?.four_answers.why_it_matters && decision?.four_answers.how_confident && decision?.four_answers.what_to_do))
    check(`${label} legality came from the Rule Framework (verdicts array)`, Array.isArray(decision?.rule_verdicts))

    check(`${label} telemetry: decision.issued (read-only)`, events.some((e) => e.event === 'decision.issued' && e.flags?.world_resolution_read_only === true))
    check(`${label} telemetry: decision.shadow_parity wrap_fidelity`, events.some((e) => e.event === 'decision.shadow_parity' && e.flags?.wrap_fidelity === true))

    // No-execution proof.
    const claimsAfter = await prisma.waiverClaim.count({ where: { leagueId } }).catch(() => 0)
    const txAfter = await prisma.waiverTransaction.count({ where: { leagueId } }).catch(() => 0)
    check(`${label} NO waiverClaim rows created`, claimsAfter === claimsBefore, `before=${claimsBefore} after=${claimsAfter}`)
    check(`${label} NO waiverTransaction rows created`, txAfter === txBefore, `before=${txBefore} after=${txAfter}`)

    console.log(`   ↳ ${label} waiverType=${facts.settings.normalizedWaiverType} faab=${facts.faabRemaining} prio=${facts.waiverPriority} rosterSize=${facts.rosterSize} parity=${res.result?.parity?.passed}`)
    validated++
    if (validated >= 3) break // a few representative leagues is enough; keep the run cheap
  }

  await prisma.$disconnect().catch(() => undefined)
  if (validated === 0) {
    console.log('WAIVER_CONFORMANCE SKIPPED (no league had a unified Roster owner to validate).')
    process.exit(0)
  }
  console.log(failures === 0 ? 'WAIVER_CONFORMANCE_OK' : `WAIVER_CONFORMANCE_FAILED (${failures} checks failed)`)
  process.exit(failures === 0 ? 0 : 1)
})().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.stack : e)
  process.exit(1)
})
