/**
 * Slice 2 — staging DB-parity verification for `manager.waiver.claim` (Ticket #16).
 *
 * Verifies the Decision OS waiver SHADOW path against REAL staging Prisma data (NOT prod): the
 * route-seam loader reads the unified Roster + league waiver settings, the real recommender
 * (runWaiverAIService → suggestWaiverPickups) produces deterministic suggestions, the Decision OS
 * wrapper emits a Decision Object, wrap-fidelity parity is computed, telemetry fires, and — critically
 * — NO claim is executed (zero waiverClaim / waiverTransaction rows created). Read-only against
 * everything except the temporary seeded league (cleaned up).
 *
 *   DATABASE_URL=<staging> node --import tsx scripts/slice2-staging-parity.ts
 *
 * HARD SAFETY: refuses to run against the production host; never invokes /api/waiver-wire/.../claims.
 */
import { PrismaClient } from '@prisma/client'
import { runWaiverAIService } from '../lib/waiver-ai-engine'
import type { WaiverAIServiceInput } from '../lib/waiver-ai-engine'
import { loadWaiverWorldFacts } from '../lib/decision-os/waiver/loader'
import { runWaiverShadowForEngine } from '../lib/decision-os/waiver/shadow'
import { evaluateWaiverRules } from '../lib/decision-os/waiver/rules'
import { resolveWaiverWorld } from '../lib/decision-os/waiver/world'
import { registerDecisionTelemetrySink } from '../lib/decision-os/core/telemetry'

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures++
}

