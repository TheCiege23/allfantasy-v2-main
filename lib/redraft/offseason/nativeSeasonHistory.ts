import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

/** Read the archived year, never the generic roster's new-season pointer. */
export async function loadNativeSeasonHistory(leagueId: string, year: number) {
  const [archive, season] = await Promise.all([
    prisma.leagueSeason.findUnique({ where: { leagueId_season: { leagueId, season: year } } }),
    prisma.redraftSeason.findUnique({ where: { leagueId_season: { leagueId, season: year } }, include: {
      rosters: { include: { players: { where: { droppedAt: null } } } },
      schedule: { orderBy: [{ week: 'asc' }, { id: 'asc' }] },
      playoffRounds: { orderBy: { roundNumber: 'asc' }, include: { matchups: { orderBy: { matchupNumber: 'asc' } } } },
      playoffSeeds: true, redraftTransactions: { orderBy: { createdAt: 'desc' } },
    } }),
  ])
  if (!archive || !season) return null
  const session = await prisma.draftSession.findFirst({ where: { leagueId, status: 'completed', createdAt: { lte: archive.createdAt } },
    orderBy: CURRENT_DRAFT_SESSION_ORDER, include: { picks: { orderBy: { overall: 'asc' } } } })
  const standings = Array.isArray(archive.teamRecords) ? archive.teamRecords as Array<Record<string, any>> : []
  const names = new Map(season.rosters.map(r => [r.id, r.teamName ?? r.ownerName]))
  const label = (id: string | null) => id ? names.get(id) ?? id : null
  const weeklyMatchups = season.schedule.filter(m => m.awayRosterId && ['final', 'completed'].includes(m.status)).map(m => ({
    matchupId: m.id, weekOrPeriod: m.week, teamA: label(m.homeRosterId)!, teamB: label(m.awayRosterId)!,
    scoreA: m.homeScore ?? 0, scoreB: m.awayScore ?? 0,
    winnerTeamId: m.homeScore === m.awayScore ? null : label((m.homeScore ?? 0) > (m.awayScore ?? 0) ? m.homeRosterId : m.awayRosterId),
  }))
  const weeks = [...new Set(weeklyMatchups.map(m => m.weekOrPeriod))].map(week => {
    const matches = weeklyMatchups.filter(m => m.weekOrPeriod === week)
    const best = [...matches].sort((a,b) => b.scoreA + b.scoreB - a.scoreA - a.scoreB)[0]
    return { week, matchupCount: matches.length, highestCombinedScore: best.scoreA + best.scoreB, highestCombinedLabel: `${best.teamA} vs ${best.teamB}` }
  })
  const peak = [...weeks].sort((a,b) => b.highestCombinedScore - a.highestCombinedScore)[0]
  const draft = (session?.picks ?? []).map(p => ({ draftId: session!.id, season: year, round: p.round,
    pickNumber: p.overall, playerId: p.playerId ?? p.playerName, playerName: p.playerName, managerId: p.rosterId }))
  const transactions = season.redraftTransactions.map(t => {
    const meta = t.metadata && typeof t.metadata === 'object' && !Array.isArray(t.metadata) ? t.metadata : {}
    return { transactionId: t.id, type: t.type, playerId: typeof meta.playerId === 'string' ? meta.playerId : null,
      managerId: null, rosterId: t.rosterId, payload: t.metadata, weekOrPeriod: typeof meta.week === 'number' ? meta.week : null, createdAt: t.createdAt }
  })
  const transactionSummary = [...new Set(transactions.map(t => t.type))].map(type => ({ type, count: transactions.filter(t => t.type === type).length }))
  const lineupSnapshots = standings.map(r => {
    const players = Array.isArray(r.players) ? r.players : []
    const map = (p: any) => ({ id: p.playerId, name: p.playerName, position: p.position, team: p.team, bucket: p.slotType })
    const bench = (p: any) => ['BENCH', 'BN', 'IR', 'TAXI'].includes(String(p.slotType ?? '').toUpperCase())
    return { teamId: r.rosterId, managerName: r.managerName, weekOrPeriod: 0, rosterCount: players.length,
      lineupCount: players.filter((p: any) => !bench(p)).length, benchCount: players.filter(bench).length,
      lineupPlayers: players.filter((p: any) => !bench(p)).map(map), benchPlayers: players.filter(bench).map(map) }
  })
  const bracketEntries = season.playoffRounds.flatMap(round => round.matchups.map(m => ({ id: m.id,
    round: round.roundNumber, matchup: m.matchupNumber, teamOneId: m.homeRosterId, teamTwoId: m.awayRosterId,
    winnerId: m.winnerRosterId, loserId: m.winnerRosterId ? (m.winnerRosterId === m.homeRosterId ? m.awayRosterId : m.homeRosterId) : null,
    teamOneLabel: label(m.homeRosterId), teamTwoLabel: label(m.awayRosterId), winnerLabel: label(m.winnerRosterId),
    loserLabel: m.winnerRosterId ? label(m.winnerRosterId === m.homeRosterId ? m.awayRosterId : m.homeRosterId) : null })))
  return { season: year, standings, weeklyMatchups, weeklySummary: { weeks,
    highestScoringWeek: peak ? { week: peak.week, combined: peak.highestCombinedScore, label: peak.highestCombinedLabel } : null },
    draft, draftSummary: { totalPicks: draft.length, roundCount: new Set(draft.map(p => p.round)).size,
      managerCount: new Set(draft.map(p => p.managerId)).size, firstOverall: draft[0] ?? null },
    transactions, transactionSummary, lineupSnapshots,
    playoffBracket: { playoffWeekStart: season.playoffStartWeek, regularSeasonLength: season.playoffStartWeek - 1,
      playoffTeams: season.playoffSeeds.length, participants: season.playoffSeeds.map(s => ({ rosterId: s.rosterId,
        managerName: label(s.rosterId), seed: s.seed, label: null,
        isChampion: standings.find(r => r.rosterId === s.rosterId)?.isChampion === true,
        isRunnerUp: standings.find(r => r.rosterId === s.rosterId)?.isRunnerUp === true,
        playoffWins: season.playoffRounds.flatMap(r => r.matchups).filter(m => m.winnerRosterId === s.rosterId && m.homeRosterId && m.awayRosterId).length,
        playoffLosses: season.playoffRounds.flatMap(r => r.matchups).filter(m => m.winnerRosterId && m.winnerRosterId !== s.rosterId && (m.homeRosterId === s.rosterId || m.awayRosterId === s.rosterId)).length })),
      winnersBracket: bracketEntries, losersBracket: [] },
    importedHistory: { provider: null, platformLeagueId: null, matchupHistory: null },
    scoringSettings: { scoringFormat: archive.scoringFormat, isDynasty: archive.isDynasty, teamCount: archive.teamCount },
    summary: { matchupCount: weeklyMatchups.length, weekCount: weeks.length, draftPickCount: draft.length,
      transactionCount: transactions.length, rosterSnapshotCount: lineupSnapshots.length, playoffMatchupCount: bracketEntries.length },
    meta: { championName: archive.championName, championAvatar: archive.championAvatar, runnerUpName: archive.runnerUpName,
      regularSeasonWinnerName: archive.regularSeasonWinnerName, status: archive.status } }
}
