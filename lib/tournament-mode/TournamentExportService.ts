/**
 * PROMPT 3: Weekly export/report — CSV for tournament hub and league chat.
 * Columns: User Name, W-L, PF, Conference, Conference Points Total, advancement status,
 * elimination round reached, current league, current stage. Dynamic per tournament; no hardcoded names.
 */

import { prisma } from '@/lib/prisma'

interface TournamentExportRow {
  userName: string
  wins: number
  losses: number
  pointsFor: number
  conference: string
  conferencePointsTotal: number
  advancementStatus: string
  eliminationRoundReached: string
  currentLeague: string
  currentStage: string
}

/** Build export rows from TournamentParticipant (all users ever in tournament). */
export async function buildTournamentExportRows(tournamentId: string): Promise<TournamentExportRow[]> {
  const participants = await prisma.legacyTournamentParticipant.findMany({
    where: { tournamentId },
    include: { conference: { select: { name: true } } },
  })

  const userIds = [...new Set(participants.map((p) => p.userId))]
  const profiles = await prisma.userProfile.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, displayName: true },
  })
  const nameByUser = new Map(profiles.map((p) => [p.userId, p.displayName ?? p.userId]))

  const leagueIds = [...new Set(participants.map((p) => p.currentLeagueId).filter(Boolean))] as string[]
  const leagueNames = new Map<string, string>()
  if (leagueIds.length > 0) {
    const leagues = await prisma.league.findMany({
      where: { id: { in: leagueIds } },
      select: { id: true, name: true },
    })
    leagues.forEach((l) => leagueNames.set(l.id, l.name ?? l.id))
  }

  const conferencePf = new Map<string, number>()
  for (const p of participants) {
    const cur = conferencePf.get(p.conferenceId) ?? 0
    conferencePf.set(p.conferenceId, cur + p.qualificationPointsFor)
  }

  const rows: TournamentExportRow[] = participants.map((p) => {
    const advancementStatus = p.status === 'eliminated' ? 'Eliminated' : 'Active'
    const eliminationRoundReached =
      p.status === 'eliminated' && p.eliminatedAtRoundIndex != null
        ? `Round ${p.eliminatedAtRoundIndex}`
        : p.status === 'active'
          ? 'Active'
          : '—'
    const currentLeague = p.currentLeagueId ? leagueNames.get(p.currentLeagueId) ?? p.currentLeagueId : '—'
    const currentStage = p.status === 'active' ? (p.bracketLabel ?? `Round ${p.advancedAtRoundIndex}`) : 'Eliminated'

    return {
      userName: nameByUser.get(p.userId) ?? p.userId,
      wins: p.qualificationWins,
      losses: p.qualificationLosses,
      pointsFor: p.qualificationPointsFor,
      conference: p.conference.name,
      conferencePointsTotal: conferencePf.get(p.conferenceId) ?? 0,
      advancementStatus,
      eliminationRoundReached,
      currentLeague,
      currentStage,
    }
  })

  rows.sort((a, b) => b.pointsFor - a.pointsFor)
  return rows
}

/** Serialize export rows to CSV string. */
export function serializeExportToCSV(rows: TournamentExportRow[]): string {
  const header = [
    'User Name',
    'W-L Record',
    'Points For',
    'Conference',
    'Conference Points Total',
    'Advancement Status',
    'Elimination Round Reached',
    'Current League',
    'Current Stage',
  ]
  const lines = [header.join(',')]
  for (const r of rows) {
    const wl = `${r.wins}-${r.losses}`
    lines.push(
      [
        escapeCsv(r.userName),
        wl,
        r.pointsFor.toFixed(1),
        escapeCsv(r.conference),
        r.conferencePointsTotal.toFixed(1),
        escapeCsv(r.advancementStatus),
        escapeCsv(r.eliminationRoundReached),
        escapeCsv(r.currentLeague),
        escapeCsv(r.currentStage),
      ].join(',')
    )
  }
  return lines.join('\n')
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
