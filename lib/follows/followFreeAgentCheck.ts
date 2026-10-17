/**
 * "He's free in your league" — the alert behind the Finder's "Alert me" (Guap, 2026-10-08).
 *
 * For every player you follow (NFL, Sleeper id), it watches YOUR leagues and tells you the moment
 * he goes from being on someone's roster to being on nobody's — dropped, released, cut — so you can
 * claim him before the rest of the league notices. Followers already heard his NEWS
 * (PlayerNewsNotificationService); this is the one thing a follow can do that a news feed cannot.
 *
 * ⚠ A TRANSITION, NEVER A STATE. "He is free in KBFL" is on his card and the home board already; a
 * push saying it every fifteen minutes would be noise. Each run stores, per (user, player), the
 * leagues where he was last SEEN ON A ROSTER (`held`), and alerts only for a league in that set where
 * he is now on none. The first run for a follow writes the baseline and says nothing.
 *
 * ⚠ ONLY A LEAGUE READ ON BOTH SIDES COUNTS. `held` is built from the leagues the scan could read
 * (followingCard.scanFreeAgentLeagues `checked`): a league that was unreadable last time — a partial
 * import, an ESPN roster with untranslatable ids — is in neither set, so its coming back readable is
 * not mistaken for a drop.
 *
 * Delivery is the dispatcher's (in-app, email, push under the user's `followed_players` switch,
 * quiet hours and league mutes); SMS is skipped — there is no registered sender yet. Each alert is
 * also keyed so two overlapping sweeps cannot send it twice.
 */

import { playerRef } from '@/lib/core-app/playerRef'

/** Leagues read per scan call — scanFreeAgentLeagues reads at most MAX_FREE_AGENT_LEAGUES at once. */
export const SCAN_CHUNK = 12
/** A user's NFL leagues read per run, at most. */
export const MAX_LEAGUES_PER_USER = 60
/** Followers walked per run, most recently active first. */
export const MAX_USERS = 300
/** A snapshot unchanged this long expires; the next run re-seeds it silently. */
export const SNAPSHOT_TTL_DAYS = 60

export type FreeLeague = { leagueId: string; leagueName: string; href: string }

/** The leagues where he was ON a roster: read, and not free. */
export function heldLeagues(checked: readonly string[], free: readonly FreeLeague[]): string[] {
  const freeIds = new Set(free.map((f) => f.leagueId))
  return [...new Set(checked.filter((id) => !freeIds.has(id)))].sort()
}

/** Leagues he was held in last time and is free in now. A missing baseline alerts on nothing. */
export function newlyFree(prevHeld: readonly string[] | null, free: readonly FreeLeague[]): FreeLeague[] {
  if (prevHeld === null) return []
  const before = new Set(prevHeld)
  return free.filter((f) => before.has(f.leagueId))
}

export function freeAlertCopy(playerName: string, leagues: readonly FreeLeague[]): { title: string; body: string } {
  const names = leagues.map((l) => l.leagueName)
  if (names.length === 1) {
    return {
      title: `${playerName} is free in ${names[0]}`,
      body: `Nobody in ${names[0]} has him any more — claim him before someone else does.`,
    }
  }
  const list = names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return {
    title: `${playerName} is free in ${names.length} of your leagues`,
    body: `Now unclaimed in ${list}. Claim him before someone else does.`,
  }
}

export function snapshotKey(userId: string, sleeperId: string): string {
  return `follow-free:v1:${userId}:${sleeperId}`
}

/** `follow-free:<sleeperId>:<leagueIds>:<Eastern day>` — the dispatcher appends `:<userId>`. */
export function freeAlertDedupeKey(sleeperId: string, leagues: readonly FreeLeague[], now: Date): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  return `follow-free:${sleeperId}:${leagues.map((l) => l.leagueId).sort().join(',')}:${day}`
}

/** The NFL season a league row must carry to be read: January and February belong to last year's. */
export function currentNflSeason(now: Date): number {
  return now.getUTCMonth() <= 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear()
}

export type FollowedPlayer = { sleeperId: string; externalId: string | null; name: string }
export type UserLeague = { id: string; name: string | null; platform: string | null; sport: string | null }

