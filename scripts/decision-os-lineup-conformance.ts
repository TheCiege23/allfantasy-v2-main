/**
 * Phase F.1 — READ-ONLY lineup conformance against a REAL database (ADR-DOS-F1).
 *
 * Validates the Decision OS lineup SHADOW path against an EXISTING league (imported or native). The
 * shadow runner tries the redraft-native loader first, then the read-only Canonical World BRIDGE — so for
 * an IMPORTED league (no RedraftRoster) the bridge fires (`source=canonical_world`), and for a native AF
 * redraft league the native loader fires (`source=redraft_native`). Either is a valid PASS. The decision is
 * fed a representative legacy summary as its recommender, and WRAP-FIDELITY parity proves the wrapper adds
 * no drift.
 *
 * Identity (ADR-DOS-F1 / F1-IDENTITY-1 + F1-LINEUP-1): headless has no authenticated user, so the VIEWER is
 * derived read-only from the resolved world — a team's `managerUserId` (= claimedByUserId ?? platformUserId).
 * Imported leagues prove the Canonical World bridge, not the redraft-native loader. Player metadata degrades
 * honestly (scanIncomplete); parity is independent of metadata completeness.
 *
 * STRICTLY READ-ONLY & SAFE: reads only; never seeds, writes, or sets a lineup. Skips without DATABASE_URL
 * (exit 0). REFUSES the production host (exit 0).
 *
 * INVOCATION (the lineup chain pulls `lib/time-engine/serverClock.ts` → `server-only`, which throws under
 * plain tsx, so run with the existing `_audit-preload.cjs` shim that stubs it):
 *
 *   DATABASE_URL=<non-prod db> node --require ./scripts/_audit-preload.cjs --import tsx \
 *     scripts/decision-os-lineup-conformance.ts [leagueId ...]
 */
import { hasDatabaseUrl, resolveDatabaseUrl } from '../lib/env/database-url'
import type { LineupActionSummaryPayload } from '../lib/lineup-actions/types'

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

/** Minimal valid legacy summary — parity compares the decision against THIS same memo (wrap fidelity). */
function legacySummaryFor(leagueId: string): LineupActionSummaryPayload {
  const action = {
    leagueId, leagueName: 'Conformance', sport: 'NFL' as never, platform: 'native', teamId: 't',
    slotIndex: 0, slotId: 'QB', slotLabel: 'QB', playerId: 'cf-qb', playerName: 'Conformance QB',
    reasonType: 'empty_starter' as const, urgency: 'urgent' as const, lockTime: null,
    recommendedAction: 'Set a starter for QB.', suggestedReplacementPlayerId: null,
    confidence: 0.8, expectedGain: 5, sourceModule: 'lineup_scan' as const, message: 'QB slot empty.', severity: 'critical' as const,
  }
  return {
    totalIssues: 1, totalUnresolvedSlotActions: 1, scanWarningLeagues: 0, leaguesNeedingAttention: 1,
    lineupsNeedingAttention: 1, urgentLineupActions: 1, lockedMissedActions: 0, displayMode: 'unresolved_slots',
    displayCount: 1, displayLabelKey: 'k', displayLabelParams: {}, displaySubtextKey: null, displaySubtextParams: null,
    urgentSubtextKey: null, urgentSubtextParams: null, actions: [action],
    leagues: [{ leagueId, leagueName: 'Conformance', leagueAvatar: null, sport: 'NFL', platform: 'native', issues: [], chimmyAdvice: '', actions: [action], scanIncomplete: false }],
    scannedLeagues: 1, scannedSleeperLeagues: 0, scannedNativeLeagues: 1, lastUpdatedAt: new Date().toISOString(),
  }
}

