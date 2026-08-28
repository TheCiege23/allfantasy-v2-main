/**
 * Decide whether a provider's athlete and a canonical player are the same person.
 *
 * ⚠ THIS EXISTS BECAUSE NAME MATCHING PUT A BASKETBALL GUARD ON AN NFL DRAFT BOARD.
 * `ingestEspnAthleteIdentities` deliberately writes `playerId: null` and defers to
 * "a matcher that can check a birthday and a position". This is that matcher, and
 * the first thing it owes anyone is an honest account of what the database holds.
 *
 * MEASURED 2026-08-27 against production:
 *   - `Player.birthDate` and `Player.birthYear` — 0 rows populated, every sport.
 *   - `PlayerIdentityMap.dob` — 0 rows populated.
 *   - The ONLY birthday in the database is `SportsPlayer.dob` where
 *     source = 'thesportsdb': 2,023 of 2,238 NFL rows.
 *
 * So the birthday rule below is real and enforced, but on today's data it almost
 * never fires. The signal actually doing the work is POSITION, with team as a
 * tiebreak. That is recorded here rather than left to be discovered, because a
 * matcher whose headline rule is inert is precisely the kind of thing that gets
 * trusted for more than it does.
 *
 * WHY A DISAGREEING POSITION ELIMINATES BUT A DISAGREEING TEAM DOES NOT:
 * players change teams. A draft board from 2023 references the roster of 2023 while
 * our tables hold the roster of now, so treating a team change as evidence of a
 * different person would reject the true match for everyone ever traded. Position is
 * stable across exactly the span where team is not.
 */

import {
  normalizePlayerName,
  normalizePosition,
  normalizeTeamAbbr,
  isFreeAgentTeam,
} from '@/lib/player-identity/playerIdentityResolution'

export type MatchSignal = 'name' | 'dob' | 'position' | 'team'

export type AthleteEvidence = {
  name: string | null | undefined
  sport?: string | null
  position?: string | null
  team?: string | null
  /** Any parseable date; only the calendar day is ever compared. */
  dob?: string | Date | null
}

export type CanonicalCandidate = AthleteEvidence & { id: string }

export type AthleteMatch =
  | { matched: true; id: string; confidence: number; matchedOn: MatchSignal[] }
  | { matched: false; reason: string; candidates: number }

/**
 * Below this, nothing may be written.
 *
 * 0.8 sits exactly where name-only lands underneath it, and that is the entire
 * point: a name and nothing else must never link, however unique that name looks
 * in whatever pool we happen to be holding today.
 */
export const MIN_LINK_CONFIDENCE = 0.8

/** Strings that name a lineup slot rather than a player, and corroborate nothing. */
const SLOT_LIKE = new Set(['FLEX', 'SUPERFLEX', 'SUPER_FLEX', 'SF', 'OP', 'BN', 'IR', 'TAXI'])

function usablePosition(value: string | null | undefined): string {
  const p = normalizePosition(value ?? '')
  if (!p) return ''
  const upper = p.toUpperCase()
  return SLOT_LIKE.has(upper) ? '' : upper
}

function usableTeam(value: string | null | undefined, sport?: string | null): string {
  if (isFreeAgentTeam(value, sport)) return ''
  return normalizeTeamAbbr(value, sport).toUpperCase()
}

/**
 * The calendar day, or '' when absent or unparseable.
 *
 * A bare YYYY-MM-DD is taken as written. Handing it to `new Date` applies a UTC
 * offset that can move it by a day, and the day is the whole comparison.
 */
export function birthDay(value: string | Date | null | undefined): string {
  if (!value) return ''
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10)
  }
  const raw = String(value).trim()
  if (!raw) return ''
  const plain = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (plain) return `${plain[1]}-${plain[2]}-${plain[3]}`
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

/** Unknown on either side is not a contradiction; a stated mismatch is. */
function sameSport(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = String(a ?? '')
    .trim()
    .toUpperCase()
  const y = String(b ?? '')
    .trim()
    .toUpperCase()
  if (!x || !y) return true
  return x === y
}

type Scored = { candidate: CanonicalCandidate; confidence: number; matchedOn: MatchSignal[] }

/**
 * Score one candidate, or reject it outright.
 *
 * null means ELIMINATED — a contradiction saying "not this person" — which is a
 * different thing from a low score, which only says "not much evidence either way".
 */
function score(evidence: AthleteEvidence, candidate: CanonicalCandidate): Scored | null {
  if (!sameSport(evidence.sport, candidate.sport)) return null

  const nameA = normalizePlayerName(evidence.name)
  const nameB = normalizePlayerName(candidate.name)
  if (!nameA || nameA !== nameB) return null

  const matchedOn: MatchSignal[] = ['name']

  const dobA = birthDay(evidence.dob)
  const dobB = birthDay(candidate.dob)
  if (dobA && dobB) {
    /* Two people sharing a name and not a birthday are two people. */
    if (dobA !== dobB) return null
    matchedOn.push('dob')
  }

  const posA = usablePosition(evidence.position)
  const posB = usablePosition(candidate.position)
  if (posA && posB) {
    if (posA !== posB) return null
    matchedOn.push('position')
  }

  const teamA = usableTeam(evidence.team, evidence.sport ?? candidate.sport)
  const teamB = usableTeam(candidate.team, candidate.sport ?? evidence.sport)
  if (teamA && teamB && teamA === teamB) matchedOn.push('team')

  const has = (s: MatchSignal) => matchedOn.includes(s)
  let confidence = 0.6 // name alone, deliberately under MIN_LINK_CONFIDENCE
  if (has('dob')) confidence = has('position') ? 0.99 : 0.95
  else if (has('position')) confidence = has('team') ? 0.9 : 0.8

  return { candidate, confidence, matchedOn }
}

/**
 * Resolve one provider athlete against a pool of canonical candidates.
 *
 * The caller supplies the pool, already narrowed to the right sport. Ambiguity is
 * REFUSED rather than broken by order: when two survivors tie at the top there is
 * no way to choose that is not a guess, and a guess here is a wrong player on
 * somebody's draft board.
 */
export function matchProviderAthlete(
  evidence: AthleteEvidence,
  candidates: CanonicalCandidate[],
): AthleteMatch {
  if (!normalizePlayerName(evidence.name)) {
    return { matched: false, reason: 'the provider gave no usable name', candidates: 0 }
  }

  const scored = candidates.map((c) => score(evidence, c)).filter((s): s is Scored => s !== null)

  if (scored.length === 0) {
    return {
      matched: false,
      reason: 'no candidate agreed on name, or every one contradicted on birthday or position',
      candidates: candidates.length,
    }
  }

  scored.sort((a, b) => b.confidence - a.confidence)
  const best = scored[0]!
  const tied = scored.filter((s) => s.confidence === best.confidence)
  if (tied.length > 1) {
    return {
      matched: false,
      reason: `${tied.length} candidates matched equally well and nothing separates them`,
      candidates: candidates.length,
    }
  }

  if (best.confidence < MIN_LINK_CONFIDENCE) {
    return {
      matched: false,
      reason:
        'only the name agreed, and a name on its own is not evidence of identity — a position or a birthday is needed',
      candidates: candidates.length,
    }
  }

  return {
    matched: true,
    id: best.candidate.id,
    confidence: best.confidence,
    matchedOn: best.matchedOn,
  }
}