export type FollowFreeAgentDeps = {
  listUsers: (limit: number) => Promise<string[] | null>
  listFollows: (userId: string) => Promise<FollowedPlayer[] | null>
  loadLeagues: (userId: string, season: number) => Promise<UserLeague[]>
  scan: (userId: string, leagues: readonly UserLeague[], sleeperIds: readonly string[]) => Promise<{ free: Map<string, FreeLeague[]>; checked: string[] }>
  readSnapshot: (key: string) => Promise<string[] | null>
  writeSnapshot: (key: string, held: string[], expiresAt: Date) => Promise<void>
  alreadySent: (sourceKey: string) => Promise<boolean>
  dispatch: (input: {
    userId: string
    title: string
    body: string
    href: string
    leagueId: string | null
    dedupePrefix: string
    meta: Record<string, unknown>
  }) => Promise<void>
}

export type FollowFreeAgentRun =
  | {
      ran: true
      dryRun: boolean
      users: number
      followsChecked: number
      seeded: number
      alerts: number
      deduped: number
      notReached: number
      errors: Array<{ userId: string; error: string }>
    }
  | { ran: false; reason: 'unavailable' | 'no_follows' }

function cardHref(p: FollowedPlayer): string {
  return p.externalId
    ? `/core/players?q=${encodeURIComponent(p.name)}&player=${encodeURIComponent(playerRef('NFL', p.externalId))}`
    : `/core/players?q=${encodeURIComponent(p.name)}`
}

export async function runFollowFreeAgentCheck(
  opts: { dryRun: boolean; userId: string | null; budgetMs: number; now?: Date },
  deps: FollowFreeAgentDeps,
): Promise<FollowFreeAgentRun> {
  const started = Date.now()
  const now = opts.now ?? new Date()
  const users = opts.userId ? [opts.userId] : await deps.listUsers(MAX_USERS)
  if (users === null) return { ran: false, reason: 'unavailable' }
  if (users.length === 0) return { ran: false, reason: 'no_follows' }

  const run = { ran: true as const, dryRun: opts.dryRun, users: 0, followsChecked: 0, seeded: 0, alerts: 0, deduped: 0, notReached: 0, errors: [] as Array<{ userId: string; error: string }> }
  const expiresAt = new Date(now.getTime() + SNAPSHOT_TTL_DAYS * 86_400_000)

  for (const userId of users) {
    if (Date.now() - started > opts.budgetMs) {
      run.notReached += 1
      continue
    }
    run.users += 1
    try {
      const follows = ((await deps.listFollows(userId)) ?? []).filter((f) => f.sleeperId)
      if (follows.length === 0) continue
      const leagues = (await deps.loadLeagues(userId, currentNflSeason(now))).slice(0, MAX_LEAGUES_PER_USER)
      if (leagues.length === 0) continue

      const ids = follows.map((f) => f.sleeperId)
      const free = new Map<string, FreeLeague[]>()
      const checked: string[] = []
      for (let i = 0; i < leagues.length; i += SCAN_CHUNK) {
        const part = await deps.scan(userId, leagues.slice(i, i + SCAN_CHUNK), ids)
        checked.push(...part.checked)
        for (const [id, list] of part.free) free.set(id, [...(free.get(id) ?? []), ...list])
      }

      for (const f of follows) {
        run.followsChecked += 1
        const key = snapshotKey(userId, f.sleeperId)
        const nowFree = free.get(f.sleeperId) ?? []
        const prev = await deps.readSnapshot(key)
        const held = heldLeagues(checked, nowFree)
        const fresh = newlyFree(prev, nowFree)
        if (prev === null) run.seeded += 1
        // Written BEFORE the send: a dispatch that throws must not leave the old baseline to re-fire every sweep.
        if (!opts.dryRun && (prev === null || prev.join(',') !== held.join(','))) await deps.writeSnapshot(key, held, expiresAt)
        if (fresh.length === 0) continue

        const dedupePrefix = freeAlertDedupeKey(f.sleeperId, fresh, now)
        if (await deps.alreadySent(`${dedupePrefix}:${userId}`)) {
          run.deduped += 1
          continue
        }
        run.alerts += 1
        if (opts.dryRun) continue
        const copy = freeAlertCopy(f.name, fresh)
        await deps.dispatch({
          userId,
          title: copy.title,
          body: copy.body,
          // One league: straight to its waivers. Several: his card, which lists every one with a claim link.
          href: fresh.length === 1 ? fresh[0]!.href : cardHref(f),
          leagueId: fresh.length === 1 ? fresh[0]!.leagueId : null,
          dedupePrefix,
          meta: { followed: true, playerName: f.name, sleeperId: f.sleeperId, leagueIds: fresh.map((l) => l.leagueId) },
        })
      }
    } catch (err) {
      run.errors.push({ userId, error: err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160) })
    }
  }
  return run
}
