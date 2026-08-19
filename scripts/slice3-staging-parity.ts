/**
 * Slice 3 — staging DB-parity verification for `manager.trade.evaluate` (Ticket #21).
 *
 * Verifies the Decision OS trade-evaluation SHADOW path against REAL staging Prisma data (NOT prod):
 * seeds a redraft league + two rosters, creates a trade proposal + assets, captures the authoritative
 * deterministic snapshot, then runs the Decision OS shadow — proving the loader reads the snapshot, a
 * Decision Object is emitted, WRAP-FIDELITY parity passes, telemetry fires, and — critically — NO
 * trade execution/mutation occurs (no new proposal/vote/settlement rows; proposal stays pending;
 * rosters/FAAB unchanged). Read-only except the temporary seeded league (cleaned up).
 *
 *   DATABASE_URL=<staging> node --import tsx scripts/slice3-staging-parity.ts
 *
 * HARD SAFETY: refuses the production host; the Decision OS never accepts/processes/settles a trade.
 */
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { seedNflRedraftLeague, addRosterPlayer, cleanupSeededLeague } from '../tests/helpers/redraftSeasonHarness'
import { captureRedraftTradeValueSnapshot } from '../lib/trade-value/captureSnapshot'
import { runTradeShadowForProposal } from '../lib/decision-os/trade/shadow'
import { registerDecisionTelemetrySink } from '../lib/decision-os/core/telemetry'

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures++
}

