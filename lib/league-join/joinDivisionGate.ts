import { prisma } from '@/lib/prisma'
import {
  decideDivisionGate,
  getLeagueDivision,
  type DivisionGateDecision,
  type JoinPath,
} from '@/lib/class-rating/divisionGate'
import { getManagerClass } from '@/lib/class-rating/reads'
import { isFantasyLeagueDiscoverable } from '@/lib/public-discovery/DiscoveryQueryLayer'

/**
 * The division gate at the three SELF-SERVICE seat paths (census 2026-10-01):
 *
 *   POST /api/leagues/join          — the league's join code
 *   POST /api/invite/accept         — its fallback branch, the same join code
 *   POST /api/league/invite/claim   — a `LeagueInvite.token`, which for canonical and
 *                                     commissioner-minted leagues IS the public join code
 *
 * Every other path that seats a person is a commissioner or system action (manager assignment,
 * duplicate-flag approval, orphan adoption, carry-over, tournaments), and a commissioner's choice
 * is never blocked — the out-of-band member is derivable at any time from member divisions, so
 * nothing extra is written for them.
 *
 * ⚠ WHETHER A JOIN IS "OPEN" IS A PROPERTY OF THE LEAGUE, NOT OF THE CODE. A league has one join
 * code. A private league's code reached the player because someone in the league handed it to
 * them — an invitation. A public, listed or orphan-seeking league publishes the same code to
 * anyone (discovery cards, /api/discover/orphans), so holding it proves nothing.
 */

export type JoinCredential =
  /** The league's own join code (`settings.inviteCode`). */
  | { kind: 'league_code' }
  /** A `LeagueInvite.token` presented to the claim route. */
  | { kind: 'invite_token'; token: string }

function readSettings(settings: unknown): Record<string, unknown> {
  return settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
}

/** Does this league hand its join code to anyone who looks? */
export function isOpenLeague(settings: unknown): boolean {
  const s = readSettings(settings)
  return isFantasyLeagueDiscoverable(s) || s.orphanSeeking === true
}

/** Which path a credential represents for this league. Pure. */
export function joinPathFor(settings: unknown, credential: JoinCredential): JoinPath {
  if (!isOpenLeague(settings)) return 'invited'
  if (credential.kind === 'league_code') return 'open'
  // A token is a personal invitation unless it is the very code the league publishes.
  const published = readSettings(settings).inviteCode
  return typeof published === 'string' && published.trim().toLowerCase() === credential.token.trim().toLowerCase()
    ? 'open'
    : 'invited'
}

/**
 * The gate decision for a user arriving at a league with a credential.
 *
 * Fails OPEN on every read: an unreadable Class reads as unrated (flagged), an unreadable league
 * division as unrated (allowed). A matchmaking gate that cannot see must not lock people out.
 */
export async function evaluateJoinDivisionGate(args: {
  userId: string
  leagueId: string
  credential: JoinCredential
}): Promise<DivisionGateDecision> {
  let decision: DivisionGateDecision
  let path: JoinPath = 'invited'
  try {
    const league = await prisma.league.findUnique({ where: { id: args.leagueId }, select: { settings: true } })
    path = joinPathFor(league?.settings, args.credential)
    const [user, leagueDivision] = await Promise.all([getManagerClass(args.userId), getLeagueDivision(args.leagueId)])
    decision = decideDivisionGate({ user, leagueDivision, path })
  } catch (e) {
    // Includes a synchronous throw (an undefined delegate), which a `.catch` chained on the call
    // would never see. Unreadable is unrated: allow.
    console.warn('[division-gate] could not evaluate; allowing:', e instanceof Error ? e.message : e)
    return { outcome: 'allow', reason: 'league_unrated', userDivision: null, leagueDivision: null }
  }
  if (decision.outcome !== 'allow') {
    // One structured line per non-plain decision, so a flagged or refused join is countable.
    console.info('[division-gate]', JSON.stringify({ leagueId: args.leagueId, path, ...decision }))
  }
  return decision
}
