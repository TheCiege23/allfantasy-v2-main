import { createHash } from 'node:crypto'
/**
 * [NEW] lib/big-brother/BigBrotherChatAnnouncements.ts
 * Post deterministic announcement payloads to league chat. Chimmy/bot posts; AI can narrate later.
 * PROMPT 3.
 */

import { prisma } from '@/lib/prisma'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'

/** Get user ID to post as (league owner as fallback when no system user). */
async function getAnnouncerUserId(leagueId: string, systemUserId?: string | null): Promise<string> {
  if (systemUserId) return systemUserId
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true },
  })
  return league?.userId ?? ''
}

/** Build and post a league chat message. Returns only when league has an announcer. */
async function post(
  leagueId: string,
  message: string,
  options: { type?: string; metadata?: Record<string, unknown>; systemUserId?: string | null }
): Promise<void> {
  const userId = await getAnnouncerUserId(leagueId, options.systemUserId)
  if (!userId) return
  await createLeagueChatMessage(leagueId, userId, message, {
    idempotencyKey: 'bb-announcement-' + createHash('sha256').update(`${leagueId}:${JSON.stringify(options.metadata ?? {})}`).digest('hex'),
    type: options.type ?? 'text',
    metadata: { bigBrother: true, ...options.metadata, chimmy: true },
  })
}

/**
 * Announce HOH winner. Deterministic payload; AI can add flavor in a separate message.
 */
export async function announceHOHWinner(args: {
  leagueId: string
  week: number
  hohRosterId: string
  hohDisplayName?: string
  systemUserId?: string | null
}): Promise<void> {
  const name = args.hohDisplayName ?? `Roster ${args.hohRosterId.slice(0, 8)}`
  await post(
    args.leagueId,
    `🏠 Week ${args.week} — Head of Household: ${name}. HOH has safety and nomination power.`,
    { metadata: { event: 'hoh_winner', week: args.week, hohRosterId: args.hohRosterId }, systemUserId: args.systemUserId }
  )
}

/**
 * Nomination ceremony: who is on the block.
 */
export async function announceNominationCeremony(args: {
  leagueId: string
  week: number
  nominee1RosterId: string
  nominee2RosterId: string
  name1?: string
  name2?: string
  systemUserId?: string | null
}): Promise<void> {
  const n1 = args.name1 ?? `Roster ${args.nominee1RosterId.slice(0, 8)}`
  const n2 = args.name2 ?? `Roster ${args.nominee2RosterId.slice(0, 8)}`
  await post(
    args.leagueId,
    `📌 Week ${args.week} — Nomination Ceremony: ${n1} and ${n2} are on the block.`,
    {
      metadata: {
        event: 'nomination_ceremony',
        week: args.week,
        nominee1RosterId: args.nominee1RosterId,
        nominee2RosterId: args.nominee2RosterId,
      },
      systemUserId: args.systemUserId,
    }
  )
}

/**
 * Veto draw: who is playing for the veto.
 */
export async function announceVetoDraw(args: {
  leagueId: string
  week: number
  participantRosterIds: string[]
  displayNames?: Record<string, string>
  systemUserId?: string | null
}): Promise<void> {
  const names = args.participantRosterIds.map(
    (id) => args.displayNames?.[id] ?? `Roster ${id.slice(0, 8)}`
  )
  await post(
    args.leagueId,
    `🎲 Week ${args.week} — Veto players: ${names.join(', ')}.`,
    {
      metadata: { event: 'veto_draw', week: args.week, participantRosterIds: args.participantRosterIds },
      systemUserId: args.systemUserId,
    }
  )
}

/**
 * Veto winner and decision (used / saved whom / kept same).
 */
