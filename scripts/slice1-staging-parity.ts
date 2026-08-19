/**
 * Slice 1 — staging DB-parity verification for `manager.lineup.set` (Ticket #4).
 *
 * Verifies the Decision OS shadow path against REAL staging Prisma data (NOT prod): the route-seam
 * loader reads real roster/players/settings, World Resolution + Rule Framework run on real config,
 * the Decision Object is emitted, parity is computed, telemetry fires, and the legacy summary is
 * never mutated. Read-only against everything except the temporary seeded league (cleaned up).
 *
 *   DATABASE_URL=<staging> node --import tsx scripts/slice1-staging-parity.ts
 */
import { PrismaClient } from '@prisma/client'
import { seedNflRedraftLeague, addRosterPlayer, cleanupSeededLeague } from '../tests/helpers/redraftSeasonHarness'
import { loadLineupSetInputs, loadCanonicalValidatorContext, defaultLineupLoaderDeps } from '../lib/decision-os/lineup/loader'
import { runLineupShadow } from '../lib/decision-os/lineup/shadow'
import { runLineupSetDecision } from '../lib/decision-os/lineup'
import { toTodayLineupCard } from '../lib/decision-os/lineup/todayCardAdapter'
import { defaultLineupRuleDeps, evaluateLineupRulesWithParity } from '../lib/decision-os/lineup/rules'
import { resolveLineupWorld } from '../lib/decision-os/lineup/world'
import { toCanonicalPlayerData } from '../lib/decision-os/lineup/canonicalAdapter'
import { buildProductionCanonicalValidatorDep } from '../lib/decision-os/lineup/deps'
import { registerDecisionTelemetrySink } from '../lib/decision-os/core/telemetry'
import type { LineupActionSummaryPayload } from '../lib/lineup-actions/types'

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures++
}

/** A representative legacy summary (the route uses computeLineupActionsForUser; for the loader/
 *  pipeline DB-parity we feed a representative one so parity logic + recommendation flow are exercised). */
function legacySummaryFor(leagueId: string): LineupActionSummaryPayload {
  const action = {
    leagueId, leagueName: 'Staging Parity', sport: 'NFL' as never, platform: 'native', teamId: 't',
    slotIndex: 0, slotId: 'QB', slotLabel: 'QB', playerId: 'sp-qb', playerName: 'Staging QB',
    reasonType: 'empty_starter' as const, urgency: 'urgent' as const, lockTime: null,
    recommendedAction: 'Set a starter for QB.', suggestedReplacementPlayerId: null,
    confidence: 0.8, expectedGain: 5, sourceModule: 'lineup_scan' as const, message: 'QB slot empty.', severity: 'critical' as const,
  }
  return {
    totalIssues: 1, totalUnresolvedSlotActions: 1, scanWarningLeagues: 0, leaguesNeedingAttention: 1,
    lineupsNeedingAttention: 1, urgentLineupActions: 1, lockedMissedActions: 0, displayMode: 'unresolved_slots',
    displayCount: 1, displayLabelKey: 'k', displayLabelParams: {}, displaySubtextKey: null, displaySubtextParams: null,
    urgentSubtextKey: null, urgentSubtextParams: null, actions: [action],
    leagues: [{ leagueId, leagueName: 'Staging Parity', leagueAvatar: null, sport: 'NFL', platform: 'native', issues: [], chimmyAdvice: '', actions: [action], scanIncomplete: false }],
    scannedLeagues: 1, scannedSleeperLeagues: 0, scannedNativeLeagues: 1, lastUpdatedAt: new Date().toISOString(),
  }
}

