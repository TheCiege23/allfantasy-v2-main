import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { getBigBrotherConfig } from './BigBrotherLeagueConfig'
import { getBigBrotherFinalists } from './BigBrotherFinalists'
import { tallyFinaleVotes } from './BigBrotherJuryEngine'
import { announceFinaleWinner } from './BigBrotherChatAnnouncements'

export async function isFinaleReached(leagueId: string): Promise<boolean> { return (await getBigBrotherFinalists(leagueId)) !== null }

export async function runFinaleTallyAndAnnounce(leagueId: string, options?: { systemUserId?: string | null; winnerDisplayName?: string }): Promise<{ ok: boolean; winnerRosterId?: string; voteCount?: number; error?: string }> {
  const config = await getBigBrotherConfig(leagueId)
  if (!config) return { ok: false, error: 'Not a Big Brother league' }
  if (!await isFinaleReached(leagueId)) return { ok: false, error: 'Finale has not been reached' }
  const result = await prisma.$transaction(async tx => {
    // Both finale submission and publication take this row lock before inspecting ballots.
    await tx.bigBrotherLeagueConfig.update({ where: { id: config.configId }, data: { updatedAt: new Date() } })
    const published = await tx.bigBrotherAuditLog.findFirst({ where: { leagueId, configId: config.configId, eventType: 'finale_vote' }, orderBy: { createdAt: 'desc' } })
    if (published) {
      const metadata = published.metadata as { winnerRosterId?: string; voteCount?: number } | null
      return metadata?.winnerRosterId ? { targetRosterId: metadata.winnerRosterId, voteCount: metadata.voteCount ?? 0 } : null
    }
    const tally = await tallyFinaleVotes(leagueId, tx)
    if (!tally) return null
    await tx.bigBrotherAuditLog.create({ data: { id: 'bb-finale-' + createHash('sha256').update(`${leagueId}:${config.configId}`).digest('hex'), leagueId, configId: config.configId, eventType: 'finale_vote', metadata: { winnerRosterId: tally.targetRosterId, voteCount: tally.voteCount } } })
    return tally
  })
  if (!result) return { ok: false, error: 'Finale needs all eligible jury ballots and a unique winner' }
  await announceFinaleWinner({ leagueId, winnerRosterId: result.targetRosterId, winnerName: options?.winnerDisplayName, voteCount: result.voteCount, systemUserId: options?.systemUserId })
  return { ok: true, winnerRosterId: result.targetRosterId, voteCount: result.voteCount }
}
