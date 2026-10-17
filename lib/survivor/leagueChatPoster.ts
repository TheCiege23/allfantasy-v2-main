/**
 * League Chat Auto-Poster — posts host messages to league chat
 * for major events: eliminations, weekly recaps, merge, idol plays, etc.
 */

import { prisma } from '@/lib/prisma'

const AI_HOST_ID = 'survivor-ai-host'
const AI_HOST_NAME = '@Chimmy'

async function getTribeChatChannelId(leagueId: string, tribeId: string): Promise<string | null> {
  const channel = await (prisma as any).survivorChatChannel.findFirst({
    where: { leagueId, channelType: 'tribe', tribeId, isArchived: false },
    select: { id: true },
  })
  return channel?.id ?? null
}

async function getLeagueChatChannelId(leagueId: string): Promise<string | null> {
  const channel = await (prisma as any).survivorChatChannel.findFirst({
    where: { leagueId, channelType: 'league' },
    select: { id: true },
  })
  return channel?.id ?? null
}

async function postToChannel(
  leagueId: string,
  channelId: string,
  channelType: 'league' | 'tribe' | 'exile' | 'jury' | 'private_ai',
  content: string,
  contentType: 'text' | 'card' | 'system' | 'announcement' = 'announcement',
  cardData?: Record<string, unknown>,
  messageId?: string,
): Promise<void> {
  const data = {
    ...(messageId ? { id: messageId } : {}),
    leagueId,
    channelId,
    channelType,
    senderUserId: AI_HOST_ID,
    senderName: AI_HOST_NAME,
    senderIsHost: true,
    isSystemMessage: true,
    content,
    contentType,
    cardData: cardData ?? undefined,
    isPinned: contentType === 'announcement',
  }
  if (messageId) {
    await (prisma as any).survivorChatMessage.upsert({ where: { id: messageId }, create: data, update: {} })
  } else {
    await (prisma as any).survivorChatMessage.create({ data })
  }
}

async function postToLeagueChat(
  leagueId: string,
  content: string,
  contentType: 'text' | 'card' | 'system' | 'announcement' = 'announcement',
  cardData?: Record<string, unknown>,
  messageId?: string,
): Promise<void> {
  const channelId = await getLeagueChatChannelId(leagueId)
  if (!channelId) {
    if (messageId) throw new Error('Survivor league chat is not ready for the weekly recap')
    return
  }

  await postToChannel(leagueId, channelId, 'league', content, contentType, cardData, messageId)
}

export async function postScrollRevealToTribeChat(
  leagueId: string,
  tribeId: string,
  tribeName: string,
  eliminatedName: string,
  week: number,
): Promise<void> {
  const channelId = await getTribeChatChannelId(leagueId, tribeId)
  if (!channelId) return

  const content = `Scroll reveal complete for ${tribeName}. The tribe has spoken. **${eliminatedName}** was voted out in Week ${week}.`
  await postToChannel(leagueId, channelId, 'tribe', content, 'card', {
    type: 'tribal_scroll_reveal',
    tribeId,
    tribeName,
    eliminatedName,
    week,
  })
}

export async function postLeagueRevealFollowUp(
  leagueId: string,
  tribeName: string,
  eliminatedName: string,
  week: number,
): Promise<void> {
  const content = `please wlecome the new look "${tribeName}". The tribe has spoken. **${eliminatedName}** was voted out in Week ${week}.`
  await postToLeagueChat(leagueId, content, 'announcement', {
    type: 'tribal_reveal_follow_up',
    tribeName,
    eliminatedName,
    week,
  })
}

/**
 * Post elimination announcement to league chat.
 */
export async function postEliminationAnnouncement(
  leagueId: string,
  eliminatedName: string,
  week: number,
  idolPlayed: boolean,
  tieOccurred: boolean,
): Promise<void> {
  let content = `The tribe has spoken. **${eliminatedName}** has been voted out in Week ${week}.`
  if (idolPlayed) content += ' A hidden idol was played during this Elimination Council.'
  if (tieOccurred) content += ' A tie occurred before the final result.'

  await postToLeagueChat(leagueId, content, 'card', {
    type: 'elimination',
    eliminatedName,
    week,
    idolPlayed,
    tieOccurred,
  })
}

/**
 * Post weekly recap to league chat.
 */
