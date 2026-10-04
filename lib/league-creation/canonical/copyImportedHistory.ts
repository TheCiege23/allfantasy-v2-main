import { Prisma } from '@prisma/client'
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** Archive provider facts without turning them into live native matchups or transactions. */
export async function copyImportedHistory(tx: Prisma.TransactionClient, sourceLeagueId: string, targetLeagueId: string, teamIds: Map<string, string>) {
  const [seasons, matchups, drafts, transactions, standings, dynastySeasons, rosterSnapshots, results] = await Promise.all([
    tx.leagueSeason.findMany({ where: { leagueId: sourceLeagueId } }),
    tx.matchupFact.findMany({ where: { leagueId: sourceLeagueId } }),
    tx.draftFact.findMany({ where: { leagueId: sourceLeagueId } }),
    tx.transactionFact.findMany({ where: { leagueId: sourceLeagueId } }),
    tx.seasonStandingFact.findMany({ where: { leagueId: sourceLeagueId } }),
    tx.leagueDynastySeason.findMany({ where: { leagueId: sourceLeagueId } }),
    tx.rosterSnapshot.findMany({ where: { leagueId: sourceLeagueId } }),
    tx.seasonResult.findMany({ where: { leagueId: sourceLeagueId } }),
  ])
  const team = (id: string) => teamIds.get(id) ?? id
  if (seasons.length) await tx.leagueSeason.createMany({ data: seasons.map(({ id: _id, leagueId: _leagueId, championTeamId, teamRecords, ...row }) => ({
    ...row, leagueId: targetLeagueId,
    championTeamId: championTeamId ? teamIds.get(championTeamId) ?? null : null,
    teamRecords: teamRecords == null ? Prisma.JsonNull : teamRecords as Prisma.InputJsonValue,
  })) })
  if (matchups.length) await tx.matchupFact.createMany({ data: matchups.map(({ matchupId: _id, ...row }) => ({
    ...row, leagueId: targetLeagueId, teamA: team(row.teamA), teamB: team(row.teamB), winnerTeamId: row.winnerTeamId ? team(row.winnerTeamId) : null,
  })) })
  // Historical player IDs keep their provider namespace; they are never live roster IDs.
  if (drafts.length) await tx.draftFact.createMany({ data: drafts.map(({ draftId: _id, metadata, ...row }) => ({
    ...row, leagueId: targetLeagueId, metadata: { ...record(metadata), sourceLeagueId, sourcePlayerId: row.playerId, importedHistory: true } as Prisma.InputJsonValue,
  })) })
  if (transactions.length) await tx.transactionFact.createMany({ data: transactions.map(({ transactionId: _id, payload, ...row }) => ({
    ...row, leagueId: targetLeagueId, payload: { ...record(payload), sourceLeagueId, importedHistory: true } as Prisma.InputJsonValue,
  })) })
  if (standings.length) await tx.seasonStandingFact.createMany({ data: standings.map(({ standingId: _id, ...row }) => ({ ...row, leagueId: targetLeagueId, teamId: team(row.teamId) })) })
  if (dynastySeasons.length) await tx.leagueDynastySeason.createMany({ data: dynastySeasons.map(({ id: _id, metadata, ...row }) => ({ ...row, leagueId: targetLeagueId, metadata: { ...record(metadata), sourceLeagueId, importedHistory: true } as Prisma.InputJsonValue })) })
  const missingSeasons = dynastySeasons.filter(row => !seasons.some(season => season.season === row.season))
  if (missingSeasons.length) await tx.leagueSeason.createMany({ data: missingSeasons.map(row => ({
    leagueId: targetLeagueId, season: row.season, platformLeagueId: row.platformLeagueId,
    status: record(record(row.metadata).league).isFinished === true || record(row.metadata).isFinished === true ? 'complete' : 'imported',
    teamCount: typeof record(row.metadata).size === 'number' ? Number(record(row.metadata).size) : null,
  })) })
  if (results.length) await tx.seasonResult.createMany({ data: results.map(({ id: _id, ...row }) => ({ ...row, leagueId: targetLeagueId })) })
  if (rosterSnapshots.length) await tx.rosterSnapshot.createMany({ data: rosterSnapshots.map(({ snapshotId: _id, rosterPlayers, lineupPlayers, benchPlayers, ...row }) => ({ ...row, leagueId: targetLeagueId, teamId: team(row.teamId), rosterPlayers: rosterPlayers as Prisma.InputJsonValue, lineupPlayers: lineupPlayers as Prisma.InputJsonValue, benchPlayers: benchPlayers as Prisma.InputJsonValue })) })
  return { seasons: seasons.length + missingSeasons.length, matchups: matchups.length, drafts: drafts.length, transactions: transactions.length, standings: standings.length, dynastySeasons: dynastySeasons.length, rosterSnapshots: rosterSnapshots.length, results: results.length }
}
