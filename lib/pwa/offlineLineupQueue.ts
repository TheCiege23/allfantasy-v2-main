import type { RosterLineupLists } from '@/lib/league/lineup-swap'
import { OFFLINE_LINEUP_CACHE } from '@/lib/pwa/offlineLineupSnapshots'

/**
 * Lineup changes made with no network: kept on the device, sent when the connection comes back.
 *
 * Two records per league, both in the snapshot cache (`OFFLINE_LINEUP_CACHE`), so sign-out purges them
 * with no extra code and a worker update keeps them:
 *
 *  - the last `/api/league/roster` answer, which is what lets the full lineup editor open offline;
 *  - at most ONE queued edit. A save carries the whole lineup, so a later offline edit replaces an
 *    earlier one rather than queueing behind it — but it keeps the FIRST edit's `baseVersion`, because
 *    every offline edit is built on the roster that was last seen online.
 *
 * 🛑 THE DEVICE NEVER DECIDES WHETHER A CHANGE IS STILL ALLOWED. A queued edit is sent as an ordinary
 * save, and the server checks it against the clock and the roster AT ARRIVAL: a player whose game has
 * kicked off since is refused by the engine's lock check (server time; a phone's clock can be wrong or
 * set back), and a roster that changed since — a waiver add, a trade, the manager on another device — is
 * refused by `expectedLineupVersion` (lib/roster/lineupVersion.ts). A refused edit is DROPPED and the
 * person told why; retrying it would only be refused again. Only a missing network, a 5xx or a lapsed
 * session keeps it for the next attempt.
 */
export const OFFLINE_ROSTER_DATA_PREFIX = '/__offline/lineup-data/'
export const OFFLINE_LINEUP_QUEUE_PREFIX = '/__offline/lineup-queue/'
/** Fired on `window` after each queued edit is sent; `detail` is a `LineupSyncResult`. */
export const OFFLINE_LINEUP_SYNC_EVENT = 'af:offline-lineup-sync'

export type QueuedLineupEdit = {
  v: 1
  id: string
  leagueId: string
  rosterId: string
  week: number
  /** The `roster` body `/api/leagues/roster/save` takes, built exactly as an online save builds it. */
  roster: Record<string, unknown>
  /** The lineup as the screen shows it, so the edit is still visible after a reload. */
  lists: RosterLineupLists
  /** The roster version the edit was made on; null when the server sent none (no conflict check). */
  baseVersion: string | null
  queuedAt: string
}

export type LineupSyncResult = {
  leagueId: string
  outcome: 'saved' | 'rejected' | 'kept'
  /** Set for 'rejected': the server's reason, in words a person can read. */
  message?: string
  conflict?: boolean
}

const dataKey = (leagueId: string) => `${OFFLINE_ROSTER_DATA_PREFIX}${encodeURIComponent(leagueId)}`
const queueKey = (leagueId: string) => `${OFFLINE_LINEUP_QUEUE_PREFIX}${encodeURIComponent(leagueId)}`
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })

async function open() {
  if (typeof caches === 'undefined') return null
  return caches.open(OFFLINE_LINEUP_CACHE)
}

async function readJson(key: string): Promise<unknown> {
  const cache = await open()
  const res = cache ? await cache.match(key) : undefined
  return res ? res.json() : null
}

/** Never throws. */
export async function saveOfflineRosterData(leagueId: string, data: unknown, now: Date = new Date()): Promise<boolean> {
  try {
    const cache = await open()
    if (!cache) return false
    await cache.put(dataKey(leagueId), json({ v: 1, leagueId, savedAt: now.toISOString(), data }))
    return true
  } catch {
    return false
  }
}

/** Never throws; null when nothing usable is stored for this league. */
export async function readOfflineRosterData<T = unknown>(leagueId: string): Promise<{ savedAt: string; data: T } | null> {
  try {
    const r = (await readJson(dataKey(leagueId))) as { v?: number; leagueId?: string; savedAt?: string; data?: T } | null
    return r && r.v === 1 && r.leagueId === leagueId && typeof r.savedAt === 'string' && r.data ? { savedAt: r.savedAt, data: r.data } : null
  } catch {
    return null
  }
}

function isQueuedEdit(value: unknown): value is QueuedLineupEdit {
  const e = value as Partial<QueuedLineupEdit> | null
  return Boolean(e && e.v === 1 && typeof e.id === 'string' && typeof e.leagueId === 'string' && typeof e.rosterId === 'string' && e.roster && e.lists)
}

