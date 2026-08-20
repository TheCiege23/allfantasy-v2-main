/**
 * Slice 4 — staging DB-parity verification for `commissioner.league.health` (Ticket #27).
 *
 * Verifies the Decision OS commissioner-health SHADOW path against REAL staging Prisma data (NOT
 * prod): seeds a commissioner league + a unified Roster, builds the authoritative deterministic
 * health snapshot (the same `buildCommissionerHealthSnapshot` the hub uses), then runs the Decision
 * OS shadow — proving a Decision Object is emitted, WRAP-FIDELITY parity passes, telemetry fires, and
 * — critically — NO league/roster/settings mutation, NO commissioner action, NO announcement occurs.
 * Read-only except the temporary seeded league (cleaned up).
 *
 *   DATABASE_URL=<staging> node --import tsx scripts/slice4-staging-parity.ts
 *
 * HARD SAFETY: refuses the production host; the Decision OS assesses only — it never executes.
 */
import { PrismaClient } from '@prisma/client'
import { buildCommissionerHealthSnapshot } from '../lib/commissioner-hub/commissionerHubHealth'
import { runCommissionerHealthShadow } from '../lib/decision-os/commissioner-health/shadow'
import { registerDecisionTelemetrySink } from '../lib/decision-os/core/telemetry'
import { assertNonProductionDbTarget, describeDbTarget, resolveDatabaseUrlFromDisk } from './_db-target-identity'

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures++
}

