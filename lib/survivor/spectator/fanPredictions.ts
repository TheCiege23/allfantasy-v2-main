import 'server-only'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/survivorSettings'
import { stripLeadingTribeIcon } from '@/lib/survivor/survivorVisuals'
import { fanChoices, fanLeaderboard, openFanCouncil, type FanChoice, type FanCouncilRow } from './fanPredictionsModel'
import { unreadEliminations } from './watchModel'

/**
 * Fan predictions for the public watch page (see fanPredictionsModel for the rules). A fan is any
 * signed-in user who is not in the league: managers and the commissioner know too much to call it.
 * The leaderboard names fans by their public username.
 */
export type FanPredictionState = {
  available: boolean
  open: { week: number; tribeName: string | null; voteDeadlineAt: string; choices: FanChoice[] } | null
  signedIn: boolean
  /** Why this viewer cannot call it, when they cannot. */
  blocked: 'league_member' | null
  myPick: string | null
  myRecord: { correct: number; calls: number } | null
  leaders: Array<{ name: string; correct: number; calls: number }>
}

export type SubmitFanPredictionResult = { ok: true; myPick: string } | { ok: false; status: 400 | 403 | 404 | 409 | 503; error: string }

const UNAVAILABLE: FanPredictionState = { available: false, open: null, signedIn: false, blocked: null, myPick: null, myRecord: null, leaders: [] }

/** The predictions table ships with its own migration; until it is applied the feature is just off. */
function isMissingTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'P2021' || code === 'P2022'
}

async function loadContext(leagueId: string) {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, survivorRevealMode: true } })
  if (!league) return null
  const settings = league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings) ? (league.settings as Record<string, unknown>) : {}
  if (!normalizeSurvivorFoundationSettings(settings).spectatorPageEnabled) return null
  const [councils, players, tribes] = await Promise.all([
    prisma.survivorTribalCouncil.findMany({
      where: { leagueId },
      // Deliberately no votes relation and no voter columns.
      select: {
        id: true, week: true, councilNumber: true, status: true, closedAt: true, voteDeadlineAt: true, attendingTribeId: true,
        eliminatedUserId: true, eliminatedName: true, isTie: true, tiePhase: true,
        isRevealed: true, revealStartsAt: true, revealStep: true, revealSequence: true,
      },
    }),
    prisma.survivorPlayer.findMany({ where: { leagueId }, select: { id: true, userId: true, displayName: true, tribeId: true, playerState: true } }),
    prisma.survivorTribe.findMany({ where: { leagueId }, select: { id: true, name: true } }),
  ])
  return { revealMode: league.survivorRevealMode, councils: councils as FanCouncilRow[], players, tribes }
}

export async function getFanPredictionState(leagueId: string, viewerUserId: string | null, now = new Date()): Promise<FanPredictionState> {
  const ctx = await loadContext(leagueId)
  if (!ctx) return UNAVAILABLE
  try {
    const predictions = await prisma.survivorFanPrediction.findMany({ where: { leagueId }, select: { councilId: true, fanUserId: true, pickedUserId: true } })
    const council = openFanCouncil(ctx.councils, now)
    const pendingOut = unreadEliminations(ctx.councils, ctx.revealMode, now)
    const choices = council ? fanChoices(council, ctx.players, pendingOut) : []
    const board = fanLeaderboard(predictions, ctx.councils, ctx.revealMode, now)
    const top = board.slice(0, 10)
    const users = top.length ? await prisma.appUser.findMany({ where: { id: { in: top.map(r => r.fanUserId) } }, select: { id: true, username: true } }) : []
    const nameOf = new Map(users.map(u => [u.id, u.username]))
    const mine = viewerUserId ? board.find(r => r.fanUserId === viewerUserId) : undefined
    const myPrediction = viewerUserId && council ? predictions.find(p => p.councilId === council.id && p.fanUserId === viewerUserId) : undefined
    const myPick = myPrediction ? ctx.players.find(p => p.userId === myPrediction.pickedUserId)?.id ?? null : null
    const tribe = council?.attendingTribeId ? ctx.tribes.find(t => t.id === council.attendingTribeId) : null
    return {
      available: true,
      open: council && choices.length >= 2
        ? { week: council.week, tribeName: tribe ? stripLeadingTribeIcon(tribe.name) || tribe.name : null, voteDeadlineAt: council.voteDeadlineAt.toISOString(), choices }
        : null,
      signedIn: Boolean(viewerUserId),
      blocked: viewerUserId && (await resolveLeagueAccess(leagueId, viewerUserId)) ? 'league_member' : null,
      myPick,
      myRecord: mine ? { correct: mine.correct, calls: mine.calls } : null,
      leaders: top.map(r => ({ name: nameOf.get(r.fanUserId) ?? 'A fan', correct: r.correct, calls: r.calls })),
    }
  } catch (error) {
    if (isMissingTable(error)) return UNAVAILABLE
    throw error
  }
}

export async function submitFanPrediction(leagueId: string, fanUserId: string, choiceKey: string, now = new Date()): Promise<SubmitFanPredictionResult> {
  const ctx = await loadContext(leagueId)
  if (!ctx) return { ok: false, status: 404, error: 'This league is not open to fans.' }
  if (await resolveLeagueAccess(leagueId, fanUserId)) return { ok: false, status: 403, error: 'You are in this league, so you cannot call it as a fan.' }
  const council = openFanCouncil(ctx.councils, now)
  if (!council) return { ok: false, status: 409, error: 'Votes are not open right now. Check back on vote night.' }
  const choice = fanChoices(council, ctx.players, unreadEliminations(ctx.councils, ctx.revealMode, now)).find(c => c.key === choiceKey)
  const picked = choice ? ctx.players.find(p => p.id === choice.key) : undefined
  if (!picked) return { ok: false, status: 400, error: 'Pick a castaway who is at this Tribal Council.' }
  try {
    await prisma.survivorFanPrediction.upsert({
      where: { councilId_fanUserId: { councilId: council.id, fanUserId } },
      create: { leagueId, councilId: council.id, week: council.week, fanUserId, pickedUserId: picked.userId },
      update: { pickedUserId: picked.userId },
    })
  } catch (error) {
    if (isMissingTable(error)) return { ok: false, status: 503, error: 'Fan predictions are not available yet.' }
    throw error
  }
  return { ok: true, myPick: picked.id }
}
