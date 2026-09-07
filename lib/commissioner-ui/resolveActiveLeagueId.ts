import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { League } from '@prisma/client'
import { ACTIVE_LEAGUE_COOKIE_KEY } from './activeLeague/constants'

export interface ActiveLeagueOption {
  id: string
  name: string
}

function isActiveStatus(league: League | null): league is League {
  if (!league) return false
  const status = String(league.status ?? '').trim().toUpperCase()
  return !status || !['ARCHIVED', 'COMPLETE', 'COMPLETED', 'CLOSED'].includes(status)
}

/**
 * This user's own active (non-archived) leagues, most-recent-roster first,
 * deduped by league id (one user can hold more than one roster in the same
 * league). Same session/roster/status rule `resolveActiveLeagueId` uses —
 * see its own doc comment for why `Roster.platformUserId` and not
 * `app/api/user/active-league/route.ts`'s broken `leagueMember` query.
 */
async function getActiveLeaguesForSessionUser(): Promise<League[]> {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  if (!userId) return []

  const rosters = await prisma.roster.findMany({
    where: { platformUserId: userId },
    include: { league: true },
    orderBy: { createdAt: 'desc' },
  })

  const seen = new Set<string>()
  const leagues: League[] = []
  for (const r of rosters as { league: League | null }[]) {
    if (!isActiveStatus(r.league)) continue
    const id = String(r.league.id)
    if (seen.has(id)) continue
    seen.add(id)
    leagues.push(r.league)
  }
  return leagues
}

/** The current commissioner's own active leagues, for the header's league selector to list. */
export async function listActiveLeaguesForUser(): Promise<ActiveLeagueOption[]> {
  const leagues = await getActiveLeaguesForSessionUser()
  return leagues.map((l) => ({ id: String(l.id), name: l.name ?? 'Untitled league' }))
}

/**
 * Resolves the current commissioner's league via the same session call and
 * "most recent non-archived" rule `app/api/user/active-league/route.ts`
 * intends — but querying `Roster` by `platformUserId`, not that route's own
 * `prisma.leagueMember` (there is no `LeagueMember` model in schema.prisma
 * at all; that route's `as any`-cast query does not correspond to any real
 * model and cannot work as written — a pre-existing bug in a route outside
 * Commissioner OS, out of scope to fix here). `Roster.platformUserId`
 * matched against the session's `user.id` is the real, already-established
 * pattern elsewhere in this app (e.g. `app/api/idp/scores/route.ts`).
 *
 * Established in Mission Control's `live.ts` (Phase 3.2) and duplicated
 * verbatim across League Health (3.5), Manager Intelligence (3.6),
 * Recommendations Center (3.7), and League Analytics (3.10) — each copy
 * flagged as a candidate for extraction, more urgently each time. Extracted
 * here in Phase 3.11 once a sixth module (Reports) turned out not to need
 * it at all, making this a clean, zero-risk moment to pay down the
 * duplication before some future module needs a sixth copy.
 *
 * A `commissioner_os_active_league_id` cookie, when present and naming one
 * of this user's own active leagues, overrides the "most recent roster"
 * default — the header's league selector writes it. Never trusted blindly:
 * the cookie is checked against this same ownership query, so a tampered or
 * stale cookie can only ever resolve to a league this session already owns,
 * never someone else's.
 */
/**
 * The selector's cookie, or null when there is no request scope to read one from.
 *
 * 🛑 THE `catch` IS NARROW ON PURPOSE, AND WIDENING IT WOULD BE A PRODUCTION BUG.
 * `cookies()` throws two very different things, and only one of them is safe to
 * swallow:
 *
 *   - Outside a request scope it throws a PLAIN `Error` ("`cookies` was called
 *     outside a request scope"), carrying no `digest`. That is every vitest run —
 *     a unit test has no request — and it is not an error condition for this
 *     function: with no request there is no user cookie, so there is no override
 *     and the caller should fall back to the "most recent roster" default.
 *   - During prerendering it throws Next's `DynamicServerError`, carrying
 *     `digest: 'DYNAMIC_SERVER_USAGE'`. That one is a SIGNAL, not a failure: it is
 *     how Next learns the route is dynamic. Swallowing it would let a page that
 *     reads a per-user cookie be statically cached, serving one commissioner's
 *     league to everyone.
 *
 * So the discriminator is the `digest`, not the message: rethrow anything that
 * carries one, swallow only the digest-less wrong-context error. That also keeps
 * `NEXT_REDIRECT` and `NEXT_NOT_FOUND` — Next's other digest-carrying control-flow
 * signals — propagating, which a bare `catch {}` would have eaten too.
 *
 * Production behaviour is unchanged: every caller of `resolveActiveLeagueId` is an
 * App Router server component (`app/commissioner-os/**` pages and layout), where a
 * request scope is guaranteed and this helper simply reads the cookie.
 */
async function readActiveLeagueCookie(): Promise<string | null> {
  try {
    const store = await cookies()
    return store.get(ACTIVE_LEAGUE_COOKIE_KEY)?.value ?? null
  } catch (error) {
    if (typeof (error as { digest?: unknown } | null)?.digest === 'string') throw error
    return null
  }
}

export async function resolveActiveLeagueId(): Promise<string | null> {
  const leagues = await getActiveLeaguesForSessionUser()
  if (leagues.length === 0) return null

  const requested = await readActiveLeagueCookie()
  if (requested) {
    const match = leagues.find((l) => String(l.id) === requested)
    if (match) return String(match.id)
  }

  return String(leagues[0].id)
}
