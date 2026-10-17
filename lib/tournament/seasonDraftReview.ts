import 'server-only'
import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import { loadSeasonDraftContext, readSeasonDraftSnapshot } from './seasonDraftRuntime'
import { seasonDraftSessionError, validateSeasonCompletedBoard } from './seasonDraftBoard'
import { hasSeasonDraftRelease } from './seasonDraftReleaseGate'

type Database = Pick<typeof prisma, 'league' | 'leagueWaiverState' | 'roster' | 'draftSession' | 'draftPick' | 'tournamentAuditLog'>
export type SeasonDraftReviewState = 'not_started' | 'drafting' | 'paused' | 'checkpoint_pending' | 'completed' | 'review_required'
/** DB-only assessment shared by completion and owner review; never repairs or writes. */
export async function assessSeasonDraftCompletion(leagueId: string, db: Database = prisma) {
  const context = await loadSeasonDraftContext(leagueId, db)
  if (!context) return null
  const session = await db.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER })
  const picks = session ? await db.draftPick.findMany({ where: { sessionId: session.id }, orderBy: { overall: 'asc' } }) : []
  const totalPicks = context.config.rosterSize * context.pool.slots
  const result = (state: SeasonDraftReviewState, blockers: string[], boardHash?: string, completedAt?: string) => ({ state, blockers, boardHash, completedAt, filledPicks: picks.length, totalPicks, canCheckpoint: state === 'checkpoint_pending' && !!boardHash, launchReady: false as const, context, session })
  if (!session) return result('review_required', ['The saved draft session is missing.'])
  const contractError = seasonDraftSessionError(context, session)
  if (contractError) return result('review_required', [contractError])
  const [league, waivers, rosters] = await Promise.all([
    db.league.findUnique({ where: { id: leagueId }, select: { locked: true, lifecycleState: true, settings: true } }),
    db.leagueWaiverState.findUnique({ where: { leagueId }, select: { processingLocked: true } }),
    db.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } }),
  ])
  if (!league?.locked || !waivers?.processingLocked) return result('review_required', ['Tournament season locks need review.'])
  const released = await hasSeasonDraftRelease(leagueId, league.settings, db)
  if (released ? !['pre_draft', 'drafting'].includes(league.lifecycleState) : league.lifecycleState !== 'setup') return result('review_required', ['Tournament draft lifecycle needs review.'])
  if (rosters.length !== context.rosterIds.length || context.pool.members.some(m => !rosters.some(r => r.id === seasonResourceId(context.freezeId, context.pool.key + ':roster:' + m.id) && r.platformUserId === m.userId))) return result('review_required', ['Team ownership differs from the frozen assignment.'])
  if (session.status === 'tournament_setup_blocked') return result(picks.length || released ? 'review_required' : 'not_started', picks.length ? ['A blocked draft contains picks.'] : released ? ['A released draft is still blocked.'] : [])
  if (session.status === 'pre_draft') return result(released && !picks.length ? 'not_started' : 'review_required', released && !picks.length ? [] : ['An unreleased draft changed status or contains picks.'])
  if (!released) return result('review_required', ['A draft started without an audited tournament release.'])
  if (!['in_progress', 'paused', 'completed'].includes(session.status)) return result('review_required', ['Draft status needs tournament review.'])
  if (picks.length < totalPicks && session.status !== 'completed') return result(session.status === 'paused' ? 'paused' : 'drafting', [])
  const catalog = await readSeasonDraftSnapshot(leagueId, context.manifestHash, db)
  if (!catalog) return result('review_required', ['The checked player catalog is unavailable.'])
  const board = validateSeasonCompletedBoard(context, session, picks, catalog.players)
  if (board.error || !board.boardHash) return result('review_required', [board.error ?? 'The completed board needs review.'])
  const prior = await db.tournamentAuditLog.findFirst({ where: { tournamentId: context.tournamentId, targetId: leagueId, action: 'season_draft_board_completed' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  const data = prior?.data as Record<string, unknown> | undefined
  if (session.status === 'completed') return data?.version === 1 && data.sessionId === session.id && data.manifestHash === context.manifestHash && data.boardHash === board.boardHash ? result('completed', [], board.boardHash, prior!.createdAt.toISOString()) : result('review_required', ['The completion checkpoint does not match this board.'])
  if (prior) return result('review_required', ['An earlier completion checkpoint needs review.'])
  return result('checkpoint_pending', ['All picks are saved. The completion checkpoint is pending.'], board.boardHash)
}