;(async () => {
  const prisma = new PrismaClient()
  const dbTargetUrl = resolveDatabaseUrlFromDisk()
  console.log(`Slice 4 staging parity — DB target: ${describeDbTarget(dbTargetUrl)}`)
  assertNonProductionDbTarget({ script: 'slice4-staging-parity', url: dbTargetUrl, action: 'seeds and mutates league rows', exitCode: 2 })

  const events: { event: string; flags?: Record<string, unknown> }[] = []
  registerDecisionTelemetrySink((e) => events.push(e as never))

  const mark = `S4-HEALTH-${Date.now()}-${Math.floor(Math.random() * 1e4)}`
  let userId = ''
  let leagueId = ''
  try {
    const user = await (prisma as any).appUser.create({ data: { email: `${mark}@e2e.local`, username: mark } })
    userId = user.id
    const league = await (prisma as any).league.create({
      data: { userId: user.id, platform: 'native', platformLeagueId: mark, name: mark, sport: 'NFL', season: 2025, leagueSize: 12, lifecycleState: 'in_season' },
    })
    leagueId = league.id
    await (prisma as any).roster.create({
      data: { leagueId, platformUserId: user.id, playerData: { players: [`${mark}-a`, `${mark}-b`] } },
    })

    // Read the league exactly as the assembler does, then build the authoritative snapshot.
    const dbLeague = await (prisma as any).league.findUnique({
      where: { id: leagueId },
      select: {
        id: true, name: true, sport: true, season: true, leagueSize: true, status: true, lifecycleState: true,
        leagueType: true, isDynasty: true, scoring: true, settings: true, starters: true, waiverType: true,
        tradeReviewHours: true, playoffTeams: true, lockAllMoves: true,
        rosters: { select: { id: true, platformUserId: true, playerData: true, updatedAt: true, settings: true } },
      },
    })
    const snapshot = buildCommissionerHealthSnapshot({
      league: dbLeague,
      source: 'database',
      counts: { tradeActivity: 4, waiverActivity: 10, pendingWaiverClaims: 1, pendingTrades: 0, chatMessagesLast7Days: 15, commissionerActions: 2, openAiAlerts: 0 },
    })
    check('authoritative snapshot built (deterministic)', Boolean(snapshot?.healthScore != null), `health=${snapshot.healthScore} status=${snapshot.overallStatus}`)

    // Baseline state for the no-mutation proof.
    const settingsBefore = JSON.stringify(dbLeague.settings ?? null)
    const lockBefore = dbLeague.lockAllMoves ?? null
    const rosterCountBefore = await (prisma as any).roster.count({ where: { leagueId } })
    const auditBefore = await (prisma as any).leagueAuditLog.count({ where: { leagueId } }).catch(() => 0)
    const alertBefore = await (prisma as any).aiCommissionerAlert.count({ where: { leagueId } }).catch(() => 0)
    const snapshotJsonBefore = JSON.stringify(snapshot)

    // Run the shadow with DEFAULT deps (real wrap-fidelity memo = the built snapshot).
    const res = await runCommissionerHealthShadow({ userId, snapshot })
    check('shadow RAN on real data', res.ran === true, res.error ?? '')
    check('parity PASSED (wrap fidelity, Decision OS == built snapshot)', res.result?.parity?.passed === true, `diffs=${res.result?.parity?.diffs.length ?? '?'}`)
    check('parity flagged wrap_fidelity', res.result?.parity?.wrapFidelity === true)

    const decision = res.result?.decision
    check('Decision Object has all four contract answers', Boolean(decision?.four_answers.what_happened && decision?.four_answers.why_it_matters && decision?.four_answers.how_confident && decision?.four_answers.what_to_do))
    check('decider_scope is commissioner', decision?.decider_scope === 'commissioner')
    check('automation_capable is false (Decision OS never executes a commissioner action)', decision?.automation_capable === false)
    check('legality came from the Rule Framework (verdicts array, none illegal)', Array.isArray(decision?.rule_verdicts) && !decision!.rule_verdicts.some((v) => v.verdict === 'illegal'))

    // Telemetry.
    check('telemetry: decision.issued (commissioner scope, read-only)', events.some((e) => e.event === 'decision.issued' && e.flags?.decider_scope === 'commissioner' && e.flags?.world_resolution_read_only === true))
    check('telemetry: decision.shadow_parity with wrap_fidelity', events.some((e) => e.event === 'decision.shadow_parity' && e.flags?.wrap_fidelity === true))
    check('telemetry: no legacy decision.parity event', !events.some((e) => e.event === 'decision.parity'))

    // PROOF: no execution / mutation.
    const leagueAfter = await (prisma as any).league.findUnique({ where: { id: leagueId }, select: { settings: true, lockAllMoves: true } })
    const rosterCountAfter = await (prisma as any).roster.count({ where: { leagueId } })
    const auditAfter = await (prisma as any).leagueAuditLog.count({ where: { leagueId } }).catch(() => 0)
    const alertAfter = await (prisma as any).aiCommissionerAlert.count({ where: { leagueId } }).catch(() => 0)
    check('league settings UNCHANGED (no settings mutation)', JSON.stringify(leagueAfter.settings ?? null) === settingsBefore)
    check('lockAllMoves UNCHANGED (no lock/unlock)', (leagueAfter.lockAllMoves ?? null) === lockBefore)
    check('NO commissioner audit-log rows created', auditAfter === auditBefore, `before=${auditBefore} after=${auditAfter}`)
    check('NO AI commissioner alert rows created', alertAfter === alertBefore, `before=${alertBefore} after=${alertAfter}`)
    check('roster count UNCHANGED', rosterCountAfter === rosterCountBefore, `before=${rosterCountBefore} after=${rosterCountAfter}`)
    check('returned snapshot UNCHANGED by the shadow', JSON.stringify(snapshot) === snapshotJsonBefore)

    console.log('--- DECISION (sample) ---')
    console.log(JSON.stringify({ four_answers: decision?.four_answers, healthScore: decision?.recommended_actions[0]?.healthScore, overallStatus: decision?.recommended_actions[0]?.overallStatus, parity: { passed: res.result?.parity?.passed, diffs: res.result?.parity?.diffs.length, wrapFidelity: res.result?.parity?.wrapFidelity } }, null, 2))
  } finally {
    registerDecisionTelemetrySink(null)
    if (userId) await (prisma as any).appUser.delete({ where: { id: userId } }).catch(() => undefined)
    if (leagueId) await (prisma as any).league.delete({ where: { id: leagueId } }).catch(() => undefined)
    await prisma.$disconnect()
  }

  console.log(failures === 0 ? 'SLICE4_STAGING_PARITY_OK' : `SLICE4_STAGING_PARITY_FAILED (${failures} checks failed)`)
  process.exit(failures === 0 ? 0 : 1)
})().catch((e) => { console.error('FATAL', e instanceof Error ? e.stack : e); process.exit(1) })