export async function announceVetoResult(args: {
  leagueId: string
  week: number
  vetoWinnerRosterId: string
  vetoUsed: boolean
  savedRosterId?: string | null
  replacementRosterId?: string | null
  winnerName?: string
  savedName?: string
  replacementName?: string
  systemUserId?: string | null
}): Promise<void> {
  const winner = args.winnerName ?? `Roster ${args.vetoWinnerRosterId.slice(0, 8)}`
  if (!args.vetoUsed) {
    await post(
      args.leagueId,
      `🔑 Week ${args.week} — ${winner} won the Veto and chose to keep nominations the same.`,
      {
        metadata: { event: 'veto_result', week: args.week, vetoWinnerRosterId: args.vetoWinnerRosterId, vetoUsed: false },
        systemUserId: args.systemUserId,
      }
    )
    return
  }
  const saved = args.savedName ?? (args.savedRosterId ? `Roster ${args.savedRosterId.slice(0, 8)}` : '')
  const repl = args.replacementName ?? (args.replacementRosterId ? `Roster ${args.replacementRosterId.slice(0, 8)}` : '')
  await post(
    args.leagueId,
    `🔑 Week ${args.week} — ${winner} used the Veto to save ${saved}. Replacement nominee: ${repl}.`,
    {
      metadata: {
        event: 'veto_result',
        week: args.week,
        vetoWinnerRosterId: args.vetoWinnerRosterId,
        vetoUsed: true,
        savedRosterId: args.savedRosterId,
        replacementRosterId: args.replacementRosterId,
      },
      systemUserId: args.systemUserId,
    }
  )
}

/**
 * Eviction result: who was evicted and vote count (per visibility settings).
 */
export async function announceEviction(args: {
  leagueId: string
  week: number
  evictedRosterId: string
  evictedName?: string
  voteCount: Record<string, number>
  showExactTotals: boolean
  tieBreakUsed?: boolean
  juryEnrolled?: boolean
  systemUserId?: string | null
}): Promise<void> {
  const name = args.evictedName ?? `Roster ${args.evictedRosterId.slice(0, 8)}`
  const evictedVotes = args.voteCount[args.evictedRosterId] ?? 0
  const voteText = args.showExactTotals
    ? `Vote totals: ${JSON.stringify(args.voteCount)}.`
    : `${name} received ${evictedVotes} vote(s).`
  let msg = `🚪 Week ${args.week} — Evicted: ${name}. ${voteText}`
  if (args.tieBreakUsed) msg += ' (tie-break applied).'
  if (args.juryEnrolled) msg += ' They join the jury.'
  await post(args.leagueId, msg, {
    metadata: {
      event: 'eviction',
      week: args.week,
      evictedRosterId: args.evictedRosterId,
      voteCount: args.voteCount,
      juryEnrolled: args.juryEnrolled,
    },
    systemUserId: args.systemUserId,
  })
}

/**
 * Jury welcome (when threshold is reached).
 */
export async function announceJuryWelcome(args: {
  leagueId: string
  juryRosterIds: string[]
  displayNames?: Record<string, string>
  systemUserId?: string | null
}): Promise<void> {
  const names = args.juryRosterIds.map((id) => args.displayNames?.[id] ?? `Roster ${id.slice(0, 8)}`)
  await post(
    args.leagueId,
    `⚖️ The jury is now in session. Jury members: ${names.join(', ')}.`,
    {
      metadata: { event: 'jury_welcome', juryRosterIds: args.juryRosterIds },
      systemUserId: args.systemUserId,
    }
  )
}

/**
 * Finale: winner announcement.
 */
export async function announceFinaleWinner(args: {
  leagueId: string
  winnerRosterId: string
  winnerName?: string
  voteCount?: number
  systemUserId?: string | null
}): Promise<void> {
  const name = args.winnerName ?? `Roster ${args.winnerRosterId.slice(0, 8)}`
  const votes = args.voteCount != null ? ` (${args.voteCount} jury votes)` : ''
  await post(
    args.leagueId,
    `🏆 Big Brother winner: ${name}${votes}. Congratulations!`,
    {
      metadata: { event: 'finale_winner', winnerRosterId: args.winnerRosterId, voteCount: args.voteCount },
      systemUserId: args.systemUserId,
    }
  )
}
