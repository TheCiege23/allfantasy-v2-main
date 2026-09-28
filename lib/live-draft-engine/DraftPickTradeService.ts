/**
 * Draft pick trade: append traded picks to session and handle proposal accept.
 */

import { prisma } from '@/lib/prisma'
import { buildSessionSnapshot } from './DraftSessionService'
import type { TradedPickRecord } from './types'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export async function appendDraftPickTrades(
  leagueId: string,
  newTrades: TradedPickRecord[]
): Promise<{ success: boolean; error?: string }> {
  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { id: true, tradedPicks: true },
  })
  if (!session) return { success: false, error: 'Draft session not found' }
  const current = (session.tradedPicks as TradedPickRecord[] | null) ?? []
  const combined = [...current, ...newTrades]
  await prisma.draftSession.update({
    where: { id: session.id },
    data: { tradedPicks: combined as any, version: { increment: 1 }, updatedAt: new Date() },
  })
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
