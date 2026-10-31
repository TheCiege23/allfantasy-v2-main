import 'server-only'

import { prisma } from '@/lib/prisma'
import { isChimmyRunning, readManagedLineups } from '@/lib/inactive-manager/inactiveManagerMode'
import { createSurvivorChatMessage, upsertSurvivorChatMessage } from './survivorChatBridge'

/**
 * Chimmy speaks for the castaways it runs, in character, so its teams feel like real players rather
 * than empty seats. Every line is spoiler-safe by construction: it never names a vote target, never
 * mentions an idol (who holds one is secret), and only says what the castaway itself just did.
 *
 * Lines go out as host messages carrying the castaway's name. A seat has no account, and league chat
 * needs one for every author, so a line sent as the seat would never reach the league chat mirror.
 */

const VOTE_LINES = [
  'My vote is in. No hard feelings, whoever it is.',
  'Vote cast. I go with the numbers.',
  "I've written a name down. See you at the reading.",
  'Ballot submitted. Nothing personal, just strategy.',
] as const

/** A stable pick per week, so a retried tick never posts a different line. */
export function chimmyVoteLine(week: number): string {
  return VOTE_LINES[((week % VOTE_LINES.length) + VOTE_LINES.length) % VOTE_LINES.length]
}

export function chimmyExileLine(team: string): string {
  return `I'm taking ${team} this week. Their lineup has the best recent form on the board.`
}

const SURVIVED_LINES = [
  'Still standing. The numbers held.',
  'Another Tribal survived. On to the next one.',
  'Torch still lit. Back to work.',
] as const

export function chimmySurvivedLine(week: number): string {
  return SURVIVED_LINES[((week % SURVIVED_LINES.length) + SURVIVED_LINES.length) % SURVIVED_LINES.length]
}

export const CHIMMY_MERGED_LINE = 'Down to one tribe. Every vote is personal now, and I came to play.'

export type ChimmyChatLine =
  | { kind: 'vote'; week: number }
  | { kind: 'exile'; team: string }
  /** After a council it attended was read and it stayed. One per council (`id`). */
  | { kind: 'survived'; week: number; councilId: string }
  /** The first week the game is merged. Once per castaway. */
  | { kind: 'merged' }

function lineText(line: ChimmyChatLine): string {
  if (line.kind === 'vote') return chimmyVoteLine(line.week)
  if (line.kind === 'exile') return chimmyExileLine(line.team)
  if (line.kind === 'survived') return chimmySurvivedLine(line.week)
  return CHIMMY_MERGED_LINE
}

/** A fixed id for a once-only line, so a retried week never posts it twice. */
function onceId(leagueId: string, userId: string, line: ChimmyChatLine): string | null {
  if (line.kind === 'survived') return `chimmy-survived-${line.councilId}-${userId}`
  if (line.kind === 'merged') return `chimmy-merged-${leagueId}-${userId}`
  return null
}

/**
 * Post one line for a Chimmy castaway: a vote line to its tribe (or merged tribe) huddle, an Exile
 * line to the Exile chat. Returns whether a line was posted. Never throws: a chat line must not undo
 * a vote or a claim.
 */
export async function postChimmyCastawayLine(leagueId: string, userId: string, line: ChimmyChatLine): Promise<boolean> {
  try {
    const castaway = await prisma.survivorPlayer.findUnique({
      where: { leagueId_userId: { leagueId, userId } },
      select: { displayName: true, tribeId: true },
    })
    if (!castaway) return false
    const channel = line.kind !== 'exile'
      ? castaway.tribeId
        ? await prisma.survivorChatChannel.findFirst({
          where: { leagueId, channelType: { in: ['tribe', 'merge'] }, tribeId: castaway.tribeId, isArchived: false },
          select: { id: true, channelType: true },
        })
        : null
      : await prisma.survivorChatChannel.findFirst({
        where: { leagueId, channelType: 'exile', isArchived: false },
        select: { id: true, channelType: true },
      })
    if (!channel) return false
    const data = {
      leagueId,
      channelId: channel.id,
      channelType: channel.channelType,
      senderUserId: 'survivor-host-chimmy',
      senderName: castaway.displayName,
      senderIsHost: true,
      isSystemMessage: false,
      contentType: 'text',
      content: lineText(line),
    }
    const id = onceId(leagueId, userId, line)
    if (id) await upsertSurvivorChatMessage(prisma, { where: { id }, create: { id, ...data }, update: {} })
    else await createSurvivorChatMessage(prisma, { data })
    return true
  } catch (error) {
    console.warn('[survivor] Chimmy chat line failed', error instanceof Error ? error.message : error)
    return false
  }
}

const SEAT_PREFIX = 'orphan-'
const PRE_MERGE_PHASES = new Set(['pre_draft', 'drafting', 'pre_merge', 'post_swap'])

/**
 * As a week closes — every council of it read — Chimmy's castaways that are still in the game say
 * so: one line per council they voted at and stayed, and once, the first merged week, a merge line.
 * Spoiler-safe: the reading is over, and no line names anyone. Best-effort, never throws.
 */
export async function postChimmyWeekLines(leagueId: string, week: number): Promise<number> {
  try {
    const [cast, league, game] = await Promise.all([
      prisma.survivorPlayer.findMany({
        where: { leagueId, userId: { startsWith: SEAT_PREFIX }, playerState: 'active' },
        select: { userId: true, redraftRosterId: true },
      }),
      prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }),
      prisma.survivorGameState.findUnique({ where: { leagueId }, select: { phase: true } }),
    ])
    const managed = readManagedLineups(league?.settings)
    const chimmy = cast.filter((p) => isChimmyRunning(managed, p.redraftRosterId ?? p.userId.slice(SEAT_PREFIX.length), p.userId))
    if (chimmy.length === 0) return 0
    const userIds = chimmy.map((p) => p.userId)
    const councils = await prisma.survivorTribalCouncil.findMany({
      where: { leagueId, week, isRevealed: true },
      select: { id: true, eliminatedUserId: true },
    })
    const votes = councils.length
      ? await prisma.survivorVote.findMany({ where: { councilId: { in: councils.map((c) => c.id) }, voterUserId: { in: userIds } }, select: { councilId: true, voterUserId: true } })
      : []
    let posted = 0
    for (const council of councils) {
      for (const vote of votes.filter((v) => v.councilId === council.id)) {
        if (!vote.voterUserId || vote.voterUserId === council.eliminatedUserId) continue
        if (await postChimmyCastawayLine(leagueId, vote.voterUserId, { kind: 'survived', week, councilId: council.id })) posted++
      }
    }
    if (game?.phase && !PRE_MERGE_PHASES.has(game.phase)) {
      for (const userId of userIds) if (await postChimmyCastawayLine(leagueId, userId, { kind: 'merged' })) posted++
    }
    return posted
  } catch (error) {
    console.warn('[survivor] Chimmy week lines failed', error instanceof Error ? error.message : error)
    return 0
  }
}
