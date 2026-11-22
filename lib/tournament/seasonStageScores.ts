import 'server-only'
import type { Prisma } from '@prisma/client'
import { seasonScoringId } from './seasonDraftHandoff'
import type { SeasonStageManifest } from './seasonNativeContract'
import type { TournamentWeeklyResult } from './seasonTournamentStandings'
import { readSeasonLiveScores, seasonLiveScoreTarget } from './seasonScoreLedger'

export type SeasonStageScore = TournamentWeeklyResult & { against: number; matchupId: string; played: boolean }

export async function readSeasonStageScores(tx: Prisma.TransactionClient, field: SeasonStageManifest, leagueIds: string[], periods: number[]) {
  const bindings = await tx.tournamentLeagueParticipant.findMany({
    where: { league: { leagueId: { in: leagueIds } } }, include: { league: { select: { leagueId: true } } },
  })
  const expectedEntries = new Set(field.leagues.flatMap(pool => pool.members.map(member => member.id)))
  if (bindings.length !== expectedEntries.size || bindings.some(binding => !binding.redraftRosterId || !expectedEntries.delete(binding.participantId))) return null
  const byRoster = new Map(bindings.map(binding => [binding.redraftRosterId!, binding]))
  if (byRoster.size !== bindings.length) return null
  const matches = await tx.redraftMatchup.findMany({
    where: { seasonId: { in: leagueIds.map(seasonScoringId) }, week: { in: periods }, isMedianMatchup: false },
    orderBy: { id: 'asc' },
  })
  const officialScores = await readSeasonLiveScores(tx, leagueIds, periods, field.manifestHash, field.stage ?? 1)
  const seen = new Set<string>(), results: SeasonStageScore[] = []
  for (const match of matches) {
    if (!['active', 'final'].includes(match.status)) continue
    const snapshot = (match.lineupSnapshots as { seasonTournament?: { manifestHash?: string; week?: number; final?: boolean; missingPlayerIds?: string[]; revision?: number; officialScoreId?: string } } | null)?.seasonTournament
    const final = match.status === 'final'
    if (snapshot?.manifestHash !== field.manifestHash || snapshot.week !== match.week || snapshot.final !== final) return null
    const official = officialScores.get(seasonLiveScoreTarget(match.leagueId, match.week))
    if (final && (!official || official.id !== snapshot.officialScoreId || official.revision !== snapshot.revision)) return null
    // A partial provider payload cannot establish a manager's score, even when it has some contributions.
    if (!final && snapshot.missingPlayerIds?.length) continue
    for (const [rosterId, points, against] of [
      [match.homeRosterId, match.homeScore, match.awayScore], [match.awayRosterId, match.awayScore, match.homeScore],
    ] as const) {
      if (!rosterId) continue
      const binding = byRoster.get(rosterId), key = match.week + ':' + rosterId
      if (!binding || binding.league.leagueId !== match.leagueId || seen.has(key) || !Number.isFinite(points) || !Number.isFinite(against)) return null
      if (final && official?.scores.find(score => score.rosterId === rosterId)?.points !== points) return null
      seen.add(key)
      results.push({
        stageId: String(field.stage ?? 1), entrantId: binding.participantId, leagueId: match.leagueId,
        period: match.week, revision: snapshot.revision ?? 1, status: final ? 'final' : 'provisional', points,
        wins: !match.awayRosterId ? 0 : points === against ? 0.5 : points > against ? 1 : 0,
        played: match.awayRosterId !== null, against, matchupId: match.id,
      })
    }
  }
  return results
}

export async function readFinalSeasonStageScores(tx: Prisma.TransactionClient, field: SeasonStageManifest, leagueIds: string[], periods: number[]) {
  const results = await readSeasonStageScores(tx, field, leagueIds, periods)
  const expected = field.leagues.reduce((count, pool) => count + pool.members.length, 0) * periods.length
  return results?.length === expected && results.every(row => row.status === 'final') ? results : null
}
