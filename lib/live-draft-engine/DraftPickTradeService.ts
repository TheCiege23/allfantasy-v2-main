import { isSeasonTournamentDraft, SEASON_DRAFT_MUTATION_BLOCKED } from '@/lib/tournament/seasonDraftMutationGate'
/**
 * Draft pick trade: append traded picks to session and handle proposal accept.
 */

import { prisma } from '@/lib/prisma'
import { buildSessionSnapshot } from './DraftSessionService'
import type { TradedPickRecord } from './types'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { updateSessionWithArchive } from '@/lib/draft-archive/events'

export async function appendDraftPickTrades(
  leagueId: string,
  newTrades: TradedPickRecord[]
): Promise<{ success: boolean; error?: string }> {
  if (await isSeasonTournamentDraft(leagueId)) return { success: false, error: SEASON_DRAFT_MUTATION_BLOCKED }
  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
  })
  if (!session) return { success: false, error: 'Draft session not found' }
  const current = (session.tradedPicks as TradedPickRecord[] | null) ?? []
  const combined = [...current, ...newTrades]
  await updateSessionWithArchive(session, {
    tradedPicks: combined as any, version: { increment: 1 }, updatedAt: new Date(),
  }, 'ownership', { trades: newTrades })
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
