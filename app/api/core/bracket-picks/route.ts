/**
 * /api/core/bracket-picks — the /core Bracket Challenge's saved champion + series-length pick, one
 * per account, sport and season (lib/core-app/bracketPicks.ts).
 *
 * GET ?sport=mlb  → `{ status: "ok", sport, seasonYear, pick: { championTeamId, finalLength, updatedAt } | null }`
 * PUT `{ sport, championTeamId: string | null, finalLength: number | null }` → the same shape, as saved.
 *
 * Either answers `{ status: "unavailable" }` while the `core_bracket_picks` migration is not applied
 * (P2021/P2022) — GET with 200, because "this feature is not switched on yet" is not an error on a
 * page load, PUT with 503, because a save that did not happen must not read as success. The screen
 * then keeps its preview behaviour and copy.
 *
 * The gate is a session, nothing more — the same reasoning as /api/core/league-preferences: a
 * personal pick is not an age- or deliverability-restricted action.
 *
 * ⚠ VALIDATED AGAINST THE BRACKET, NOT TRUSTED FROM THE CLIENT. The sport must be one whose bracket
 * is built (`available`), the champion must be a club the screen's picker offers for that sport
 * (`getBracketPool`, the same list), and the length one of the shell's options. The season is the
 * server's, never the body's.
 *
 * ⚠ NO LOCK, because the screen has no lock time to honour (see lib/core-app/bracketPicks.ts).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getBracketPool } from '@/lib/core-app/bracketChallenge'
import {
  BRACKET_SEASON_YEAR,
  isSavableSport,
  parseBracketPickInput,
  type BracketPicksResponse,
} from '@/lib/core-app/bracketPicks'
import { readBracketPick, saveBracketPick } from '@/lib/core-app/bracketPicksStore'
import { buildRateLimit429, consumeRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

function json(body: BracketPicksResponse | { error: string }, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const sport = req.nextUrl.searchParams.get('sport')
  if (!isSavableSport(sport)) {
    return json({ error: 'That sport has no bracket to save picks for.' }, 400)
  }

  try {
    const pick = await readBracketPick(auth.userId, sport, BRACKET_SEASON_YEAR)
    if (pick === 'unavailable') return json({ status: 'unavailable' })
    return json({ status: 'ok', sport, seasonYear: BRACKET_SEASON_YEAR, pick })
  } catch {
    return json({ error: 'Your saved picks could not be read. Please try again.' }, 503)
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const rl = consumeRateLimit({
    scope: 'core',
    action: 'bracket_picks',
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

  const parsed = parseBracketPickInput(await req.json().catch(() => null))
  if (!parsed.ok) return json({ error: parsed.error }, 400)
  const input = parsed.value

  if (input.championTeamId !== null) {
    let pool: Array<{ id: string }>
    try {
      pool = await getBracketPool(input.sport)
    } catch {
      // Not a 400: we could not CHECK the team, which says nothing about whether it is valid.
      return json({ error: 'The team list could not be read just now. Please try again.' }, 503)
    }
    if (!pool.some((team) => team.id === input.championTeamId)) {
      return json({ error: 'That team is not in this bracket.' }, 400)
    }
  }

  try {
    const saved = await saveBracketPick(auth.userId, input, BRACKET_SEASON_YEAR)
    if (saved === 'unavailable') return json({ status: 'unavailable' }, 503)
    return json({ status: 'ok', sport: input.sport, seasonYear: BRACKET_SEASON_YEAR, pick: saved })
  } catch {
    return json({ error: 'Your picks could not be saved. Please try again.' }, 503)
  }
}
