import 'server-only'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership, type LeagueAccessResult } from '@/lib/league-access'

/**
 * requireLeagueApiAccess — one membership gate for league API routes.
 *
 * WHY IT TOLERATES TWO ID SPACES. `[leagueId]` in these routes is sometimes the
 * canonical `League.id` uuid and sometimes the provider's own league id (a
 * Sleeper numeric string). `resolveLeagueMembership` keys on the uuid, so
 * dropping it into a provider-id route would 403 every real member while looking
 * completely correct in review — a gate that rejects the people it exists to
 * protect is worse than no gate, because it gets reverted wholesale.
 *
 * So an id that resolves to no league is retried against `platformLeagueId`
 * before anyone is refused. The membership decision itself is unchanged: this
 * only makes sure it is asked about the right league.
 *
 * Ordering is preserved from resolveLeagueMembership — 401 anonymous, 404 no
 * such league, 403 not a member — so a caller cannot use the status to discover
 * which leagues exist while signed out.
 */

export type LeagueApiAccessResult =
  | { ok: true; leagueId: string; userId: string; access: LeagueAccessResult }
  | { ok: false; response: NextResponse }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Canonical League.id for an id that may be a uuid or a provider league id. */
async function canonicalLeagueId(rawLeagueId: string): Promise<string | null> {
  if (UUID.test(rawLeagueId)) return rawLeagueId
  const league = await prisma.league
    .findFirst({ where: { platformLeagueId: rawLeagueId }, select: { id: true } })
    .catch(() => null)
  return league?.id ?? null
}

export async function requireLeagueApiAccess(
  rawLeagueId: string | undefined | null
): Promise<LeagueApiAccessResult> {
  if (!rawLeagueId || !String(rawLeagueId).trim()) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Missing leagueId' }, { status: 400 }),
    }
  }

  const session = (await getServerSession(authOptions as never)) as
    | { user?: { id?: string } }
    | null
  const userId = session?.user?.id

  // Anonymous is refused before any lookup, so an unauthenticated caller cannot
  // use response timing or status to probe which league ids exist.
  if (!userId) {
    return { ok: false, response: NextResponse.json({ error: 'anonymous' }, { status: 401 }) }
  }

  const leagueId = (await canonicalLeagueId(String(rawLeagueId).trim())) ?? String(rawLeagueId).trim()
  const membership = await resolveLeagueMembership(leagueId, userId)
  if (!membership.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: membership.reason }, { status: membership.status }),
    }
  }

  return { ok: true, leagueId, userId, access: membership.access }
}
