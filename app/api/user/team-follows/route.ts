import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { buildRateLimit429, consumeRateLimit } from '@/lib/rate-limit'
import {
  MAX_TEAM_FOLLOWS,
  TEAM_FOLLOW_SPORTS,
  followTeam,
  isTeamFollowSport,
  listTeamFollows,
  listTeamsForSport,
  markTeamFollowPromptSeen,
  unfollowTeam,
} from '@/lib/follows/teamFollows'

export const dynamic = 'force-dynamic'

/**
 * /api/user/team-follows — follow real-world teams for news + injury alerts (lib/follows/teamFollows).
 *
 * GET  ?sport=NFL  → { sports, max, teams: [{abbr,name}] (for that sport), follows: [...] | null }
 *                    `follows: null` = follows unavailable (table not migrated) — hide, don't claim "none".
 * POST { action: "follow" | "unfollow", sport, teamAbbr }
 * POST { action: "dismissPrompt" }  — the "follow your teams" popup was seen ("Not now" or saved).
 *
 * The gate is a session only, as /api/core/league-preferences: a follow is a list preference, not an
 * age- or deliverability-restricted action.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const sport = String(req.nextUrl.searchParams.get('sport') ?? '').toUpperCase()
  const [teams, follows] = await Promise.all([
    isTeamFollowSport(sport) ? listTeamsForSport(sport) : Promise.resolve([]),
    listTeamFollows(auth.userId).catch(() => null),
  ])
  return NextResponse.json(
    // Only what the picker shows: college teams also carry mascots and alternate names for matching.
    { sports: TEAM_FOLLOW_SPORTS, max: MAX_TEAM_FOLLOWS, teams: teams.map((t) => ({ abbr: t.abbr, name: t.name })), follows },
    { headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
  )
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const rl = consumeRateLimit({
    scope: 'user',
    action: 'team_follows',
    sleeperUsername: auth.userId,
    maxRequests: 120,
    windowMs: 60_000,
  })
  if (!rl.success) {
    return NextResponse.json(buildRateLimit429({ message: 'Too many changes — try again in a moment.', rl }), {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSec) },
    })
  }

  const body = (await req.json().catch(() => null)) as { action?: unknown; sport?: unknown; teamAbbr?: unknown } | null
  const action = body?.action

  if (action === 'dismissPrompt') {
    try {
      await markTeamFollowPromptSeen(auth.userId)
      return NextResponse.json({ ok: true })
    } catch {
      return NextResponse.json({ error: 'Could not save that. Please try again.' }, { status: 503 })
    }
  }

  if (action !== 'follow' && action !== 'unfollow') {
    return NextResponse.json({ error: 'Send action: "follow", "unfollow" or "dismissPrompt".' }, { status: 400 })
  }
  const sport = typeof body?.sport === 'string' ? body.sport : ''
  const teamAbbr = typeof body?.teamAbbr === 'string' ? body.teamAbbr.trim() : ''
  if (!sport || !teamAbbr) return NextResponse.json({ error: 'Send sport and teamAbbr.' }, { status: 400 })

  try {
    const result = action === 'follow' ? await followTeam(auth.userId, sport, teamAbbr) : await unfollowTeam(auth.userId, sport, teamAbbr)
    if (result === 'invalid') return NextResponse.json({ error: 'That team is not available to follow.' }, { status: 400 })
    if (result === 'limit') {
      return NextResponse.json({ error: `You can follow up to ${MAX_TEAM_FOLLOWS} teams.`, result }, { status: 409 })
    }
    if (result === 'unavailable') {
      return NextResponse.json({ error: 'Team follows are not available yet.', result }, { status: 503 })
    }
    return NextResponse.json({ ok: true, result })
  } catch {
    return NextResponse.json({ error: 'Your team follows could not be saved. Please try again.' }, { status: 503 })
  }
}
