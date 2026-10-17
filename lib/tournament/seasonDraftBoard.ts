import type { SeasonBlueprint } from './seasonBlueprint'
import type { SeasonDraftPlayer } from './seasonDraftPolicy'
import { matchSeasonDraftSlots } from './seasonDraftPolicy'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import { seasonContractHash } from './seasonCalendarVerification'
import type { loadSeasonDraftContext } from './seasonDraftRuntime'

type Context = NonNullable<Awaited<ReturnType<typeof loadSeasonDraftContext>>>
type BoardPick = { overall: number; round: number; slot: number; rosterId: string; playerId?: string | null; playerName: string; position: string; team?: string | null; amount?: number | null; assetType?: string | null; pickMetadata?: unknown }
type BoardSession = { id: string; leagueId: string; rounds: number; teamCount: number; draftType: string; sportType?: string | null; thirdRoundReversal?: boolean; timerSeconds?: number | null; aiAutoPick?: boolean; inDraftPlayerTradesEnabled?: boolean; playerPool?: string | null; slotOrder: unknown; tradedPicks?: unknown; keeperSelections?: unknown; keeperConfig?: unknown; devyConfig?: unknown; c2cConfig?: unknown; auctionState?: unknown; auctionBudgets?: unknown; auctionBudgetPerTeam?: number | null }

/** Shared frozen session check for picks and completion. Does not infer repaired assignments. */
export function seasonDraftSessionError(context: Context, session: BoardSession): string | null {
  const c = context.config
  if (session.id !== seasonResourceId(context.freezeId, context.pool.key + ':draft') || session.leagueId !== seasonResourceId(context.freezeId, context.pool.key) || session.rounds !== c.rosterSize || session.teamCount !== context.pool.slots || session.draftType !== c.draftType || session.sportType !== c.sport || session.thirdRoundReversal || session.timerSeconds !== c.rules!.draftPolicy!.pickClockSeconds || session.aiAutoPick || session.inDraftPlayerTradesEnabled || (session.playerPool != null && session.playerPool !== 'all')) return 'The draft session differs from its frozen contract.'
  const order = session.slotOrder as Array<{ slot: number; rosterId: string }> | null
  const expected = context.pool.members.map(m => ({ slot: m.draftSlot, rosterId: seasonResourceId(context.freezeId, context.pool.key + ':roster:' + m.id) }))
  if (!Array.isArray(order) || order.length !== expected.length || expected.some((e, i) => order[i]?.slot !== e.slot || order[i]?.rosterId !== e.rosterId)) return 'The draft order differs from the frozen assignment.'
  if ([session.tradedPicks, session.keeperSelections].some(v => v != null && (!Array.isArray(v) || v.length !== 0)) || [session.keeperConfig, session.devyConfig, session.c2cConfig].some(v => v != null)) return 'Unsupported draft overrides require tournament review.'
  return null
}

export function validateSeasonCompletedBoard(context: Context, session: BoardSession, picks: BoardPick[], catalog: SeasonDraftPlayer[]) {
  const error = seasonDraftSessionError(context, session)
  if (error) return { error }
  const c: SeasonBlueprint = context.config, total = c.rosterSize * context.pool.slots
  if (picks.length !== total) return { error: 'The tournament draft board is incomplete.' }
  const players = new Map(catalog.map(p => [p.playerId, p]))
  if (players.size !== catalog.length) return { error: 'The checked player catalog contains duplicate identities.' }
  const sorted = [...picks].sort((a, b) => a.overall - b.overall), taken = new Set<string>(), names = new Set<string>()
  const order = session.slotOrder as Array<{ slot: number; rosterId: string }>
  for (let i = 0; i < total; i++) {
    const p = sorted[i]!, round = Math.ceil((i + 1) / session.teamCount), linear = i % session.teamCount + 1
    const slot = c.draftType === 'snake' && round % 2 === 0 ? session.teamCount + 1 - linear : linear
    const identity = p.playerId ? players.get(p.playerId) : null, name = p.playerName?.trim().toLowerCase()
    if (p.overall !== i + 1 || p.round !== round || p.slot !== slot || !context.rosterIds.includes(p.rosterId) || (c.draftType === 'snake' && order.find(e => e.slot === slot)?.rosterId !== p.rosterId)) return { error: 'The board has a missing, duplicate or incorrectly owned pick.' }
    if (!identity || taken.has(identity.playerId) || names.has(name) || identity.playerName.trim().toLowerCase() !== name || identity.position !== p.position || (identity.team ?? '') !== (p.team ?? '') || (p.assetType != null && p.assetType !== 'player') || (p.pickMetadata as any)?.pickEditorEmpty) return { error: 'The board contains an invalid or duplicate player identity.' }
    taken.add(identity.playerId); names.add(name)
  }
  for (const rosterId of context.rosterIds) {
    const roster = sorted.filter(p => p.rosterId === rosterId)
    if (roster.length !== c.rosterSize || matchSeasonDraftSlots(c, roster) !== c.rosterSize) return { error: 'Every team must have a complete legal starter and bench roster.' }
    if (c.draftType === 'auction') {
      const budget = c.rules!.draftPolicy!.auctionBudget!
      const remaining = (session.auctionBudgets as Record<string, number> | null)?.[rosterId]
      if (session.auctionBudgetPerTeam !== budget || roster.some(p => !Number.isSafeInteger(p.amount) || p.amount! < 1) || remaining !== budget - roster.reduce((sum, p) => sum + p.amount!, 0) || remaining! < 0) return { error: 'Auction payments and remaining budgets do not reconcile.' }
    }
  }
  if (c.draftType === 'auction') {
    const state = session.auctionState as any, budgets = session.auctionBudgets as Record<string, number> | null
    if (!state || state.currentNomination != null || state.currentBid !== 0 || state.currentBidderRosterId != null || state.bidTimerEndAt != null) return { error: 'Resolve the outstanding auction nomination first.' }
    if (!budgets || Object.keys(budgets).length !== context.rosterIds.length || Object.keys(budgets).some(id => !context.rosterIds.includes(id))) return { error: 'Auction budgets differ from the frozen teams.' }
  }
  return { boardHash: seasonContractHash(sorted.map(p => ({ overall: p.overall, round: p.round, slot: p.slot, rosterId: p.rosterId, playerId: p.playerId, playerName: p.playerName, position: p.position, team: p.team ?? null, amount: p.amount ?? null }))), totalPicks: total }
}
