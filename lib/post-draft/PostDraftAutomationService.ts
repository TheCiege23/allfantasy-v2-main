/**
 * Post-draft automation: deterministic summary, pick log, team results, value/reach, budget, keeper, devy/C2C.
 * No AI required. Run when draft status is completed.
 */

import { prisma } from '@/lib/prisma'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import type { DraftSessionSnapshot, SlotOrderEntry } from '@/lib/live-draft-engine/types'
import type {
  PostDraftSummary,
  PickLogEntry,
  TeamResultEntry,
  ValueReachEntry,
  BudgetSummaryEntry,
  KeeperOutcomeEntry,
} from './types'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

/**
 * Build full deterministic post-draft summary for a completed draft.
 */
export async function buildPostDraftSummary(leagueId: string): Promise<PostDraftSummary | null> {
  const snapshot = await buildSessionSnapshot(leagueId)
  if (!snapshot || snapshot.status !== 'completed') return null

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { name: true, sport: true },
  })

  const picks = snapshot.picks ?? []
  const slotOrder = (snapshot.slotOrder ?? []) as SlotOrderEntry[]
  const totalPicks = snapshot.rounds * snapshot.teamCount

  const byPosition: Record<string, number> = {}
  for (const p of picks) {
    const pos = p.position || 'OTHER'
    byPosition[pos] = (byPosition[pos] ?? 0) + 1
  }

  const pickLog: PickLogEntry[] = picks.map((p) => ({
    id: p.id,
    overall: p.overall,
    round: p.round,
    slot: p.slot,
    rosterId: p.rosterId,
    displayName: p.displayName ?? null,
    playerName: p.playerName,
    position: p.position,
    team: p.team ?? null,
    amount: (p as { amount?: number | null }).amount ?? undefined,
    pickLabel: p.pickLabel ?? `${p.overall}`,
  }))

  const teamResults: TeamResultEntry[] = slotOrder.map((s) => {
    const teamPicks = picks.filter((p) => p.rosterId === s.rosterId)
    const totalSpent = snapshot.draftType === 'auction'
      ? teamPicks.reduce((sum, p) => sum + (Number((p as any).amount) || 0), 0)
      : undefined
    return {
      rosterId: s.rosterId,
      displayName: s.displayName ?? `Team ${s.slot}`,
      slot: s.slot,
      pickCount: teamPicks.length,
      picks: teamPicks.map((p) => ({
        id: p.id,
        overall: p.overall,
        round: p.round,
        slot: p.slot,
        rosterId: p.rosterId,
        displayName: p.displayName ?? null,
        playerName: p.playerName,
        position: p.position,
        team: p.team ?? null,
        amount: (p as any).amount ?? undefined,
        pickLabel: p.pickLabel ?? `${p.overall}`,
      })),
      ...(totalSpent != null ? { totalSpent } : {}),
    }
  })

  const positionFirstPick: Record<string, { overall: number; displayName: string | null }> = {}
  for (const p of picks) {
    const pos = p.position || 'OTHER'
    if (positionFirstPick[pos] == null || p.overall < positionFirstPick[pos].overall) {
      positionFirstPick[pos] = { overall: p.overall, displayName: p.displayName ?? null }
    }
  }
  const valueReach: ValueReachEntry[] = Object.entries(positionFirstPick)
    .sort((a, b) => a[1].overall - b[1].overall)
    .map(([position, { overall, displayName }]) => ({
      position,
      earliestOverall: overall,
      firstPickBy: displayName,
    }))

  let budgetSummary: BudgetSummaryEntry[] | undefined
  if (snapshot.draftType === 'auction' && snapshot.auction) {
    const budgetPerTeam = snapshot.auction.budgetPerTeam ?? 200
    budgetSummary = slotOrder.map((s) => {
      const spent = teamResults.find((t) => t.rosterId === s.rosterId)?.totalSpent ?? 0
      return {
        rosterId: s.rosterId,
        displayName: s.displayName ?? `Team ${s.slot}`,
        slot: s.slot,
        budget: budgetPerTeam,
        spent,
        remaining: Math.max(0, budgetPerTeam - spent),
      }
    })
  }

  let keeperOutcome: KeeperOutcomeEntry[] | undefined
  if (snapshot.keeper?.selections?.length) {
    keeperOutcome = snapshot.keeper.selections.map((sel) => {
      const slotEntry = slotOrder.find((e) => e.rosterId === sel.rosterId)
      return {
        rosterId: sel.rosterId,
        displayName: slotEntry?.displayName ?? sel.rosterId,
        roundCost: sel.roundCost,
        playerName: sel.playerName,
        position: sel.position,
        team: sel.team ?? null,
      }
    })
  }

  return {
    leagueId,
    leagueName: league?.name ?? null,
    sport: league?.sport ?? 'NFL',
    draftType: snapshot.draftType ?? 'snake',
    status: snapshot.status,
    rounds: snapshot.rounds,
    teamCount: snapshot.teamCount,
    totalPicks,
    pickCount: picks.length,
    byPosition,
    pickLog,
    teamResults,
    valueReach,
    ...(budgetSummary ? { budgetSummary } : {}),
    ...(keeperOutcome?.length ? { keeperOutcome } : {}),
    ...(snapshot.devy?.enabled ? { devyRounds: snapshot.devy.devyRounds ?? [] } : {}),
    ...(snapshot.c2c?.enabled ? { c2cCollegeRounds: snapshot.c2c.collegeRounds ?? [] } : {}),
  }
}

/**
 * Ensure rosters are finalized (idempotent). Call after draft completion.
 */
export async function ensurePostDraftFinalized(leagueId: string): Promise<boolean> {
  const { repairDraftCompletionIfBoardFull, runPostDraftFinalizationArtifacts } = await import(
    '@/lib/live-draft-engine/postDraftFinalizeArtifacts'
  )

  await repairDraftCompletionIfBoardFull(leagueId).catch((e) => {
    console.error('[ensurePostDraftFinalized] repairDraftCompletionIfBoardFull', leagueId, e)
  })

  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { status: true },
  })
  if (!session || session.status !== 'completed') return false

  try {
    /** Full run (not poll-throttled): recap/summary routes must materialize rosters + grades from the saved board. */
    await runPostDraftFinalizationArtifacts(leagueId)
  } catch (e) {
    console.error('[ensurePostDraftFinalized] runPostDraftFinalizationArtifacts', leagueId, e)
  }
  return true
}
