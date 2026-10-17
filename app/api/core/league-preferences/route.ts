/**
 * /api/core/league-preferences — the account's favorite, hidden and ordered leagues for the universal
 * My Team view (lib/core-app/leaguePreferences.ts).
 *
 * GET  → `{ favorites: string[] | null, hidden: string[], order: string[] }`
 * POST `{ field: "favorites" | "hidden" | "order", leagueIds: string[] }` → saves that ONE list.
 *
 * Every list is a set of ids that is INTERSECTED with the leagues the account plays wherever it is
 * read, so a foreign id saved here can never widen what anyone sees.
 *
 * The gate is a session, nothing more — the same reasoning as /api/user/profile/avatar: a list
 * preference is not an age- or deliverability-restricted action, and `requireVerifiedUser` (which
 * demands `ageConfirmedAt`) has locked every OAuth account out of a setting before.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { normalizeLeagueIdList, LEAGUE_PREFERENCE_KEYS, type LeaguePreferenceField } from '@/lib/core-app/leaguePreferences'
import { getLeaguePreferences, setLeaguePreference } from '@/lib/core-app/leaguePreferencesStore'
import { buildRateLimit429, consumeRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  return NextResponse.json(await getLeaguePreferences(auth.userId), {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const rl = consumeRateLimit({
    scope: 'core',
    action: 'league_preferences',
    sleeperUsername: auth.userId,
    maxRequests: 60,
    windowMs: 60_000,
  })
  if (!rl.success) {
    return NextResponse.json(buildRateLimit429({ message: 'Too many changes — try again in a moment.', rl }), {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSec) },
    })
  }

  const body = (await req.json().catch(() => null)) as { field?: unknown; leagueIds?: unknown } | null
  const field = body?.field
  /*
   * ⚠ OWN PROPERTIES ONLY. `field in LEAGUE_PREFERENCE_KEYS` also answers true for inherited names —
   * "__proto__", "constructor", "toString" — which would have reached the store with a non-string
   * JSON key. Caught by the route test on 2026-10-02.
   */
  if (typeof field !== 'string' || !Object.prototype.hasOwnProperty.call(LEAGUE_PREFERENCE_KEYS, field)) {
    return NextResponse.json({ error: 'Send field: "favorites", "hidden" or "order".' }, { status: 400 })
  }
  if (!Array.isArray(body?.leagueIds)) {
    return NextResponse.json({ error: 'Send leagueIds: a list of league ids.' }, { status: 400 })
  }
  const ids = normalizeLeagueIdList(body.leagueIds)
  try {
    await setLeaguePreference(auth.userId, field as LeaguePreferenceField, ids)
    return NextResponse.json({ ok: true, field, count: ids.length })
  } catch {
    return NextResponse.json({ error: 'Your league settings could not be saved. Please try again.' }, { status: 503 })
  }
}
