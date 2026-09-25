import { prisma } from '@/lib/prisma'
import { redactAnonymousPollVotes } from './messagePolls'

type Option = { id: string; text: string; votes: string[] }
type Poll = { question: string; options: Option[]; closeAt?: string; closed?: boolean; anonymous?: boolean; allowMultiple?: boolean }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function platformPoll(body: string, metadata: unknown): Poll | null {
  let raw: unknown = record(metadata) ? metadata.poll : null
  if (!raw) { try { raw = JSON.parse(body) } catch { return null } }
  if (!record(raw) || typeof raw.question !== 'string' || !Array.isArray(raw.options)) return null
  const votes = record(raw.votes) ? raw.votes : {}
  const options = raw.options.map((o, i) => typeof o === 'string'
    ? { id: String(i), text: o, votes: Array.isArray(votes[i]) ? (votes[i] as unknown[]).filter((v): v is string => typeof v === 'string') : [] }
    : record(o) && typeof o.text === 'string'
      ? { id: typeof o.id === 'string' ? o.id : String(i), text: o.text, votes: Array.isArray(o.votes) ? o.votes.filter((v): v is string => typeof v === 'string') : [] }
      : null).filter((o): o is Option => o !== null)
  if (options.length < 2) return null
  return { question: raw.question, options, closeAt: typeof raw.closeAt === 'string' ? raw.closeAt : undefined, closed: raw.closed === true, anonymous: raw.anonymous === true, allowMultiple: raw.allowMultiple === true }
}

export function visiblePlatformPoll(body: string, metadata: unknown, viewer: string) {
  const poll = platformPoll(body, metadata)
  if (!poll) return { body, metadata }
  const base = { ...(record(metadata) ? metadata : {}) }
  delete base.votes
  const safe = redactAnonymousPollVotes({ ...base, poll }, viewer) as Record<string, unknown>
  return { body: poll.question, metadata: safe }
}

export async function mutatePlatformPoll(userId: string, threadId: string, messageId: string, option: string | number | null): Promise<boolean> {
  const member = await prisma.platformChatThreadMember.findFirst({ where: { threadId, userId, isBlocked: false }, select: { id: true } })
  if (!member) return false
  // Compare-and-swap prevents simultaneous voters from overwriting one another.
  for (let attempt = 0; attempt < 3; attempt++) {
    const msg = await prisma.platformChatMessage.findFirst({ where: { id: messageId, threadId, OR: [{ isPrivate: false }, { visibleToUserId: userId }] } })
    if (!msg || (record(msg.metadata) && msg.metadata.deletedAt)) return false
    const poll = platformPoll(msg.body, msg.metadata)
    if (!poll) return false
    if (option === null) {
      if (msg.senderUserId !== userId) return false
      poll.closed = true
    } else {
      if (poll.closed || (poll.closeAt && Date.parse(poll.closeAt) <= Date.now())) return false
      const target = typeof option === 'number' ? poll.options[option] : poll.options.find(o => o.id === option)
      if (!target) return false
      const withdraw = target.votes.includes(userId)
      poll.options = poll.options.map(o => ({ ...o, votes: o.id === target.id
        ? withdraw ? o.votes.filter(id => id !== userId) : [...o.votes, userId]
        : poll.allowMultiple ? o.votes : o.votes.filter(id => id !== userId) }))
    }
    const metadata = { ...(record(msg.metadata) ? msg.metadata : {}), poll }
    const updated = await prisma.platformChatMessage.updateMany({
      where: { id: msg.id, updatedAt: msg.updatedAt },
      data: { messageType: 'poll', body: poll.question, metadata: JSON.parse(JSON.stringify(metadata)), updatedAt: new Date(Math.max(Date.now(), msg.updatedAt.getTime() + 1)) },
    })
    if (updated.count === 1) return true
  }
  return false
}
