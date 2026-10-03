import { prisma } from '@/lib/prisma'
import { CLASS_MODEL_VERSION, DIVISION_COUNT } from '@/lib/class-rating/engine'
import { type ManagerClass } from '@/lib/class-rating/reads'
import { CLASS_SPORT, classTablesReady } from '@/lib/class-rating/store'

/**
 * The division gate — matchmaking by weight class (ADR F2.10a rule 6, owner rulings 2026-10-01).
 *
 *   • Gate on DIVISION ±1, never on Class: 25 Classes are too fine to place anyone in (the
 *     back-test put the same person within ±2 Classes only 30% of the time).
 *   • An unrated or provisional player is never gated — only flagged.
 *   • Someone already in the league handing you the way in — a commissioner invite, a private
 *     league's code, an approved request — is allowed outside the band and FLAGGED, never blocked.
 *   • Only an OPEN join, self-service into a public or listed league, is refused outside the band.
 *
 * ⚠ XP LEVEL IS NOT AN INPUT, ANYWHERE IN HERE. Career XP measures volume (rank correlation with
 * skill 0.15); gating on it is what the ruling retired.
 */

export const DIVISION_BAND = 1

/**
 * How the player is arriving.
 *   'open'    — self-service into a league anyone can find (public, public dashboard, or listed).
 *   'invited' — someone in the league handed them the way in, or a commissioner approved them.
 */
export type JoinPath = 'open' | 'invited'

export type DivisionGateDecision =
  | { outcome: 'allow'; reason: 'in_band' | 'league_unrated'; userDivision: number | null; leagueDivision: number | null }
  | {
      outcome: 'allow_flagged'
      reason: 'unrated_player' | 'provisional_player' | 'invited_outside_band'
      userDivision: number | null
      leagueDivision: number
    }
  | { outcome: 'deny'; reason: 'outside_division_band'; userDivision: number; leagueDivision: number; band: [number, number] }

export function divisionBand(leagueDivision: number): [number, number] {
  return [Math.max(1, leagueDivision - DIVISION_BAND), Math.min(DIVISION_COUNT, leagueDivision + DIVISION_BAND)]
}

/** The decision, from facts already read. Pure. */
export function decideDivisionGate(input: { user: ManagerClass; leagueDivision: number | null; path: JoinPath }): DivisionGateDecision {
  const { user, leagueDivision, path } = input
  const userDivision = user.status === 'established' ? user.division : null
  if (leagueDivision == null) return { outcome: 'allow', reason: 'league_unrated', userDivision, leagueDivision: null }
  if (user.status === 'unrated') return { outcome: 'allow_flagged', reason: 'unrated_player', userDivision: null, leagueDivision }
  if (user.status === 'provisional') return { outcome: 'allow_flagged', reason: 'provisional_player', userDivision: null, leagueDivision }
  const [lo, hi] = divisionBand(leagueDivision)
  if (user.division >= lo && user.division <= hi) return { outcome: 'allow', reason: 'in_band', userDivision: user.division, leagueDivision }
  if (path === 'invited') return { outcome: 'allow_flagged', reason: 'invited_outside_band', userDivision: user.division, leagueDivision }
  return { outcome: 'deny', reason: 'outside_division_band', userDivision: user.division, leagueDivision, band: [lo, hi] }
}

/** What the player is told when an open join is refused. */
export function divisionGateMessage(d: Extract<DivisionGateDecision, { outcome: 'deny' }>): string {
  const [lo, hi] = d.band
  const range = lo === hi ? `Division ${lo}` : `Divisions ${lo}–${hi}`
  return `This league plays in Division ${d.leagueDivision}, so open joins are for ${range}. You're in Division ${d.userDivision}. Ask the commissioner for an invite — invited players can join from any division.`
}

/* ─────────────────────────── a league's division ─────────────────────────── */

/**
 * The lower median of a list of divisions — deterministic for an even count, and a single
 * member (a brand-new league's creator) defines the league on their own.
 */
export function medianDivision(divisions: number[]): number | null {
  if (divisions.length === 0) return null
  const s = [...divisions].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) / 2)]
}

type MemberRow = { leagueId: string; person: string; division: number | null; established: boolean; games: number }

/**
 * Each league's division: the median division of its CURRENT members whose rating is established.
 * A league with none is unrated (null) and gates nobody.
 *
 * A member is matched by their AF account (`LeagueTeam.claimedByUserId`, or `Roster.platformUserId`
 * in a native league, where it IS the account id) or, for an imported league's unclaimed seats, by
 * their platform identity — so a Sleeper league is placed by the whole table, not only the one
 * AllFantasy user in it. One person counts once: their best rating, established first, most games.
 */
export async function getLeagueDivisions(leagueIds: string[]): Promise<Map<string, number | null>> {
  const ids = [...new Set(leagueIds.filter(Boolean))]
  const out = new Map<string, number | null>(ids.map((id) => [id, null]))
  if (ids.length === 0) return out
  try {
    if (!(await classTablesReady())) return out
    const rows = await prisma.$queryRaw<MemberRow[]>`
      WITH members AS (
        SELECT lt."leagueId", lt."claimedByUserId" AS user_id,
               CASE WHEN lt."platformUserId" IS NOT NULL THEN lower(l.platform) || ':' || lt."platformUserId" END AS subject_key
          FROM league_teams lt
          JOIN leagues l ON l.id = lt."leagueId"
         WHERE lt."leagueId" = ANY(${ids}::text[]) AND lt."lifecycleState" <> 'ARCHIVED'
           -- Class is an NFL rating (ADR F2.10a): any other sport's league is unrated and gates nobody.
           AND l.sport::text = ${CLASS_SPORT}
        UNION
        -- A native league's roster key IS the AF account id; an imported league's is the platform id.
        -- Both are offered: an AF cuid never equals a platform id, so the wrong one simply matches nothing.
        SELECT r."leagueId", r."platformUserId" AS user_id, lower(l.platform) || ':' || r."platformUserId" AS subject_key
          FROM rosters r
          JOIN leagues l ON l.id = r."leagueId"
         WHERE r."leagueId" = ANY(${ids}::text[]) AND l.sport::text = ${CLASS_SPORT}
      ),
      matched AS (
        SELECT DISTINCT ON (m."leagueId", coalesce(mr."userId", mr."subjectKey"))
               m."leagueId", coalesce(mr."userId", mr."subjectKey") AS person,
               mr.division, mr.established, mr.games
          FROM members m
          JOIN manager_ratings mr
            ON mr.sport = ${CLASS_SPORT} AND mr."modelVersion" = ${CLASS_MODEL_VERSION}
           AND (mr."userId" = m.user_id OR mr."subjectKey" = m.subject_key)
         ORDER BY m."leagueId", coalesce(mr."userId", mr."subjectKey"), mr.established DESC, mr.games DESC, mr."subjectKey"
      )
      SELECT "leagueId", person, division, established, games FROM matched`
    const byLeague = new Map<string, number[]>()
    for (const r of rows) {
      if (!r.established || r.division == null) continue
      const list = byLeague.get(r.leagueId) ?? []
      list.push(Number(r.division))
      byLeague.set(r.leagueId, list)
    }
    for (const id of ids) out.set(id, medianDivision(byLeague.get(id) ?? []))
  } catch (e) {
    // Fail OPEN: a gate that cannot read its inputs must not lock people out of leagues.
    console.warn('[class-rating] league division read failed:', e instanceof Error ? e.message : e)
  }
  return out
}

export async function getLeagueDivision(leagueId: string): Promise<number | null> {
  return (await getLeagueDivisions([leagueId])).get(leagueId) ?? null
}
