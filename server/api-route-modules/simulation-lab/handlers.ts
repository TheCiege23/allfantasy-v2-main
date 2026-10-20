/**
 * Simulation Lab — sandbox season, playoff and dynasty simulations (no league required).
 *
 * Backs `/app/simulation-lab`. The three `app/api/simulation-lab/{season,playoffs,dynasty}/route.ts`
 * files are thin re-exports of the handlers below.
 *
 * History: the original routes were moved out of `app/` into `.next-build-disabled-routes/` by
 * 90542801c (Vercel route budget) and deleted by eb38627ca, while the page kept calling them. They
 * were restored here with what the originals lacked: a signed-in session, bounded input (team counts,
 * finite numbers), and a per-user rate limit, because every request is synchronous Monte Carlo work
 * on the web process.
 *
 * Pure computation: no AI calls, no sports-data provider calls, no database reads or writes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import {
  runSeasonSimulation,
  runPlayoffSimulation,
  runDynastySimulation,
} from '@/lib/simulation-lab'
import type { TeamProjectionInput } from '@/lib/simulation-lab'

/** Largest league the lab accepts. Dynasty work grows with teams², so this bounds CPU per request. */
export const SIM_LAB_MAX_TEAMS = 32
/** Bracket size cap for the playoff simulator. */
export const SIM_LAB_MAX_PLAYOFF_TEAMS = 64
const MAX_ABS_SCORE = 10_000
const MAX_NAME_LENGTH = 60
const MAX_SPORT_LENGTH = 16

export const SIM_LAB_RATE_LIMIT = { maxRequests: 20, windowMs: 60_000 }

type Mode = 'season' | 'playoffs' | 'dynasty'

type JsonObject = Record<string, unknown>

class SimLabInputError extends Error {}

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function isObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Optional numeric field: absent → undefined; present but not a finite number → input error. */
function optionalNumber(body: JsonObject, key: string): number | undefined {
  const v = body[key]
  if (v === undefined || v === null) return undefined
  if (!isFiniteNumber(v)) throw new SimLabInputError(`${key} must be a number`)
  return v
}

function optionalSport(body: JsonObject): string | undefined {
  const v = body.sport
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_SPORT_LENGTH) {
    throw new SimLabInputError('sport must be a short string')
  }
  return v
}

/**
 * Copy only the fields the engine reads, rejecting anything that would make the simulation
 * meaningless (NaN/Infinity means, negative spread) or bloat the response (huge names).
 */
function parseTeam(raw: unknown, label: string): TeamProjectionInput {
  if (!isObject(raw)) throw new SimLabInputError(`${label} must be an object with a numeric mean`)
  const { mean, stdDev, name, teamId } = raw
  if (!isFiniteNumber(mean) || Math.abs(mean) > MAX_ABS_SCORE) {
    throw new SimLabInputError(`${label}.mean must be a finite number`)
  }
  const team: TeamProjectionInput = { mean }
  if (stdDev !== undefined && stdDev !== null) {
    if (!isFiniteNumber(stdDev) || stdDev < 0 || stdDev > MAX_ABS_SCORE) {
      throw new SimLabInputError(`${label}.stdDev must be a non-negative number`)
    }
    team.stdDev = stdDev
  }
  if (name !== undefined && name !== null) {
    if (typeof name !== 'string' || name.length > MAX_NAME_LENGTH) {
      throw new SimLabInputError(`${label}.name must be a string of at most ${MAX_NAME_LENGTH} characters`)
    }
    team.name = name
  }
  if (teamId !== undefined && teamId !== null) {
    if (typeof teamId !== 'string' || teamId.length > MAX_NAME_LENGTH) {
      throw new SimLabInputError(`${label}.teamId must be a string of at most ${MAX_NAME_LENGTH} characters`)
    }
    team.teamId = teamId
  }
  return team
}

function parseTeams(raw: unknown[], label: string): TeamProjectionInput[] {
  return raw.map((t, i) => parseTeam(t, `${label}[${i}]`))
}

async function readBody(req: Request): Promise<JsonObject> {
  const parsed: unknown = await req.json().catch(() => ({}))
  return isObject(parsed) ? parsed : {}
}

/** Session first, then the per-user limit. Returns a response to send, or the user id. */
async function gate(req: Request, mode: Mode): Promise<NextResponse | string> {
  const auth = await requireAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: 'Sign in to run simulations.' }, { status: 401 })
  }
  const rl = consumeRateLimit({
    scope: 'simulation_lab',
    action: mode,
    sleeperUsername: auth.userId,
    ip: getClientIp(req),
    maxRequests: SIM_LAB_RATE_LIMIT.maxRequests,
    windowMs: SIM_LAB_RATE_LIMIT.windowMs,
  })
  if (!rl.success) {
    return NextResponse.json(
      {
        error: 'Too many simulations. Please wait a moment and try again.',
        retryAfterSec: rl.retryAfterSec,
      },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    )
  }
  return auth.userId
}