;(async () => {
  if (!hasDatabaseUrl()) {
    console.log('LINEUP_CONFORMANCE SKIPPED (no DATABASE_URL) — set a non-prod DATABASE_URL to run the real-data check.')
    process.exit(0)
  }
  const host = hostOf(resolveDatabaseUrl())
  if (host.includes(PROD_HOST_MARKER)) {
    console.log(`LINEUP_CONFORMANCE SKIPPED (refusing production DB host: ${host}) — run against a non-prod database.`)
    process.exit(0)
  }
  console.log(`Phase F.1 lineup conformance — READ-ONLY — DB host: ${host}`)

  const { prisma } = await import('../lib/prisma')
  const { resolveCanonicalWorld } = await import('../lib/decision-os/world')
  const { runLineupShadow } = await import('../lib/decision-os/lineup/shadow')

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
    console.log('LINEUP_CONFORMANCE SKIPPED (no leagues found).')
    await prisma.$disconnect().catch(() => undefined)
    process.exit(0)
  }
  console.log(`Validating up to ${leagueIds.length} league(s): ${leagueIds.join(', ')}`)

  let validated = 0
  for (const leagueId of leagueIds) {
    const world = await resolveCanonicalWorld(leagueId).catch(() => null)
    if (!world) continue
    // Viewer = a team with a non-null managerUserId whose roster has players (so the bridge can project).
    const candidate = world.teams.find((t) => {
      if (t.managerUserId == null) return false
      const roster = world.rosters.find((r) => r.teamId === t.teamId)
      return Boolean(roster && roster.playerCount > 0)
    })
    if (!candidate?.managerUserId) {
      continue // no resolvable viewer roster with players — skip harmlessly
    }
    const userId = candidate.managerUserId
    const provider = world.provenance.provider
    const label = `[${leagueId}${provider ? ` ${provider}` : ' native'}]`

    // No-mutation baseline (both storage models).
    const rosterCountBefore = await prisma.roster.count({ where: { leagueId } }).catch(() => 0)
    const redraftCountBefore = await prisma.redraftRoster.count({ where: { leagueId } }).catch(() => 0)

    const legacy = legacySummaryFor(leagueId)
    const legacySnapshot = JSON.stringify(legacy)
    const res = await runLineupShadow({ userId, leagueId, legacySummary: legacy })

    check(`${label} shadow RAN on real data`, res.ran === true, `source=${res.source ?? '?'} ${res.error ?? ''}`)
    check(`${label} resolved inputs from a real source`, res.source === 'redraft_native' || res.source === 'canonical_world', `source=${res.source}`)
    check(`${label} parity PASSED (wrap fidelity, no drift vs legacy)`, res.parity?.passed === true, `diffs=${res.parity?.diffs.length ?? '?'}`)
    check(`${label} legacy summary NOT mutated`, JSON.stringify(legacy) === legacySnapshot)

    check(`${label} telemetry: decision.shadow_parity (shadow ran)`, events.some((e) => e.event === 'decision.shadow_parity' && e.flags?.shadow === true && e.flags?.ran === true))

    // No-mutation proof.
    const rosterCountAfter = await prisma.roster.count({ where: { leagueId } }).catch(() => 0)
    const redraftCountAfter = await prisma.redraftRoster.count({ where: { leagueId } }).catch(() => 0)
    check(`${label} roster counts UNCHANGED (no writes)`, rosterCountAfter === rosterCountBefore && redraftCountAfter === redraftCountBefore, `roster ${rosterCountBefore}->${rosterCountAfter}, redraft ${redraftCountBefore}->${redraftCountAfter}`)

    console.log(`   ↳ ${label} source=${res.source} warnings=[${(res.warnings ?? []).join(',')}] parity=${res.parity?.passed}`)
    validated++
    if (validated >= 3) break
  }

  await prisma.$disconnect().catch(() => undefined)
  if (validated === 0) {
    console.log('LINEUP_CONFORMANCE SKIPPED (no league had a resolvable viewer roster with players).')
    process.exit(0)
  }
  console.log(failures === 0 ? 'LINEUP_CONFORMANCE_OK' : `LINEUP_CONFORMANCE_FAILED (${failures} checks failed)`)
  process.exit(failures === 0 ? 0 : 1)
})().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.stack : e)
  process.exit(1)
})
