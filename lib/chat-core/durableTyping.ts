import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * TYPING INDICATORS THAT SURVIVE MORE THAN ONE SERVER.
 *
 * ⚠ THIS REPLACES AN IN-MEMORY STORE THAT COULD NOT WORK IN PRODUCTION.
 * `ThreadRealtimeState` keeps typing in module-level Maps. On serverless that is
 * per-instance: you type on instance A, the person watching is served by
 * instance B, and they see nothing. The route existed, the tests passed, and the
 * feature could not have worked for two people in different requests.
 *
 * ⚠ IT IS STILL LATE, AND NOTHING HERE FIXES THAT. Chat refreshes every four to
 * eight seconds, so "someone is typing" can arrive after the message it was
 * announcing. Making the store durable makes it CORRECT, not fast. Genuinely
 * live typing needs a WebSocket or SSE transport this app does not have; that is
 * a transport decision, not a bug in this file.
 *
 * ⚠ SHORT TTL, AND EXPIRY IS THE ONLY WAY IT CLEARS. Nobody sends "I stopped
 * typing" — they close the tab, lose signal, or wander off. A typing row that
 * outlives its window would leave somebody permanently mid-sentence, so the row
 * expires on its own and the reader filters on the timestamp as well.
 */

const PREFIX = 'chat:typing:'

/**
 * How long one keystroke keeps you "typing". Slightly longer than the poll, so
 * a steady typist does not flicker between two refreshes.
 */
export const TYPING_WINDOW_MS = 10_000

export type TypingPerson = { userId: string; name: string }

type TypingRow = { name: string; at: string }

function keyFor(threadId: string, userId: string): string {
  return `${PREFIX}${threadId}:${userId}`
}

function prefixFor(threadId: string): string {
  return `${PREFIX}${threadId}:`
}

/** Record that this person is typing, right now. Best effort. */
export async function markTyping(
  threadId: string,
  user: { userId: string; name: string },
): Promise<void> {
  if (!threadId || !user.userId) return

  const now = Date.now()
  const data: TypingRow = { name: user.name || 'Someone', at: new Date(now).toISOString() }

  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey: keyFor(threadId, user.userId) },
      update: { data: data as never, expiresAt: new Date(now + TYPING_WINDOW_MS) },
      create: {
        cacheKey: keyFor(threadId, user.userId),
        data: data as never,
        expiresAt: new Date(now + TYPING_WINDOW_MS),
      },
    })
    .catch(() => undefined)
}

/** Stop showing this person as typing — used the moment they actually send. */
export async function clearTyping(threadId: string, userId: string): Promise<void> {
  if (!threadId || !userId) return
  await prisma.sportsDataCache
    .delete({ where: { cacheKey: keyFor(threadId, userId) } })
    .catch(() => undefined)
}

/**
 * Who is typing in this thread, excluding the person asking.
 *
 * Filters on the timestamp as well as the row's TTL: expiry is a cleanup
 * mechanism, not a guarantee, and a row that outlived its window must not leave
 * somebody stuck mid-sentence.
 */
export async function readTyping(
  threadId: string,
  viewerUserId: string | null | undefined,
): Promise<TypingPerson[]> {
  if (!threadId) return []

  const rows = await prisma.sportsDataCache
    .findMany({
      where: { cacheKey: { startsWith: prefixFor(threadId) }, expiresAt: { gt: new Date() } },
      select: { cacheKey: true, data: true },
      take: 50,
    })
    .catch(() => [] as Array<{ cacheKey: string; data: unknown }>)

  const prefix = prefixFor(threadId)
  const cutoff = Date.now() - TYPING_WINDOW_MS
  const out: TypingPerson[] = []

  for (const row of rows) {
    const userId = row.cacheKey.slice(prefix.length)
    if (!userId || userId === viewerUserId) continue

    const value = row.data as TypingRow | null
    if (!value?.at) continue

    const at = new Date(value.at).getTime()
    if (!Number.isFinite(at) || at < cutoff) continue

    out.push({ userId, name: value.name || 'Someone' })
  }

  return out
}
