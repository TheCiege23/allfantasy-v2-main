import { SPORT_ORDER, SPORT_SHELLS, type SportKey } from '@/lib/brackets/sportShell'

/**
 * /core Bracket Challenge — the saved-picks contract, shared by the screen
 * (components/core-app/screens/BracketChallenge.tsx), the route
 * (app/api/core/bracket-picks/route.ts) and the store (./bracketPicksStore.ts).
 *
 * Client-safe on purpose: no Prisma, no server-only import. The screen reads the
 * season and the response shape from here, so the two cannot drift.
 *
 * ⚠ ONE PICK PER ACCOUNT, SPORT AND SEASON. A champion and the final's series
 * length — the two things this screen lets you pick. It is NOT a pool entry:
 * pool picks live in PlayoffBracketEntry / PlayoffBracketPick, keyed by entry
 * and series, and nothing here is scored against anyone.
 *
 * ⚠ NO LOCK. The screen has no lock time to honour — the shell carries no
 * first-game date and `seedsPending` is always true — so neither does the route.
 * When a seeding/schedule source lands, lock in the ROUTE (refuse the PUT) and
 * say so on the screen, in the same change.
 */

/** The season the screen titles itself with ("MLB 2026") and saves picks under. */
export const BRACKET_SEASON_YEAR = 2026

export type SavedBracketPick = {
  championTeamId: string | null
  finalLength: number | null
  /** ISO timestamp of the last save. */
  updatedAt: string
}

/**
 * What GET and PUT answer.
 *
 * `unavailable` is the state before the `core_bracket_picks` migration is
 * applied (Prisma P2021 / P2022): the screen keeps its preview behaviour and
 * says picks are not saved — which is then simply true.
 */
export type BracketPicksResponse =
  | { status: 'ok'; sport: SportKey; seasonYear: number; pick: SavedBracketPick | null }
  | { status: 'unavailable' }

export type BracketPickInput = {
  sport: SportKey
  championTeamId: string | null
  finalLength: number | null
}

/** A sport whose bracket is built (`available`) — the only ones whose picks are saved. */
export function isSavableSport(raw: unknown): raw is SportKey {
  return (
    typeof raw === 'string' &&
    (SPORT_ORDER as string[]).includes(raw) &&
    SPORT_SHELLS[raw as SportKey].available
  )
}

/** Longest team id accepted — SportsTeam ids are uuids; this only bounds garbage. */
const MAX_TEAM_ID = 128

/**
 * Shape-check a PUT body. Team MEMBERSHIP (is this club in the bracket?) needs
 * the database and is checked by the route against `getBracketPool`.
 */
export function parseBracketPickInput(
  body: unknown,
): { ok: true; value: BracketPickInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Send a JSON object: { sport, championTeamId, finalLength }.' }
  }
  const { sport, championTeamId, finalLength } = body as Record<string, unknown>

  if (!isSavableSport(sport)) {
    return { ok: false, error: 'That sport has no bracket to save picks for.' }
  }

  let champion: string | null = null
  if (championTeamId !== null && championTeamId !== undefined) {
    if (typeof championTeamId !== 'string' || !championTeamId.trim() || championTeamId.length > MAX_TEAM_ID) {
      return { ok: false, error: 'championTeamId must be a team id or null.' }
    }
    champion = championTeamId.trim()
  }

  const options = SPORT_SHELLS[sport].finalLength?.options ?? null
  let length: number | null = null
  if (finalLength !== null && finalLength !== undefined) {
    if (!options) {
      return { ok: false, error: 'This final is a single game — there is no series length to pick.' }
    }
    if (typeof finalLength !== 'number' || !Number.isInteger(finalLength) || !options.includes(finalLength)) {
      return { ok: false, error: `finalLength must be one of ${options.join(', ')}, or null.` }
    }
    length = finalLength
  }

  return { ok: true, value: { sport, championTeamId: champion, finalLength: length } }
}
