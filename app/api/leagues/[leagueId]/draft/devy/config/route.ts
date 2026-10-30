import { isSeasonTournamentDraft, SEASON_DRAFT_MUTATION_BLOCKED } from '@/lib/tournament/seasonDraftMutationGate'
/**
 * PATCH: Set devy draft config (enabled, devyRounds). Commissioner only. Pre-draft only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { prisma } from '@/lib/prisma'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { emptyCollegeRoundsError, sanitizeRoundList } from '@/lib/draft-defaults/draftRoundList'
import { publishRuleChangesEvent } from '@/lib/league-rules-explainer/publishRuleChanges'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const draft = await prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER })
  if (!draft) return NextResponse.json({ error: 'No draft session' }, { status: 404 })
  if (draft.status !== 'pre_draft') {
    return NextResponse.json({ error: 'Devy config cannot be changed after draft has started' }, { status: 400 })
  }

  if (await isSeasonTournamentDraft(leagueId)) return NextResponse.json({ error: SEASON_DRAFT_MUTATION_BLOCKED, code: 'TOURNAMENT_RULES_FROZEN' }, { status: 409 })

  const body = await req.json().catch(() => ({}))
  const enabled = Boolean(body.enabled)
  // Whole rounds 1..draft.rounds, each once, ascending — the same normaliser Settings › Draft uses
  // (lib/draft-defaults/draftRoundList.ts). Kept, normalised, when off: the pick check ignores them.
  const devyRounds = sanitizeRoundList(body.devyRounds, draft.rounds)
  // On with no round would make every round pro-only (the pick check's Array.includes never
  // matches), so it is refused rather than stored — Settings › Draft refuses it too.
  if (enabled && devyRounds.length === 0) {
    return NextResponse.json({ error: emptyCollegeRoundsError('devy', draft.rounds) }, { status: 400 })
  }

  const devyConfig = { enabled, devyRounds }

  // The draft rules as members read them, before the write — for the "What changed" card. Loaded
  // lazily and best-effort (lib/league-rules-explainer/loadDraftRules.ts): it never fails the save.
  const draftRules = await import('@/lib/league-rules-explainer/loadDraftRules').catch(() => null)
  const draftRulesBefore = draftRules ? await draftRules.loadDraftRulesSafe(leagueId) : null

  await prisma.draftSession.update({
    where: { id: draft.id },
    data: { devyConfig: devyConfig as any, version: { increment: 1 }, updatedAt: new Date() },
  })

  // Published silently (no push / email): the league home's "What changed" card is how members hear
  // that the devy rounds moved. Nothing when they did not (a save of the same rounds).
  await publishRuleChangesEvent({
    leagueId,
    actorUserId: userId,
    section: 'draft',
    changes: draftRules ? draftRules.draftRuleChanges(draftRulesBefore, await draftRules.loadDraftRulesSafe(leagueId)) : [],
  })

  const snapshot = await buildSessionSnapshot(leagueId)
  return NextResponse.json({ ok: true, devyConfig, session: snapshot })
}