;(async () => {
  const prisma = new PrismaClient()
  const host = (() => {
    try {
      return new URL((process.env.DATABASE_URL ?? '').replace(/^postgres(ql)?:\/\//, 'http://')).host
    } catch {
      return '?'
    }
  })()
  console.log(`Slice 2 staging parity — DB host: ${host}`)
  if (host.includes('ep-spring-tooth')) {
    console.error('REFUSING to run against the production host.')
    process.exit(2)
  }

  const events: { event: string; flags?: Record<string, unknown> }[] = []
  registerDecisionTelemetrySink((e) => events.push(e as never))

  const mark = `S2-WVR-${Date.now()}-${Math.floor(Math.random() * 1e4)}`
  let userId = ''
  let leagueId = ''
  try {
    // ── Seed an isolated native league + unified Roster (the canonical waiver path's model) ──
    const user = await (prisma as any).appUser.create({ data: { email: `${mark}@e2e.local`, username: mark } })
    userId = user.id
    const league = await (prisma as any).league.create({
      data: { userId: user.id, platform: 'native', platformLeagueId: mark, name: mark, sport: 'NFL', season: 2025, rosterSize: 16 },
    })
    leagueId = league.id
    await (prisma as any).leagueWaiverSettings.create({
      data: { leagueId, waiverType: 'faab', faabBudget: 100, instantFaAfterClear: true },
    })
    // Unified Roster owned by the user (platformUserId = user id). Two players on the roster.
    await (prisma as any).roster.create({
      data: {
        leagueId,
        platformUserId: user.id,
        playerData: { players: [`${mark}-rb`, `${mark}-wr`] },
        faabRemaining: 60,
        waiverPriority: 3,
      },
    })

    // ── Baseline: NO waiver claims / transactions for this league ──
    const claimsBefore = await (prisma as any).waiverClaim.count({ where: { leagueId } })
    const txBefore = await (prisma as any).waiverTransaction.count({ where: { leagueId } })
    check('baseline: zero waiverClaim rows', claimsBefore === 0, `count=${claimsBefore}`)
    check('baseline: zero waiverTransaction rows', txBefore === 0, `count=${txBefore}`)

    // 1) Loader reads REAL staging data (unified Roster + settings).
    const facts = await loadWaiverWorldFacts(userId, leagueId)
    check('loader RAN against staging (non-null facts)', Boolean(facts))
    check('loader read league + roster id + platform user', Boolean(facts?.leagueId && facts?.rosterId), `rosterId=${facts?.rosterId}`)
    check('loader read FAAB remaining + waiver priority', facts?.faabRemaining === 60 && facts?.waiverPriority === 3, `faab=${facts?.faabRemaining} prio=${facts?.waiverPriority}`)
    check('loader resolved settings (faab waiver type)', facts?.settings.normalizedWaiverType === 'faab', `type=${facts?.settings.normalizedWaiverType}`)
    check('loader read roster snapshot size', (facts?.rosterSize ?? 0) >= 2, `size=${facts?.rosterSize}`)
    if (!facts) throw new Error('loader returned null — cannot continue')

    // 2) Assemble the real recommender input + run the REAL deterministic engine.
    const engineInput: WaiverAIServiceInput = {
      sport: 'NFL',
      leagueId,
      leagueSettings: { numTeams: 12 },
      roster: [{ id: `${mark}-rb`, name: 'My RB', position: 'RB', team: 'BUF', slot: 'bench', age: 26, value: 1200 }],
      availablePlayers: [
        { playerId: `${mark}-fa1`, playerName: 'Free Agent RB', position: 'RB', team: 'KC', value: 1800 },
        { playerId: `${mark}-fa2`, playerName: 'Free Agent WR', position: 'WR', team: 'MIA', value: 1500 },
      ],
      goal: 'balanced',
      maxResults: 8,
    }
    const analysis = await runWaiverAIService(engineInput)
    check('runWaiverAIService produced deterministic suggestions', (analysis.deterministic?.suggestions?.length ?? 0) >= 1, `n=${analysis.deterministic?.suggestions?.length}`)

    // 3) Shadow runs end-to-end on real data (DEFAULT deps: real loader + real eligibility gate).
    const res = await runWaiverShadowForEngine({ userId, leagueId, engineInput, legacyAnalysis: analysis })
    check('shadow RAN on real data', res.ran === true, res.error ?? '')
    check('parity PASSED (wrap fidelity, Decision OS == legacy suggestions)', res.result?.parity?.passed === true, `diffs=${res.result?.parity?.diffs.length ?? '?'}`)
    check('parity is flagged wrap_fidelity', res.result?.parity?.wrapFidelity === true)

    // 4) Decision Object has all four contract answers + rule verdicts (real eligibility gate ran).
    const decision = res.result?.decision
    check('Decision Object has all four contract answers', Boolean(decision?.four_answers.what_happened && decision?.four_answers.why_it_matters && decision?.four_answers.how_confident && decision?.four_answers.what_to_do))
    check('legality came from the Rule Framework (verdicts present/array)', Array.isArray(decision?.rule_verdicts))

    // 5) AI explanation is ignored for parity (det vs ai prose → identical parity).
    const aiAnalysis = { ...analysis, explanation: { source: 'ai' as const, text: 'AI prose to ignore.' } }
    const resAi = await runWaiverShadowForEngine({ userId, leagueId, engineInput, legacyAnalysis: aiAnalysis })
    check('AI prose ignored — parity still passes', resAi.result?.parity?.passed === true)

    // 6) Rule Framework maps a thrown eligibility error → RuleVerdict (deterministic proof).
    const world = resolveWaiverWorld({
      sport: facts.sport, leagueId, settings: facts.settings, settingsKnown: facts.settingsKnown,
      faabRemaining: facts.faabRemaining, waiverPriority: facts.waiverPriority,
    })
    const thrownVerdicts = await evaluateWaiverRules(
      { claim: { addPlayerId: `${mark}-fa1`, dropPlayerId: null, faabBid: 999 }, world },
      { assertEligibility: async () => { throw new Error('Insufficient FAAB for this bid.') } },
    )
    check('thrown eligibility error mapped to illegal verdict', thrownVerdicts.some((v) => v.rule === 'waiver.legality.insufficient_faab' && v.verdict === 'illegal'))

    // 7) Telemetry observed (split events; NOT the legacy combined name).
    check('telemetry: decision.issued emitted', events.some((e) => e.event === 'decision.issued' && e.flags?.world_resolution_read_only === true))
    check('telemetry: decision.shadow_parity with wrap_fidelity', events.some((e) => e.event === 'decision.shadow_parity' && e.flags?.wrap_fidelity === true))
    check('telemetry: no legacy decision.parity event', !events.some((e) => e.event === 'decision.parity'))

    // 8) PROOF: no claim execution — zero waiverClaim / waiverTransaction rows created.
    const claimsAfter = await (prisma as any).waiverClaim.count({ where: { leagueId } })
    const txAfter = await (prisma as any).waiverTransaction.count({ where: { leagueId } })
    check('NO waiverClaim rows created by the shadow', claimsAfter === claimsBefore && claimsAfter === 0, `after=${claimsAfter}`)
    check('NO waiverTransaction rows created by the shadow', txAfter === txBefore && txAfter === 0, `after=${txAfter}`)

    console.log('--- DECISION (sample) ---')
    console.log(JSON.stringify({
      four_answers: decision?.four_answers,
      confidence: decision?.confidence,
      data_completeness: decision?.data_completeness,
      verdicts: decision?.rule_verdicts.length,
      topClaim: decision?.recommended_actions[0]?.addPlayerName,
      parity: { passed: res.result?.parity?.passed, diffs: res.result?.parity?.diffs.length, wrapFidelity: res.result?.parity?.wrapFidelity },
    }, null, 2))
  } finally {
    registerDecisionTelemetrySink(null)
    // Cleanup: delete settings + cascade-delete league/roster via AppUser, then ensure league gone.
    await (prisma as any).leagueWaiverSettings.deleteMany({ where: { leagueId } }).catch(() => undefined)
    if (userId) await (prisma as any).appUser.delete({ where: { id: userId } }).catch(() => undefined)
    if (leagueId) await (prisma as any).league.delete({ where: { id: leagueId } }).catch(() => undefined)
    await prisma.$disconnect()
  }

  console.log(failures === 0 ? 'SLICE2_STAGING_PARITY_OK' : `SLICE2_STAGING_PARITY_FAILED (${failures} checks failed)`)
  process.exit(failures === 0 ? 0 : 1)
})().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.stack : e)
  process.exit(1)
})
