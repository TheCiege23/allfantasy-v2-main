import type { RosterLineupLists } from '@/lib/league/lineup-swap'
import type { ExpandedStarterSlot } from '@/lib/league/lineup-expand-template'
import type { DisplayPlayerMap } from '@/lib/player-data/adapters/redraftDisplayPlayers'

/**
 * A read-only copy of the reader's lineup, kept on the device so it can be shown with no network.
 *
 * 🛑 WHY A SNAPSHOT AND NOT A CACHED PAGE OR A CACHED API RESPONSE. `public/sw.js` deliberately never
 * stores signed-in HTML: on an iPhone home-screen launch a cached page can replay a VPN block or a
 * login redirect after the cause is gone (`__tests__/pwa-vpn-recovery.test.ts`). And
 * `/api/league/roster` is a large payload shaped for the editor — the screen keeps that too
 * (lib/pwa/offlineLineupQueue.ts), so the editor opens offline, but the worker's page has to render
 * with plain string handling. So the screen also writes this small, flat record after every
 * successful online load, and two readers use it: the service worker's offline fallback page on a
 * cold launch, and the lineup screen when its fetch fails and the editor's copy is missing.
 *
 * ⚠ THE CACHE NAME IS LOAD-BEARING TWICE. The `AllFantasy-pages-` prefix is what
 * `lib/pwa/signOutAndPurge.ts` deletes on sign-out, so a shared device does not show the previous
 * person's lineup offline — no extra purge code, and none to forget. And `public/sw.js` lists the
 * same name in `ALL_CACHES`, or its `activate` handler would delete every snapshot on each worker
 * update. The worker cannot import this module, so the string is duplicated there and a test pins
 * the two together.
 *
 * ⚠ SHAPE IS VERSIONED (`v`). The worker renders these with plain string handling, so a reader that
 * meets a version it does not know must skip the record rather than guess at it.
 */
export const OFFLINE_LINEUP_CACHE = 'AllFantasy-pages-offline-lineups'
export const OFFLINE_LINEUP_KEY_PREFIX = '/__offline/lineups/'
export const OFFLINE_LINEUP_SNAPSHOT_VERSION = 1

export type OfflineLineupRow = {
  /** Slot label for a starter (QB, FLEX…); BN / IR / TX otherwise. */
  slot: string
  /** Null for an empty starter slot. */
  name: string | null
  position: string | null
  team: string | null
  /** "vs DAL · Sun 1:00 PM" — formatted at save time, in the reader's own locale and zone. */
  game: string | null
  injury: string | null
}

export type OfflineLineupSnapshot = {
  v: typeof OFFLINE_LINEUP_SNAPSHOT_VERSION
  leagueId: string
  leagueName: string
  sport: string
  teamName: string
  week: number | null
  /** ISO timestamp of the online load this copy came from. */
  savedAt: string
  starters: OfflineLineupRow[]
  bench: OfflineLineupRow[]
  ir: OfflineLineupRow[]
  taxi: OfflineLineupRow[]
}

export function offlineLineupKey(leagueId: string): string {
  return `${OFFLINE_LINEUP_KEY_PREFIX}${encodeURIComponent(leagueId)}`
}

function gameText(p: DisplayPlayerMap[string] | undefined): string | null {
  if (!p) return null
  const bits: string[] = []
  if (String(p.opponent ?? '').toUpperCase() === 'BYE') bits.push('Bye week')
  else if (p.opponent) bits.push(`${p.homeAway === 'away' ? '@' : 'vs'} ${p.opponent}`)
  const k = p.kickoffTimeIso ? new Date(p.kickoffTimeIso) : null
  if (k && Number.isFinite(k.getTime())) bits.push(k.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }))
  return bits.length ? bits.join(' · ') : null
}

function row(id: string, slot: string, players: DisplayPlayerMap): OfflineLineupRow {
  const p = id ? players[id] : undefined
  if (!id) return { slot, name: null, position: null, team: null, game: null, injury: null }
  return {
    slot,
    name: p?.name ?? 'Unknown player',
    position: p?.position || null,
    team: p?.team || null,
    game: gameText(p),
    injury: p?.injuryStatus || null,
  }
}

export function buildOfflineLineupSnapshot(input: {
  leagueId: string
  leagueName: string
  sport: string
  teamName: string
  week: number | null | undefined
  slots: ExpandedStarterSlot[]
  lists: RosterLineupLists
  players: DisplayPlayerMap
  now?: Date
}): OfflineLineupSnapshot {
  const { slots, lists, players } = input
  return {
    v: OFFLINE_LINEUP_SNAPSHOT_VERSION,
    leagueId: input.leagueId,
    leagueName: input.leagueName,
    sport: input.sport,
    teamName: input.teamName,
    week: input.week ?? null,
    savedAt: (input.now ?? new Date()).toISOString(),
    starters: slots.map((s, i) => row(lists.starters[i] ?? '', s.label, players)),
    bench: lists.bench.filter(Boolean).map((id) => row(id, 'BN', players)),
    ir: lists.ir.filter(Boolean).map((id) => row(id, 'IR', players)),
    taxi: lists.taxi.filter(Boolean).map((id) => row(id, 'TX', players)),
  }
}

export function isOfflineLineupSnapshot(value: unknown): value is OfflineLineupSnapshot {
  const v = value as Partial<OfflineLineupSnapshot> | null
  return Boolean(
    v &&
      v.v === OFFLINE_LINEUP_SNAPSHOT_VERSION &&
      typeof v.leagueId === 'string' &&
      typeof v.savedAt === 'string' &&
      Array.isArray(v.starters) &&
      Array.isArray(v.bench),
  )
}

/** Never throws: a snapshot is a convenience, and failing to write one must not break the screen. */
export async function saveOfflineLineupSnapshot(snapshot: OfflineLineupSnapshot): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false
    const cache = await caches.open(OFFLINE_LINEUP_CACHE)
    await cache.put(
      offlineLineupKey(snapshot.leagueId),
      new Response(JSON.stringify(snapshot), { headers: { 'Content-Type': 'application/json' } }),
    )
    return true
  } catch {
    return false
  }
}

/** Never throws; null when there is no usable copy for this league. */
export async function readOfflineLineupSnapshot(leagueId: string): Promise<OfflineLineupSnapshot | null> {
  try {
    if (typeof caches === 'undefined') return null
    const cache = await caches.open(OFFLINE_LINEUP_CACHE)
    const res = await cache.match(offlineLineupKey(leagueId))
    if (!res) return null
    const json: unknown = await res.json()
    return isOfflineLineupSnapshot(json) && json.leagueId === leagueId ? json : null
  } catch {
    return null
  }
}

/** "Last updated 2:14 PM" today, "Last updated Tue 9:02 AM" otherwise. */
export function snapshotAgeLabel(savedAt: string, now: Date = new Date()): string {
  const d = new Date(savedAt)
  if (!Number.isFinite(d.getTime())) return 'Last updated at an unknown time'
  const sameDay = d.toDateString() === now.toDateString()
  const when = sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  return `Last updated ${when}`
}
