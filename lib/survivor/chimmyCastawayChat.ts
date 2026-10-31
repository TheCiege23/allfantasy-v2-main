import 'server-only'

import { prisma } from '@/lib/prisma'
import { createSurvivorChatMessage } from './survivorChatBridge'

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

export type ChimmyChatLine = { kind: 'vote'; week: number } | { kind: 'exile'; team: string }

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
    const channel = line.kind === 'vote'
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
    await createSurvivorChatMessage(prisma, {
      data: {
        leagueId,
        channelId: channel.id,
        channelType: channel.channelType,
        senderUserId: 'survivor-host-chimmy',
        senderName: castaway.displayName,
        senderIsHost: true,
        isSystemMessage: false,
        contentType: 'text',
        content: line.kind === 'vote' ? chimmyVoteLine(line.week) : chimmyExileLine(line.team),
      },
    })
    return true
  } catch (error) {
    console.warn('[survivor] Chimmy chat line failed', error instanceof Error ? error.message : error)
    return false
  }
}
