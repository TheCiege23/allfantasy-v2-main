import 'server-only'
import { prisma } from '@/lib/prisma'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import { calculateSeasonQualifierCut, loadSeasonStage } from './seasonRounds'
import { readSeasonStageScores } from './seasonStageScores'
import { seasonRecoveryHeld } from './seasonRecoveryState'

type Audience = { staff: boolean; entrantId: string | null }
type CutTiebreaker = 'best_week' | 'wins' | 'previous_seed' | 'frozen_draw'
type Standing = 'Projected in' | 'Projected out' | 'Clinched' | 'Below cut'

export async function loadSeasonLiveCut(tournamentId: string, audience: Audience, now = new Date()) {
  return prisma.$transaction(async tx => {
    const round = await tx.tournamentRound.findFirst({
      where: { tournamentId, status: 'active', roundNumber: { in: [1, 2] } },
      select: { roundNumber: true, weekStart: true, weekEnd: true },
    })
    if (!round) return null
    const stage = round.roundNumber
    const field = await loadSeasonStage(tournamentId, stage, tx)
    if (!field) return null
    const { manifest } = field
    const leagues = manifest.leagues.map(pool => ({ ...pool, id: seasonResourceId(field.id, pool.key) }))
    const ownLeague = leagues.find(pool => pool.members.some(member => member.id === audience.entrantId))
    if (!audience.staff && !ownLeague) return null
    const started = manifest.config.rules!.calendar.periods.filter(period =>
      period.number >= round.weekStart && period.number <= round.weekEnd && Date.parse(period.startsAt) <= now.getTime())
    const eligible = started.map(period => period.number)
    if (!eligible.length) return null
    const ledger = await readSeasonStageScores(tx, manifest, leagues.map(pool => pool.id), eligible)
    if (!ledger) return null
    const entrantCount = leagues.reduce((sum, pool) => sum + pool.members.length, 0)
    const firstIncomplete = eligible.findIndex(period => ledger.filter(row => row.period === period).length !== entrantCount)
    const periods = firstIncomplete === -1 ? eligible : eligible.slice(0, firstIncomplete)
    if (!periods.length) return null
    const { board, cut, qualification } = calculateSeasonQualifierCut(field, periods, ledger.filter(row => periods.includes(row.period)), undefined, true)
    if (!cut.ok) return { stage, through: periods.at(-1)!, current: eligible.at(-1)!, pending: cut.reason, rows: [] }

    const automatic = new Set(cut.advancing.filter(row => 'path' in row && row.path === 'automatic').map(row => row.entrantId))
    const advancing = new Map(cut.advancing.map(row => [row.entrantId, 'path' in row ? row.path : undefined]))
    const atLine = qualification
      ? board.rows.filter(row => !automatic.has(row.id))[qualification.wildcards - 1]
      : board.rows[cut.advancing.length - 1]
    const clinched = periods.at(-1) === round.weekEnd && board.scoresFinal && !await seasonRecoveryHeld(tx, tournamentId)
    const rows = board.rows.filter(row => audience.staff || row.leagueId === ownLeague!.id).map(row => {
      const leagueLine = qualification ? board.rows.filter(other => other.leagueId === row.leagueId)[qualification.automaticPerLeague - 1] : undefined
      const inCut = advancing.has(row.id)
      const path = advancing.get(row.id) ?? (qualification ? atLine ? 'wildcard' : 'automatic' : 'overall')
      const threshold = path === 'automatic' ? leagueLine : atLine ?? leagueLine
      const pointsGap = threshold?.total != null && row.total != null ? (row.total - threshold.total) / 10_000 : null
      const standing: Standing = clinched ? inCut ? 'Clinched' : 'Below cut' : inCut ? 'Projected in' : 'Projected out'
      const tie: CutTiebreaker | null = threshold && threshold.id !== row.id && pointsGap === 0 ? manifest.config.tiebreakers.find(rule =>
        rule === 'best_week' ? row.bestWeek !== threshold.bestWeek
          : rule === 'previous_seed' ? row.previousSeed !== threshold.previousSeed
          : qualification ? row.wins * Math.max(1, threshold.gamesPlayed) !== threshold.wins * Math.max(1, row.gamesPlayed) : row.wins !== threshold.wins)
        ?? (manifest.config.competition?.finalTiebreaker === 'frozen_draw' ? 'frozen_draw' : null) : null
      return { manager: row.displayName, rank: row.rank, points: row.pointsFor, pointsGap, standing, path, tie }
    })
    return { stage, through: periods.at(-1)!, current: eligible.at(-1)!, pending: null, rows }
  }, { isolationLevel: 'RepeatableRead' })
}

export type SeasonLiveCut = NonNullable<Awaited<ReturnType<typeof loadSeasonLiveCut>>>