/** Never throws; null when nothing is waiting for this league. */
export async function readQueuedLineupEdit(leagueId: string): Promise<QueuedLineupEdit | null> {
  try {
    const e = await readJson(queueKey(leagueId))
    return isQueuedEdit(e) && e.leagueId === leagueId ? e : null
  } catch {
    return null
  }
}

/**
 * Stores the edit, replacing any earlier one for the league. Returns what was stored, or null when the
 * device cannot store it — the caller must then say the change was NOT kept.
 */
export async function queueLineupEdit(
  edit: Omit<QueuedLineupEdit, 'v' | 'id' | 'queuedAt'>,
  now: Date = new Date(),
): Promise<QueuedLineupEdit | null> {
  try {
    const cache = await open()
    if (!cache) return null
    const earlier = await readQueuedLineupEdit(edit.leagueId)
    // Same team and week: still built on the roster the first edit started from.
    const sameBase = earlier && earlier.rosterId === edit.rosterId && earlier.week === edit.week
    const stored: QueuedLineupEdit = {
      ...edit,
      v: 1,
      id: `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      baseVersion: sameBase ? earlier.baseVersion : edit.baseVersion,
      queuedAt: now.toISOString(),
    }
    await cache.put(queueKey(edit.leagueId), json(stored))
    return stored
  } catch {
    return null
  }
}

/** Removes the queued edit only if it is still `id`: an edit queued while this one was in flight stays. */
async function clearQueuedLineupEdit(leagueId: string, id: string): Promise<void> {
  try {
    const cache = await open()
    const current = await readQueuedLineupEdit(leagueId)
    if (cache && current?.id === id) await cache.delete(queueKey(leagueId))
  } catch {
    // Left in place, it is sent again next time and refused or no-ops; never worse than losing it.
  }
}

async function sendOne(edit: QueuedLineupEdit, fetchImpl: typeof fetch): Promise<LineupSyncResult> {
  let res: Response
  try {
    res = await fetchImpl('/api/leagues/roster/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leagueId: edit.leagueId,
        rosterId: edit.rosterId,
        week: edit.week,
        roster: edit.roster,
        ...(edit.baseVersion ? { expectedLineupVersion: edit.baseVersion } : {}),
      }),
    })
  } catch {
    return { leagueId: edit.leagueId, outcome: 'kept' }
  }
  // Not an answer about the lineup: the server is down, busy, or the session lapsed. Try again later.
  if (res.status >= 500 || res.status === 401 || res.status === 429) return { leagueId: edit.leagueId, outcome: 'kept' }
  if (res.ok) {
    await clearQueuedLineupEdit(edit.leagueId, edit.id)
    return { leagueId: edit.leagueId, outcome: 'saved' }
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
  await clearQueuedLineupEdit(edit.leagueId, edit.id)
  return {
    leagueId: edit.leagueId,
    outcome: 'rejected',
    message: typeof body.error === 'string' && body.error ? body.error : 'The server did not accept it.',
    conflict: body.code === 'LINEUP_CONFLICT',
  }
}

let inflight: Promise<LineupSyncResult[]> | null = null

/**
 * Sends every queued edit once. Concurrent callers share one run, so the app-wide syncer and the lineup
 * screen reacting to the same `online` event cannot send an edit twice. Never throws.
 */
export function flushQueuedLineupEdits(fetchImpl: typeof fetch = fetch): Promise<LineupSyncResult[]> {
  if (inflight) return inflight
  inflight = (async () => {
    const results: LineupSyncResult[] = []
    try {
      const cache = await open()
      if (!cache) return results
      const keys = await cache.keys()
      for (const key of keys) {
        const path = new URL(typeof key === 'string' ? key : key.url, 'https://local.invalid').pathname
        if (!path.startsWith(OFFLINE_LINEUP_QUEUE_PREFIX)) continue
        const edit = await readQueuedLineupEdit(decodeURIComponent(path.slice(OFFLINE_LINEUP_QUEUE_PREFIX.length)))
        if (!edit) continue
        const result = await sendOne(edit, fetchImpl)
        results.push(result)
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OFFLINE_LINEUP_SYNC_EVENT, { detail: result }))
      }
    } catch {
      // Whatever was not sent is still queued.
    }
    return results
  })().finally(() => {
    inflight = null
  })
  return inflight
}