;(async () => {
  const prisma = new PrismaClient()
  const host = (() => { try { return new URL((process.env.DATABASE_URL ?? '').replace(/^postgres(ql)?:\/\//, 'http://')).host } catch { return '?' } })()
  console.log(`Slice 3 staging parity — DB host: ${host}`)
  if (host.includes('ep-spring-tooth')) { console.error('REFUSING to run against the production host.'); process.exit(2) }

  const events: { event: string; flags?: Record<string, unknown> }[] = []
  registerDecisionTelemetrySink((e) => events.push(e as never))

  let seeded: Awaited<ReturnType<typeof seedNflRedraftLeague>> | null = null
  try {
    seeded = await seedNflRedraftLeague(prisma, { season: 2025, faab: 100 })
    const { userId, leagueId, seasonId, homeRosterId, awayRosterId } = seeded
    await addRosterPlayer(prisma, homeRosterId, { playerId: `${seeded.mark}-rb`, name: 'Home RB', position: 'RB', slotType: 'RB' })
    await addRosterPlayer(prisma, awayRosterId, { playerId: `${seeded.mark}-wr`, name: 'Away WR', position: 'WR', slotType: 'WR' })

    // Create a real trade proposal + assets (home RB ⇄ away WR).
    const proposalId = randomUUID()
    await (prisma as any).redraftTradeProposal.create({
      data: { id: proposalId, leagueId, seasonId, proposerRosterId: homeRosterId, receiverRosterId: awayRosterId, vetoMode: 'commissioner', vetoThreshold: 4, expiresAt: new Date(Date.now() + 48 * 3600 * 1000) },
    })
    const assets = [
      { fromRosterId: homeRosterId, toRosterId: awayRosterId, assetType: 'player', playerId: `${seeded.mark}-rb`, playerName: 'Home RB', metadata: { position: 'RB', restOfSeasonProjection: 180 } },
      { fromRosterId: awayRosterId, toRosterId: homeRosterId, assetType: 'player', playerId: `${seeded.mark}-wr`, playerName: 'Away WR', metadata: { position: 'WR', restOfSeasonProjection: 165 } },
    ]
    await (prisma as any).redraftTradeAsset.createMany({
      data: assets.map((a) => ({ id: randomUUID(), proposalId, fromRosterId: a.fromRosterId, toRosterId: a.toRosterId, assetType: a.assetType, playerId: a.playerId, playerName: a.playerName, metadata: a.metadata })),
    })

    // Capture the authoritative deterministic snapshot (same call the create route makes).
    await captureRedraftTradeValueSnapshot({
      proposalId, seasonId, proposerRosterId: homeRosterId, receiverRosterId: awayRosterId,
      sport: 'NFL', scoring: 'ppr', rosterFormat: 'standard', currentSeason: 2025,
      assets: assets.map((a) => ({ fromRosterId: a.fromRosterId, toRosterId: a.toRosterId, assetType: a.assetType, playerId: a.playerId, playerName: a.playerName, metadata: a.metadata })),
    })
    const snapshotRow = await (prisma as any).redraftTradeValueSnapshot.findUnique({ where: { proposalId } })
    check('authoritative snapshot captured (deterministic)', Boolean(snapshotRow?.payload), `grade=${snapshotRow?.grade}`)

    // Baseline state (for the no-mutation proof).
    const beforeProposals = await (prisma as any).redraftTradeProposal.count({ where: { leagueId } })
    const beforeSnapshots = await (prisma as any).redraftTradeValueSnapshot.count({ where: { proposal: { leagueId } } })
    const beforeVotes = await (prisma as any).redraftTradeVote.count({ where: { proposal: { leagueId } } }).catch(() => 0)
    const homeBefore = await (prisma as any).redraftRoster.findUnique({ where: { id: homeRosterId }, select: { faabBalance: true } })
    const propBefore = await (prisma as any).redraftTradeProposal.findUnique({ where: { id: proposalId }, select: { status: true } })

    // Run the shadow with DEFAULT deps (real loader + persisted snapshot memo).
    const res = await runTradeShadowForProposal({
      userId, leagueId, seasonId,
      proposal: { proposalId, proposerRosterId: homeRosterId, receiverRosterId: awayRosterId, status: 'pending', vetoMode: 'commissioner' },
      assets: assets.map((a) => ({ fromRosterId: a.fromRosterId, toRosterId: a.toRosterId, assetType: a.assetType, playerId: a.playerId, playerName: a.playerName, faabAmount: null })),
      snapshotPayload: snapshotRow.payload,
      snapshotConfidenceScore: snapshotRow.confidenceScore ?? null,
    })
    check('shadow RAN on real data', res.ran === true, res.error ?? '')
    check('parity PASSED (wrap fidelity, Decision OS == captured snapshot)', res.result?.parity?.passed === true, `diffs=${res.result?.parity?.diffs.length ?? '?'}`)
    check('parity flagged wrap_fidelity', res.result?.parity?.wrapFidelity === true)

    const decision = res.result?.decision
    check('Decision Object has all four contract answers', Boolean(decision?.four_answers.what_happened && decision?.four_answers.why_it_matters && decision?.four_answers.how_confident && decision?.four_answers.what_to_do))
    check('legality came from the Rule Framework (verdicts present/array)', Array.isArray(decision?.rule_verdicts))
    check('automation_capable is false (Decision OS never executes a trade)', decision?.automation_capable === false)

    // Telemetry.
    check('telemetry: decision.issued (read-only flag)', events.some((e) => e.event === 'decision.issued' && e.flags?.world_resolution_read_only === true))
    check('telemetry: decision.shadow_parity with wrap_fidelity', events.some((e) => e.event === 'decision.shadow_parity' && e.flags?.wrap_fidelity === true))
    check('telemetry: no legacy decision.parity event', !events.some((e) => e.event === 'decision.parity'))

    // PROOF: no execution / mutation.
    const afterProposals = await (prisma as any).redraftTradeProposal.count({ where: { leagueId } })
    const afterSnapshots = await (prisma as any).redraftTradeValueSnapshot.count({ where: { proposal: { leagueId } } })
    const afterVotes = await (prisma as any).redraftTradeVote.count({ where: { proposal: { leagueId } } }).catch(() => 0)
    const homeAfter = await (prisma as any).redraftRoster.findUnique({ where: { id: homeRosterId }, select: { faabBalance: true } })
    const propAfter = await (prisma as any).redraftTradeProposal.findUnique({ where: { id: proposalId }, select: { status: true } })
    check('NO new trade proposal rows created by the shadow', afterProposals === beforeProposals, `before=${beforeProposals} after=${afterProposals}`)
    check('NO new value snapshot rows created by the shadow', afterSnapshots === beforeSnapshots, `before=${beforeSnapshots} after=${afterSnapshots}`)
    check('NO trade vote rows created by the shadow', afterVotes === beforeVotes, `before=${beforeVotes} after=${afterVotes}`)
    check('proposal remains pending (no accept/reject/settle)', propAfter?.status === propBefore?.status && propAfter?.status === 'pending', `status=${propAfter?.status}`)
    check('roster FAAB unchanged (no settlement)', homeAfter?.faabBalance === homeBefore?.faabBalance, `before=${homeBefore?.faabBalance} after=${homeAfter?.faabBalance}`)

    console.log('--- DECISION (sample) ---')
    console.log(JSON.stringify({ four_answers: decision?.four_answers, grade: decision?.recommended_actions[0]?.grade, fairness: decision?.recommended_actions[0]?.fairnessScore, parity: { passed: res.result?.parity?.passed, diffs: res.result?.parity?.diffs.length, wrapFidelity: res.result?.parity?.wrapFidelity } }, null, 2))
  } finally {
    registerDecisionTelemetrySink(null)
    if (seeded) await cleanupSeededLeague(prisma, seeded).catch((e: unknown) => console.warn('cleanup warn:', e instanceof Error ? e.message : e))
    await prisma.$disconnect()
  }

  console.log(failures === 0 ? 'SLICE3_STAGING_PARITY_OK' : `SLICE3_STAGING_PARITY_FAILED (${failures} checks failed)`)
  process.exit(failures === 0 ? 0 : 1)
})().catch((e) => { console.error('FATAL', e instanceof Error ? e.stack : e); process.exit(1) })
