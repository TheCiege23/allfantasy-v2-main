import 'server-only'

import { getRedisClient } from '@/lib/queues/bullmq'

/**
 * Who is in the draft room right now — per roster, from the room's own live-sync poll.
 *
 * Presence was removed with Supabase (the room's `onlineCount` was hard-coded to 0), and Yahoo's
 * 2026 room drew the complaint this answers: "I couldn't tell who was in the draft. No logo change
 * or icon change when they were in. Or out." No new polling and no new table: every open room
 * already calls /draft/live-sync (2s with the clock running, 8s idle, 30s in a background tab), so
 * that call records the viewer's roster and returns who else was seen.
 *
 * "In the room" = seen within PRESENCE_TTL_MS. 75s covers two background-tab polls with slack, so
 * a manager who switched tabs stays present and one who closed the room drops off within ~a minute.
 *
 * Storage: Redis (a sorted set per league, score = last seen) when the shared client is configured,
 * so every web replica sees the same room; otherwise this process's memory, which is exact with one
 * replica and simply empties on a deploy (the next polls refill it within seconds). Presence is
 * ephemeral by nature — nothing here is a record, so nothing is written to Postgres.
 */

export const PRESENCE_TTL_MS = 75_000

export interface PresenceStore {
  touch(room: string, member: string, now: number): Promise<void>
  online(room: string, now: number): Promise<string[]>
}

export function memoryPresenceStore(): PresenceStore {
  const rooms = new Map<string, Map<string, number>>()
  const prune = (room: string, now: number) => {
    const m = rooms.get(room)
    if (!m) return null
    for (const [k, t] of m) if (now - t > PRESENCE_TTL_MS) m.delete(k)
    if (m.size === 0) rooms.delete(room)
    return rooms.get(room) ?? null
  }
  return {
    async touch(room, member, now) {
      const m = rooms.get(room) ?? new Map<string, number>()
      m.set(member, now)
      rooms.set(room, m)
      prune(room, now)
    },
    async online(room, now) {
      const m = prune(room, now)
      return m ? [...m.keys()].sort() : []
    },
  }
}

type RedisLike = {
  zadd(key: string, score: number, member: string): Promise<unknown>
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<unknown>
  zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]>
  pexpire(key: string, ms: number): Promise<unknown>
}

export function redisPresenceStore(redis: RedisLike): PresenceStore {
  const key = (room: string) => `draft-presence:v1:${room}`
  return {
    async touch(room, member, now) {
      const k = key(room)
      await redis.zadd(k, now, member)
      await redis.zremrangebyscore(k, '-inf', now - PRESENCE_TTL_MS)
      await redis.pexpire(k, PRESENCE_TTL_MS * 2)
    },
    async online(room, now) {
      return (await redis.zrangebyscore(key(room), now - PRESENCE_TTL_MS, '+inf')).sort()
    },
  }
}

const memory = memoryPresenceStore()
let warned = false
/** After a Redis failure, memory is used until this time: one slow Redis must not slow every poll. */
let redisBrokenUntil = 0
const REDIS_BUDGET_MS = 400

function withBudget<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('presence store timeout')), REDIS_BUDGET_MS))])
}

function store(now: number): PresenceStore {
  if (now < redisBrokenUntil) return memory
  const redis = getRedisClient() as unknown as RedisLike | null
  if (!redis) return memory
  const r = redisPresenceStore(redis)
  // ⚠ The live-sync poll carries the draft; a Redis that is configured but unreachable can hold a
  // command for seconds (the shared client's connect timeout is 8s). Each call gets a small budget.
  return { touch: (a, b, c) => withBudget(r.touch(a, b, c)), online: (a, b) => withBudget(r.online(a, b)) }
}

/**
 * Record these rosters (every team the viewer holds; none for a spectator) as present and return every roster present in the league's room. Never throws:
 * presence is a nicety, and a Redis hiccup must not fail the live-sync poll that carries the draft.
 * On a Redis failure it answers from memory for that call.
 */
export async function touchAndListDraftPresence(
  leagueId: string,
  rosterIds: readonly string[],
  now: number = Date.now(),
  s: PresenceStore = store(now),
): Promise<string[]> {
  try {
    for (const r of rosterIds) await s.touch(leagueId, r, now)
    return await s.online(leagueId, now)
  } catch (e) {
    if (s !== memory) redisBrokenUntil = now + 60_000
    if (!warned) {
      warned = true
      console.warn('[draft-presence] store failed, using memory:', e instanceof Error ? e.message : 'unknown')
    }
    for (const r of rosterIds) await memory.touch(leagueId, r, now)
    return memory.online(leagueId, now)
  }
}

/** A viewer's rosters in a league, remembered briefly: the poll runs every 2s and rosters rarely change. */
const rosterCache = new Map<string, { at: number; ids: string[] }>()
export async function viewerRosterIdsCached(
  leagueId: string,
  userId: string,
  load: () => Promise<string[]>,
  now: number = Date.now(),
): Promise<string[]> {
  const k = `${leagueId}|${userId}`
  const hit = rosterCache.get(k)
  if (hit && now - hit.at < 120_000) return hit.ids
  const ids = await load().catch(() => [] as string[])
  rosterCache.set(k, { at: now, ids })
  if (rosterCache.size > 5000) rosterCache.delete(rosterCache.keys().next().value as string)
  return ids
}
