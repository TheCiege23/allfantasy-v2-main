import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * Confessionals: short private notes a manager records during the season, like the
 * to-camera moments on the show. Nobody else reads one while its author is still playing. When a
 * manager is voted out, the week's episode quotes their latest confessional; when the season ends,
 * every confessional is revealed on the Episodes page.
 *
 * Free and AI-free: the text is the manager's own words. Stored as SurvivorHostMessage rows
 * (channelType 'confessional'), so no migration is needed.
 */

export const CONFESSIONAL_MAX_LENGTH = 280
export const CONFESSIONAL_DAILY_LIMIT = 3
const CHANNEL = 'confessional'
const DAY_MS = 86_400_000

export type Confessional = { id: string; text: string; createdAt: string }
export type RevealedConfessional = Confessional & { author: string }

export type SubmitConfessionalResult = { ok: true; confessional: Confessional } | { ok: false; status: 400 | 403 | 409 | 429; error: string }

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export async function submitConfessional(leagueId: string, userId: string, raw: string, now = new Date()): Promise<SubmitConfessionalResult> {
  const text = clean(raw)
  if (!text) return { ok: false, status: 400, error: 'Write something first.' }
  if (text.length > CONFESSIONAL_MAX_LENGTH) return { ok: false, status: 400, error: `Keep it to ${CONFESSIONAL_MAX_LENGTH} characters.` }
  const player = await prisma.survivorPlayer.findFirst({ where: { leagueId, userId }, select: { playerState: true } })
  if (!player) return { ok: false, status: 403, error: 'Only managers in this season can record a confessional.' }
  const game = await prisma.survivorGameState.findUnique({ where: { leagueId }, select: { phase: true } })
  if (game?.phase === 'complete') return { ok: false, status: 409, error: 'The season is over: the confessionals have been revealed.' }
  const recent = await prisma.survivorHostMessage.count({ where: { leagueId, channelType: CHANNEL, targetUserId: userId, createdAt: { gte: new Date(now.getTime() - DAY_MS) } } })
  if (recent >= CONFESSIONAL_DAILY_LIMIT) return { ok: false, status: 429, error: `That's ${CONFESSIONAL_DAILY_LIMIT} confessionals today. Save the next one for tomorrow.` }
  const row = await prisma.survivorHostMessage.create({
    data: { leagueId, channelType: CHANNEL, messageType: 'confessional', targetUserId: userId, content: text, isPosted: false },
    select: { id: true, content: true, createdAt: true },
  })
  return { ok: true, confessional: { id: row.id, text: row.content, createdAt: row.createdAt.toISOString() } }
}

/** The viewer's own confessionals, newest first. */
export async function listMyConfessionals(leagueId: string, userId: string): Promise<Confessional[]> {
  const rows = await prisma.survivorHostMessage.findMany({
    where: { leagueId, channelType: CHANNEL, targetUserId: userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, content: true, createdAt: true },
  })
  return rows.map(row => ({ id: row.id, text: row.content, createdAt: row.createdAt.toISOString() }))
}

/** A manager's latest confessional, for the episode that sends them home. */
export async function latestConfessional(leagueId: string, userId: string): Promise<string | null> {
  const row = await prisma.survivorHostMessage.findFirst({
    where: { leagueId, channelType: CHANNEL, targetUserId: userId },
    orderBy: { createdAt: 'desc' },
    select: { content: true },
  })
  return row?.content ?? null
}

/** Every confessional with its author, oldest first, once the season is complete; null before then. */
export async function revealedConfessionals(leagueId: string): Promise<RevealedConfessional[] | null> {
  const game = await prisma.survivorGameState.findUnique({ where: { leagueId }, select: { phase: true } })
  if (game?.phase !== 'complete') return null
  const [rows, players] = await Promise.all([
    prisma.survivorHostMessage.findMany({
      where: { leagueId, channelType: CHANNEL },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: { id: true, content: true, createdAt: true, targetUserId: true },
    }),
    prisma.survivorPlayer.findMany({ where: { leagueId }, select: { userId: true, displayName: true } }),
  ])
  const nameOf = new Map(players.map(player => [player.userId, player.displayName]))
  return rows.map(row => ({ id: row.id, text: row.content, createdAt: row.createdAt.toISOString(), author: (row.targetUserId && nameOf.get(row.targetUserId)) || 'A manager' }))
}
