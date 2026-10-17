import { isSeasonTournamentDraft, SEASON_DRAFT_MUTATION_BLOCKED } from '@/lib/tournament/seasonDraftMutationGate'
/**
 * Draft pick trade: append traded picks to session and handle proposal accept.
 */

import { prisma } from '@/lib/prisma'
import { buildSessionSnapshot } from './DraftSessionService'
import type { TradedPickRecord } from './types'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { updateSessionWithArchive } from '@/lib/draft-archive/events'

/** The session row an accept-time check sees: read in the same call that writes, so it cannot be stale. */
export type DraftPickTradeSessionView = {
  status: string
  slotOrder: { slot: number; rosterId: string; displayName: string }[]
  tradedPicks: TradedPickRecord[]
  draftedOveralls: Set<number>
  teamCount: number
  draftType: string
  thirdRoundReversal: boolean
}

export async function appendDraftPickTrades(
  leagueId: string,
  newTrades: TradedPickRecord[],
  opts?: {
    /** Only append to this session (a proposal belongs to one draft). */
    sessionId?: string
    /** Return an error message to refuse the trade against the current session state. */
    validate?: (session: DraftPickTradeSessionView) => string | null
  }
): Promise<{ success: boolean; error?: string }> {
  if (await isSeasonTournamentDraft(leagueId)) return { success: false, error: SEASON_DRAFT_MUTATION_BLOCKED }
  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    include: opts?.validate ? { picks: { select: { overall: true } } } : undefined,
  })
  if (!session) return { success: false, error: 'Draft session not found' }
  if (opts?.sessionId && session.id !== opts.sessionId) return { success: false, error: 'This offer belongs to an earlier draft.' }
  const current = (session.tradedPicks as TradedPickRecord[] | null) ?? []
  if (opts?.validate) {
    const picks = ((session as { picks?: { overall: number }[] }).picks ?? [])
    const problem = opts.validate({
      status: session.status,
      slotOrder: (session.slotOrder as DraftPickTradeSessionView['slotOrder'] | null) ?? [],
      tradedPicks: current,
      draftedOveralls: new Set(picks.map((p) => p.overall)),
      teamCount: session.teamCount,
      draftType: session.draftType,
      thirdRoundReversal: session.thirdRoundReversal,
    })
    if (problem) return { success: false, error: problem }
  }
  const combined = [...current, ...newTrades]
  try {
    // Conditional on the version read above: two accepts racing on the same session cannot both
    // rewrite tradedPicks from the same stale copy — the second is refused instead of clobbering the first.
    await updateSessionWithArchive(session, {
      tradedPicks: combined as any, version: { increment: 1 }, updatedAt: new Date(),
    }, 'ownership', { trades: newTrades }, session.version)
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2025') {
      return { success: false, error: 'The draft moved while this trade was being accepted. Please try again.' }
    }
    throw err
  }
  return { success: true }
}

export async function getSessionTradedPicks(leagueId: string): Promise<TradedPickRecord[]> {
  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { tradedPicks: true },
  })
  const raw = session?.tradedPicks
  return Array.isArray(raw) ? (raw as unknown as TradedPickRecord[]) : []
}