;(async () => {
  const prisma = new PrismaClient()
  const host = (() => { try { return new URL((process.env.DATABASE_URL ?? '').replace(/^postgres(ql)?:\/\//, 'http://')).host } catch { return '?' } })()
  console.log(`Slice 1 staging parity — DB host: ${host}`)
  if (host.includes('ep-spring-tooth')) { console.error('REFUSING to run against the production host.'); process.exit(2) }

  const events: { event: string; flags?: Record<string, unknown> }[] = []
  registerDecisionTelemetrySink((e) => events.push(e as never))

  let seeded: Awaited<ReturnType<typeof seedNflRedraftLeague>> | null = null
  try {
    seeded = await seedNflRedraftLeague(prisma, { season: 2025 })
    // Real players on the user's roster.
    await addRosterPlayer(prisma, seeded.homeRosterId, { playerId: 'sp-qb', name: 'Staging QB', position: 'QB', slotType: 'QB' })
    await addRosterPlayer(prisma, seeded.homeRosterId, { playerId: 'sp-rb', name: 'Staging RB', position: 'RB', slotType: 'RB' })
    await addRosterPlayer(prisma, seeded.homeRosterId, { playerId: 'sp-wr', name: 'Staging WR', position: 'WR', slotType: 'WR' })
    const { userId, leagueId, homeRosterId } = seeded

    // Loader uses the REAL prisma reads (roster+players+season, league.settings); we supply the roster
    // id the way resolveRedraftRosterLookup would for an owned roster.
    const loaderDeps = { ...defaultLineupLoaderDeps, lookup: async () => ({ season: { leagueId }, roster: { id: homeRosterId } }) }

    // 1) Loader reads real Prisma data.
    const input = await loadLineupSetInputs(userId, leagueId, loaderDeps)
    check('loader RAN against staging (non-null input)', Boolean(input))
    check('loader read REAL players from staging', (input?.players.length ?? 0) >= 3, `players=${input?.players.length}`)
    check('loader resolved sport + week from real season', input?.sport === 'NFL' && input?.leagueWeek === 1, `sport=${input?.sport} week=${input?.leagueWeek}`)

    // 2) Shadow runs end-to-end on real data; parity computed; legacy untouched.
    const legacy = legacySummaryFor(leagueId)
    const legacySnapshot = JSON.stringify(legacy)
    const res = await runLineupShadow({ userId, leagueId, legacySummary: legacy }, { loadInputs: (u, l) => loadLineupSetInputs(u, l, loaderDeps) })
    check('shadow RAN on real data', res.ran === true)
    check('parity PASSED (Decision OS == legacy source, no drift)', res.parity?.passed === true, `diffs=${res.parity?.diffs.length ?? '?'}`)
    check('legacy summary was NOT mutated by the shadow', JSON.stringify(legacy) === legacySnapshot)

    // 3) Telemetry observed.
    const issued = events.find((e) => e.event === 'decision.issued')
    check('telemetry: decision.issued with architecture flags', Boolean(issued?.flags?.dco_consumed && issued?.flags?.rule_gated && issued?.flags?.decision_object_emitted && issued?.flags?.world_resolution_read_only))
    check('telemetry: decision.shadow_parity (shadow ran)', events.some((e) => e.event === 'decision.shadow_parity' && e.flags?.shadow === true && e.flags?.ran === true))

    // 4) Decision Object + Today Card on real data.
    const { decision } = await runLineupSetDecision(input!, { decision: { recommend: async () => legacy, ruleDeps: defaultLineupRuleDeps } })
    check('Decision Object has all four contract answers', Boolean(decision.four_answers.what_happened && decision.four_answers.why_it_matters && decision.four_answers.how_confident && decision.four_answers.what_to_do))
    check('legality came from the Rule Framework (verdicts present/array)', Array.isArray(decision.rule_verdicts))
    const card = toTodayLineupCard(decision)
    check('Today Card adapter renders from the Decision', typeof card.title === 'string' && card.title.length > 0)

    // 5) CANONICAL VALIDATOR PARITY on real seeded data (Ticket #6).
    //    The canonical context loads at the route seam (full league row + resolved roster template),
    //    toCanonicalPlayerData converts the real roster, the canonical validator runs, and parity is
    //    computed against the primary validator — proving the second validator is wired in shadow.
    const vctx = await loadCanonicalValidatorContext(leagueId, input!.leagueWeek)
    check('canonical validator context LOADED from staging (league row + template)', Boolean(vctx))
    if (vctx) {
      const sections = toCanonicalPlayerData(input!.players) as Record<string, unknown[]>
      check('toCanonicalPlayerData converted REAL seeded roster into sections', (sections.starters?.length ?? 0) >= 1, `starters=${sections.starters?.length}`)

      const world = resolveLineupWorld({ sport: input!.sport, leagueSettings: input!.leagueSettings, leagueWeek: input!.leagueWeek, editingWeek: input!.editingWeek })
      const evaluation = evaluateLineupRulesWithParity(
        { sport: input!.sport, week: world.week, players: input!.players, rosterConfig: world.facts.rosterConfig, lockState: world.lock_state },
        { ...defaultLineupRuleDeps, validateCanonical: buildProductionCanonicalValidatorDep(vctx) },
      )
      check('canonical validator RAN (no canonical_validator_error)', !evaluation.parity.canonicalError, evaluation.parity.canonicalError ?? '')
      check('validator parity computed (agree on shared scope)', evaluation.parity.agreeOnSharedScope === true, `reason=${evaluation.parity.reason}`)
      check('retirement is NOT safe — validators are complementary (expected)', evaluation.retirementSafe === false, `retirementSafe=${evaluation.retirementSafe}`)
      console.log('--- VALIDATOR PARITY (sample) ---')
      console.log(JSON.stringify({ reason: evaluation.parity.reason, agreeOnSharedScope: evaluation.parity.agreeOnSharedScope, coverageDifferences: evaluation.parity.coverageDifferences, retirementSafe: evaluation.parity.retirementSafe }, null, 2))
    }

    // 6) End-to-end shadow with the canonical context wired (real default loader) emits validator telemetry.
    const res2 = await runLineupShadow(
      { userId, leagueId, legacySummary: legacy },
      { loadInputs: (u, l) => loadLineupSetInputs(u, l, loaderDeps) },
    )
    check('shadow ran validator parity end-to-end (validatorParity present)', Boolean(res2.validatorParity), `reason=${res2.validatorParity?.reason ?? 'n/a'}`)
    check('telemetry: validator_parity_ran emitted', events.some((e) => e.event === 'decision.validator_parity' && (e.flags as Record<string, unknown> | undefined)?.validator_parity_ran === true))

    console.log('--- DECISION (sample) ---')
    console.log(JSON.stringify({ four_answers: decision.four_answers, confidence: decision.confidence, data_completeness: decision.data_completeness, verdicts: decision.rule_verdicts.length, lock: input!.leagueWeek }, null, 2))
  } finally {
    registerDecisionTelemetrySink(null)
    if (seeded) {
      await prisma.redraftRosterPlayer.deleteMany({ where: { rosterId: seeded.homeRosterId } }).catch(() => undefined)
      await cleanupSeededLeague(prisma, seeded).catch((e: unknown) => console.warn('cleanup warn:', e instanceof Error ? e.message : e))
    }
    await prisma.$disconnect()
  }

  console.log(failures === 0 ? 'SLICE1_STAGING_PARITY_OK' : `SLICE1_STAGING_PARITY_FAILED (${failures} checks failed)`)
  process.exit(failures === 0 ? 0 : 1)
})().catch((e) => { console.error('FATAL', e instanceof Error ? e.stack : e); process.exit(1) })
