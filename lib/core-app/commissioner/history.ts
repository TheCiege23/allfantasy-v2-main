import 'server-only'

import { prisma } from '@/lib/prisma'
import { readRecentImportedTrades } from '@/lib/league-history/leagueWarehouseReads'

export type CommissionerHistory = {
  tradeAvailable: boolean
  draftAvailable: boolean
  trades: Array<{ id: string; at: string; label: string; status: string; source: string }>
  drafts: Array<{
    id: string; season: number | null; seasonBasis: 'recorded' | 'date_inferred' | 'unknown'
    status: string; source: string
    picks: Array<{ overall: number; round: number; owner: string; player: string; corrections: string[] }>
  }>
  tradeNote: string
  draftNote: string
}

export async function loadCommissionerHistory(leagueId: string, native: boolean): Promise<CommissionerHistory> {
  const [nativeTrades, importedTrades, sessions, redraftDrafts, corrections] = await Promise.all([
    native ? prisma.redraftLeagueTrade.findMany({
      where: { leagueId }, orderBy: { createdAt: 'desc' }, take: 10,
      select: { id: true, createdAt: true, status: true, proposerRoster: { select: { teamName: true, ownerName: true } }, receiverRoster: { select: { teamName: true, ownerName: true } } },
    }).catch(() => null) : Promise.resolve([]),
    native ? Promise.resolve([]) : readRecentImportedTrades(leagueId, 10).catch(() => null),
    prisma.draftSession.findMany({
      where: { leagueId, sessionKind: 'live' }, orderBy: { createdAt: 'desc' }, take: 5,
      select: { id: true, status: true, startedAt: true, completedAt: true, picks: { orderBy: { overall: 'asc' }, take: 300, select: { overall: true, round: true, displayName: true, playerName: true, rosterId: true } } },
    }).catch(() => null),
    native ? prisma.redraftDraft.findMany({
      where: { leagueId }, orderBy: { season: 'desc' }, take: 5,
      include: { picks: { orderBy: { pickNumber: 'asc' }, take: 300, select: { pickNumber: true, round: true, rosterId: true, selectedPlayerName: true, roster: { select: { redraftRoster: { select: { teamName: true, ownerName: true } } } } } } },
    }).catch(() => null) : Promise.resolve([]),
    prisma.draftPickAuditLog.findMany({
      where: { leagueId }, select: { draftSessionId: true, overallPickNumber: true, action: true, oldPlayerName: true, newPlayerName: true, reason: true }, orderBy: { createdAt: 'desc' }, take: 500,
    }).catch(() => null),
  ])

  const correctionsByPick = new Map<string, string[]>()
  for (const row of corrections ?? []) {
    const key = `${row.draftSessionId}:${row.overallPickNumber}`
    const detail = [row.action, row.oldPlayerName && row.newPlayerName ? `${row.oldPlayerName} → ${row.newPlayerName}` : null, row.reason].filter(Boolean).join(' · ')
    correctionsByPick.set(key, [...(correctionsByPick.get(key) ?? []), detail])
  }
  const drafts: CommissionerHistory['drafts'] = [
    ...(redraftDrafts ?? []).map((draft) => ({
      id: draft.id, season: draft.season, seasonBasis: 'recorded' as const, status: draft.status, source: 'AllFantasy redraft',
      picks: draft.picks.map((pick) => ({ overall: pick.pickNumber, round: pick.round, owner: pick.roster?.redraftRoster?.teamName ?? pick.roster?.redraftRoster?.ownerName ?? pick.rosterId ?? 'Unassigned', player: pick.selectedPlayerName ?? 'Not selected', corrections: [] })),
    })),
    ...(sessions ?? []).map((session) => {
      const date = session.startedAt ?? session.completedAt
      return {
        id: session.id, season: date?.getUTCFullYear() ?? null, seasonBasis: date ? 'date_inferred' as const : 'unknown' as const,
        status: session.status, source: 'Live draft session',
        picks: session.picks.map((pick) => ({ overall: pick.overall, round: pick.round, owner: pick.displayName ?? pick.rosterId, player: pick.playerName, corrections: correctionsByPick.get(`${session.id}:${pick.overall}`) ?? [] })),
      }
    }),
  ]
  return {
    tradeAvailable: native ? nativeTrades !== null : importedTrades !== null,
    draftAvailable: sessions !== null && redraftDrafts !== null && corrections !== null,
    trades: native
      ? (nativeTrades ?? []).map((trade) => ({ id: trade.id, at: trade.createdAt.toISOString(), label: `${trade.proposerRoster.teamName ?? trade.proposerRoster.ownerName} ↔ ${trade.receiverRoster.teamName ?? trade.receiverRoster.ownerName}`, status: trade.status, source: 'AllFantasy' }))
      : (importedTrades ?? []).map((trade) => ({ id: trade.id, at: trade.occurredAt.toISOString(), label: `Trade ${trade.providerEventId ?? trade.id}`, status: 'recorded', source: trade.provider })),
    drafts,
    tradeNote: nativeTrades === null || importedTrades === null ? 'Trade history could not be read.' : native ? 'Native trade records on file. This list is limited to the ten newest.' : 'Imported trades recorded in the league warehouse. Provider history may be incomplete.',
    draftNote: sessions === null || redraftDrafts === null || corrections === null ? 'Some draft records or corrections could not be read.' : 'Only connected live draft sessions and native redraft drafts on file are shown. A session year is inferred from its date; missing provider seasons are not reconstructed.',
  }
}
