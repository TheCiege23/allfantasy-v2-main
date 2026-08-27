import 'server-only'
import { prisma } from '@/lib/prisma'
import { getPresenceStatus, type PresenceStatus } from '@/lib/chat-core/ChatPresenceResolver'

/**
 * WHO IS LOOKING AT THIS CHAT RIGHT NOW.
 *
 * ⚠ NOTHING DURABLE RECORDED THIS BEFORE. `ChatPresenceResolver` has had
 * `getPresenceStatus` since it was written and no caller; `ThreadRealtimeState`
 * keeps read receipts in module-level Maps, which on serverless means an
 * instance-local answer — somebody actively reading on instance A reads as
 * offline to everybody served by instance B. `PlatformChatThreadMember.lastReadAt`
 * is durable but has never been written: production holds 14 member rows and
 * ZERO read receipts, so building on it would have shown an empty room forever.
 *
 * ⚠ ONE ROW PER VIEWER, NOT ONE BLOB PER ROOM. A single JSON map per league
 * would make every beacon a read-modify-write, and two people arriving at once
 * would race — the loser vanishes from the room until their next beacon. Keying
 * each viewer separately makes the write a blind upsert that cannot lose.
 *
 * ⚠ ABSENCE IS NEVER INFERRED. This reports the people it has seen, and says
 * nothing about anyone else. A member with no beacon is not "offline" — they may
 * be on a build that never sent one — so the UI must not render this as a
 * roster with everybody else greyed out.
 *
 * `SportsDataCache` is the store despite the name: it is a plain keyed JSON
 * table with a TTL, already used this way for the play-by-play feed, and adding
 * a table for something this ephemeral is not worth a migration.
 */

const PREFIX = 'chat:presence:'

/** Rows outlive the presence window so a returning viewer keeps their identity. */
const ROW_TTL_MS = 15 * 60 * 1000

/**
 * Beacons closer together than this are skipped. Chat polls every 4–8s; without
 * a floor, ten people in a room would write a row every few seconds each, all
 * day, to say nothing new.
 */
export const PRESENCE_BEACON_MIN_INTERVAL_MS = 45_000

/** Past this a viewer is dropped from the room entirely rather than shown stale. */
const PRESENCE_WINDOW_MS = 5 * 60 * 1000

/*
 * League chat only, for now. A `thread` variant would be a two-word change, but
 * the DM and huddle route has four separate return branches and none of them is
 * wired — and an unused variant here is precisely the dead-feature pattern this
 * codebase is already full of. Widen it when a caller exists.
 */
export type PresenceScope = { kind: 'league'; id: string }

export type PresentViewer = {
  userId: string
  name: string
  status: PresenceStatus
  lastSeenAt: string
}

type PresenceRow = { name: string; at: string }

function scopeKey(scope: PresenceScope): string {
  return `${PREFIX}${scope.kind}:${scope.id}:`
}

function viewerKey(scope: PresenceScope, userId: string): string {
  return `${scopeKey(scope)}${userId}`
}

/**
 * Record that this viewer has the chat open. Returns whether a write happened,
 * which is only interesting to tests — callers should ignore it and never let a
 * failed beacon affect the response they were already sending.
 */
export async function markViewingChat(
  scope: PresenceScope,
  viewer: {
    userId: string
    /*
     * Lazy on purpose. Most beacons are throttled away, and resolving a display
     * name costs a lookup — one this would otherwise pay on every poll, for
     * every reader, to write nothing.
     */
    resolveName: () => Promise<string | null>
  },
): Promise<boolean> {
  if (!scope.id || !viewer.userId) return false

  const key = viewerKey(scope, viewer.userId)
  const now = Date.now()

  const existing = await prisma.sportsDataCache
    .findUnique({ where: { cacheKey: key } })
    .catch(() => null)

  if (existing) {
    const prev = existing.data as PresenceRow | null
    const prevAt = prev?.at ? new Date(prev.at).getTime() : 0
    if (Number.isFinite(prevAt) && now - prevAt < PRESENCE_BEACON_MIN_INTERVAL_MS) {
      return false
    }
  }

  const name = await viewer.resolveName().catch(() => null)
  const data: PresenceRow = { name: name || 'Someone', at: new Date(now).toISOString() }
  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey: key },
      update: { data: data as never, expiresAt: new Date(now + ROW_TTL_MS) },
      create: { cacheKey: key, data: data as never, expiresAt: new Date(now + ROW_TTL_MS) },
    })
    .catch(() => undefined)

  return true
}

/**
 * The viewers seen in this room recently, most recent first.
 *
 * Returns [] on any failure. Presence is decoration on a working chat; a chat
 * that fails to load because nobody could be listed would be a worse product
 * than a chat with no presence strip.
 */
export async function readChatPresence(scope: PresenceScope): Promise<PresentViewer[]> {
  if (!scope.id) return []

  const rows = await prisma.sportsDataCache
    .findMany({
      where: { cacheKey: { startsWith: scopeKey(scope) }, expiresAt: { gt: new Date() } },
      select: { cacheKey: true, data: true },
      take: 200,
    })
    .catch(() => [] as Array<{ cacheKey: string; data: unknown }>)

  const prefix = scopeKey(scope)
  const out: PresentViewer[] = []

  for (const row of rows) {
    const userId = row.cacheKey.slice(prefix.length)
    if (!userId) continue

    const value = row.data as PresenceRow | null
    if (!value?.at) continue

    const seen = new Date(value.at)
    if (Number.isNaN(seen.getTime())) continue
    if (Date.now() - seen.getTime() > PRESENCE_WINDOW_MS) continue

    out.push({
      userId,
      name: value.name || 'Someone',
      status: getPresenceStatus(seen),
      lastSeenAt: seen.toISOString(),
    })
  }

  out.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
  return out
}