function failure(mode: Mode, e: unknown, fallback: string) {
  if (e instanceof SimLabInputError) return bad(e.message)
  console.error(`[simulation-lab/${mode}]`, e instanceof Error ? e.message : e)
  return NextResponse.json({ error: fallback }, { status: 500 })
}

export async function seasonPOST(req: NextRequest | Request) {
  const gated = await gate(req, 'season')
  if (typeof gated !== 'string') return gated
  try {
    const body = await readBody(req)
    if (!body.team || !Array.isArray(body.opponents)) {
      return bad('team and opponents (array) required')
    }
    if (body.opponents.length < 1 || body.opponents.length > SIM_LAB_MAX_TEAMS - 1) {
      return bad(`opponents must have between 1 and ${SIM_LAB_MAX_TEAMS - 1} entries`)
    }
    const team = parseTeam(body.team, 'team')
    const opponents = parseTeams(body.opponents, 'opponents')
    const teamCount = opponents.length + 1
    const playoffSpots = body.playoffSpots
    if (
      !isFiniteNumber(playoffSpots) ||
      !Number.isInteger(playoffSpots) ||
      playoffSpots < 1 ||
      playoffSpots > teamCount
    ) {
      return bad('playoffSpots must be a number between 1 and number of teams')
    }
    const byeSpots = optionalNumber(body, 'byeSpots') ?? 0
    if (!Number.isInteger(byeSpots) || byeSpots < 0 || byeSpots > playoffSpots) {
      return bad('byeSpots must be a whole number between 0 and playoffSpots')
    }
    const result = runSeasonSimulation({
      sport: optionalSport(body),
      team,
      opponents,
      playoffSpots,
      byeSpots,
      iterations: optionalNumber(body, 'iterations'),
    })
    return NextResponse.json(result)
  } catch (e) {
    return failure('season', e, 'Season simulation failed')
  }
}

export async function playoffsPOST(req: NextRequest | Request) {
  const gated = await gate(req, 'playoffs')
  if (typeof gated !== 'string') return gated
  try {
    const body = await readBody(req)
    if (!Array.isArray(body.teams) || body.teams.length < 2) {
      return bad('teams (array of at least 2) required')
    }
    if (body.teams.length > SIM_LAB_MAX_PLAYOFF_TEAMS) {
      return bad(`teams must have at most ${SIM_LAB_MAX_PLAYOFF_TEAMS} entries`)
    }
    const teams = parseTeams(body.teams, 'teams')
    const target = optionalNumber(body, 'targetTeamIndex') ?? 0
    if (!Number.isInteger(target) || target < 0 || target >= teams.length) {
      return bad('targetTeamIndex must be valid index into teams')
    }
    const result = runPlayoffSimulation({
      sport: optionalSport(body),
      teams,
      targetTeamIndex: target,
      iterations: optionalNumber(body, 'iterations'),
    })
    return NextResponse.json(result)
  } catch (e) {
    return failure('playoffs', e, 'Playoff simulation failed')
  }
}

export async function dynastyPOST(req: NextRequest | Request) {
  const gated = await gate(req, 'dynasty')
  if (typeof gated !== 'string') return gated
  try {
    const body = await readBody(req)
    if (!Array.isArray(body.teams) || body.teams.length < 2) {
      return bad('teams (array of at least 2) required')
    }
    if (body.teams.length > SIM_LAB_MAX_TEAMS) {
      return bad(`teams must have at most ${SIM_LAB_MAX_TEAMS} entries`)
    }
    const teams = parseTeams(body.teams, 'teams')
    const requestedSpots = optionalNumber(body, 'playoffSpots')
    const playoffSpots =
      requestedSpots !== undefined
        ? Math.min(Math.max(1, Math.floor(requestedSpots)), teams.length)
        : Math.max(1, Math.floor(teams.length / 2))
    const result = runDynastySimulation({
      sport: optionalSport(body),
      teams,
      // The engine clamps seasons to 1..200 and iterationsPerSeason to 1..500.
      seasons: optionalNumber(body, 'seasons') ?? 50,
      playoffSpots,
      iterationsPerSeason: optionalNumber(body, 'iterationsPerSeason'),
    })
    return NextResponse.json(result)
  } catch (e) {
    return failure('dynasty', e, 'Dynasty simulation failed')
  }
}
