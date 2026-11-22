import 'server-only'

import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { getAuctionConfigFromSession, getAuctionStateFromSession, getBudgetsFromSession } from '@/lib/live-draft-engine/auction/AuctionEngine'
import { computeDraftPlayerRankings } from '@/lib/draft-helper/RecommendationEngine'
import { buildAuctionAdvice, type AuctionAdvice, type AuctionTeamBudget } from '@/lib/draft-helper/auctionAdvice'
import { buildDraftDecisionContext, resolveTargetRosterAliases } from './DraftContextAssembler'

/**
 * Auction advice for one manager in one league's live auction (2026-11-14). The draft decision
 * route used to answer every auction with 409 `auction_unsupported`; it now returns this.
 *
 * Reads: the same Draft OS context every snake decision uses (pool, ADP, byes, scoring window,
 * roster template), plus the auction session's budgets, current nomination and pick counts.
 * Budgets come from `getBudgetsFromSession` — the bid engine's own reader — and open slots are
 * `rounds − picks`, the bid engine's own rule. A draft mirrored from Sleeper carries no budgets or
 * bid amounts, so every team is assumed to hold the default budget and the advice says so.
 */
export async function buildAuctionDecision(args: { leagueId: string; rosterId: string }): Promise<{
  advice: AuctionAdvice
  scoringWindowInsight: string | null
}> {
  const context = await buildDraftDecisionContext({ leagueId: args.leagueId, rosterId: args.rosterId })
  const session = await prisma.draftSession.findFirst({
    where: { leagueId: args.leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: {
      id: true,
      rounds: true,
      auctionBudgetPerTeam: true,
      auctionBudgets: true,
      auctionState: true,
      slotOrder: true,
      timerSeconds: true,
      sleeperDraftId: true,
    },
  })
  if (!session) throw new Error('No draft session')

  const picks = await prisma.draftPick.findMany({ where: { sessionId: session.id }, select: { rosterId: true } })
  const roster = await prisma.roster.findUnique({ where: { id: args.rosterId }, select: { platformUserId: true } })
  const aliases = await resolveTargetRosterAliases({
    platformUserId: roster?.platformUserId ?? null,
    isSleeperMirror: Boolean(session.sleeperDraftId),
  })
  const ownIds = new Set([args.rosterId, ...aliases])

  const config = getAuctionConfigFromSession(session)
  const rawBudgets = session.auctionBudgets
  const budgetsAssumed = !rawBudgets || typeof rawBudgets !== 'object' || Array.isArray(rawBudgets)
  const budgets = getBudgetsFromSession(session)
  const rounds = Math.max(1, session.rounds ?? 15)

  const pickCount = new Map<string, number>()
  for (const p of picks) pickCount.set(p.rosterId, (pickCount.get(p.rosterId) ?? 0) + 1)

  const slotOrder = (Array.isArray(session.slotOrder) ? session.slotOrder : []) as Array<{ rosterId?: string }>
  const teamIds = slotOrder.map((e) => String(e.rosterId ?? '')).filter(Boolean)
  const ids = teamIds.length ? teamIds : [...new Set([...Object.keys(budgets), ...pickCount.keys()])]
  const teams: AuctionTeamBudget[] = ids.map((id) => ({
    budget: Number(budgets[id] ?? config.budgetPerTeam),
    openSlots: Math.max(0, rounds - (pickCount.get(id) ?? 0)),
  }))
  const myId = ids.find((id) => ownIds.has(id))
  const myPicks = picks.filter((p) => ownIds.has(p.rosterId)).length
  const me: AuctionTeamBudget = {
    budget: Number((myId ? budgets[myId] : undefined) ?? config.budgetPerTeam),
    openSlots: Math.max(0, rounds - myPicks),
  }

  const state = getAuctionStateFromSession(session)
  const ranked = computeDraftPlayerRankings(context.engineInput)?.scored ?? []
  const advice = buildAuctionAdvice({
    ranked,
    room: { teams: teams.length ? teams : [me], minBid: config.minBid },
    me,
    nomination: state?.currentNomination
      ? { playerName: state.currentNomination.playerName, currentBid: state.currentBid > 0 ? state.currentBid : null }
      : null,
    budgetsAssumed,
  })
  if (session.sleeperDraftId) advice.caveats.unshift('This auction is mirrored from Sleeper, which does not share bid amounts; spending so far is not reflected.')

  const window = context.scoringWindow
  const scoringWindowInsight = window
    ? `Scoring window: ${window.label ? `${window.label} ` : ''}weeks ${window.startWeek}${window.endWeek ? `–${window.endWeek}` : '+'} — byes inside it lower your price.`
    : null
  return { advice, scoringWindowInsight }
}