export async function postWeeklyRecap(
  leagueId: string,
  week: number,
  recap: {
    challengeWinner?: string
    tribalLoser?: string
    eliminatedPlayer?: string
    immunityHolder?: string
    idolsPlayed?: string[]
    twistSummary?: string
    topScorer?: string
    topScore?: number
  },
): Promise<void> {
  const lines: string[] = [`**Week ${week} Recap**`]

  if (recap.challengeWinner) lines.push(`Challenge won by ${recap.challengeWinner}`)
  if (recap.immunityHolder) lines.push(`Immunity: ${recap.immunityHolder}`)
  if (recap.topScorer) lines.push(`Top scorer: ${recap.topScorer} (${recap.topScore?.toFixed(1) ?? '?'} pts)`)
  if (recap.tribalLoser) lines.push(`Elimination Council: ${recap.tribalLoser}`)
  if (recap.eliminatedPlayer) lines.push(`Voted out: ${recap.eliminatedPlayer}`)
  if (recap.idolsPlayed?.length) lines.push(`Idols played: ${recap.idolsPlayed.join(', ')}`)
  if (recap.twistSummary) lines.push(`Twist: ${recap.twistSummary}`)

  await postToLeagueChat(leagueId, lines.join('\n'), 'card', {
    type: 'weekly_recap',
    week,
    ...recap,
  }, `survivor-weekly-recap:${leagueId}:${week}`)
}

/**
 * Post merge announcement to league chat.
 */
export async function postMergeAnnouncement(
  leagueId: string,
  mergedTribeName: string,
  remainingPlayers: number,
  expiredPowers: number,
): Promise<void> {
  let content = `**The tribes have merged!** Welcome to **${mergedTribeName}**.`
  content += ` ${remainingPlayers} survivors remain.`
  if (expiredPowers > 0) content += ` ${expiredPowers} pre-merge power(s) have expired.`
  content += ' Individual immunity begins now.'

  await postToLeagueChat(leagueId, content, 'announcement', {
    type: 'merge',
    mergedTribeName,
    remainingPlayers,
    expiredPowers,
  })
}

/**
 * Post challenge announcement to league chat.
 */
export async function postChallengeAnnouncement(
  leagueId: string,
  title: string,
  description: string,
  deadline: string,
  reward: string,
): Promise<void> {
  const content = `**New Challenge: ${title}**\n${description}\n\nReward: ${reward}\nDeadline: ${new Date(deadline).toLocaleString()}`

  await postToLeagueChat(leagueId, content, 'card', {
    type: 'challenge_announcement',
    title,
    description,
    deadline,
    reward,
  })
}

/**
 * Post elimination council opening to league chat.
 */
export async function postTribalCouncilOpening(
  leagueId: string,
  tribeName: string,
  week: number,
  voteDeadline: string,
): Promise<void> {
  const content = `**Elimination Council — Week ${week}**\n${tribeName} must vote someone out.\nVote privately by messaging @Chimmy.\nDeadline: ${new Date(voteDeadline).toLocaleString()}`

  await postToLeagueChat(leagueId, content, 'card', {
    type: 'tribal_opening',
    tribeName,
    week,
    voteDeadline,
  })
}

/**
 * Post winner announcement to league chat.
 */
export async function postWinnerAnnouncement(
  leagueId: string,
  winnerName: string,
  voteCount: number,
  totalJurors: number,
): Promise<void> {
  const content = `**The Sole Survivor is ${winnerName}!**\nWinning with ${voteCount} out of ${totalJurors} jury votes.`

  await postToLeagueChat(leagueId, content, 'announcement', {
    type: 'winner',
    winnerName,
    voteCount,
    totalJurors,
  })
}

/**
 * Post idol play announcement to league chat.
 */
export async function postIdolPlayAnnouncement(
  leagueId: string,
  announcement: string,
  playerName?: string,
  powerType?: string,
): Promise<void> {
  await postToLeagueChat(leagueId, announcement, 'card', {
    type: 'idol_played',
    playerName,
    powerType,
  })
}

/**
 * Post idol transfer notification (after trade/waiver) — NOT to league chat,
 * just logged. The new owner gets a private DM, not a public announcement.
 */
export async function postIdolTransferLog(
  leagueId: string,
  fromManager: string,
  toManager: string,
  powerType: string,
  reason: string,
): Promise<void> {
  // Silent — no league chat post for transfers.
  // Transfer is private. Only the new holder knows via @Chimmy DM.
  // But we log it for commissioner audit trail.
  const { logAuditEntry } = await import('./auditFramework')
  await logAuditEntry({
    leagueId,
    category: 'idol',
    action: 'idol_transferred',
    data: { fromManager, toManager, powerType, reason },
  })
}
