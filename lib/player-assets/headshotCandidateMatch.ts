/**
 * Picks which provider search result a headshot belongs to — or refuses to pick.
 *
 * Both name-search headshot providers (`thesportsdb`, `api-sports`) used to end their match with
 * `?? rows[0]`: when nothing matched the name, the FIRST search result's photo was returned
 * anyway, and the resolver persisted it as that player's headshot. TheSportsDB's search is not
 * scoped to a sport either. Measured in production 2026-10-01: 163 NBA/MLB/NHL/NCAAB/soccer
 * players carried an `api-sports.io/american-football` photo — a different person from a
 * different sport — and ~90 more URLs were shared by players with different names.
 *
 * The rule here is deliberately conservative, because a missing headshot renders the UI's
 * initials fallback and a wrong one shows a stranger's face:
 *   1. the candidate's name must match the searched name (punctuation, case and Jr/Sr/II-style
 *      suffixes ignored);
 *   2. team only BREAKS TIES between same-named candidates — a lone name match is accepted
 *      even when its team differs, since provider rosters lag trades;
 *   3. two or more same-named candidates that team cannot separate → no pick.
 *
 * Sport scoping is the caller's job, because only the caller knows its provider's sport field.
 */

import { getTeamInfo, normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { buildNameIndex, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'
import { positionGroupsAgree } from '@/lib/player-match/authoritativePlayerRow'

/**
 * Strip punctuation, lowercase, remove suffixes (Jr/Sr/II/III/IV/V),
 * collapse whitespace. Used for safe name comparisons across providers.
 */
export function normalizePlayerName(name: string | null | undefined): string {
  if (!name) return ''
  let s = String(name).trim().toLowerCase()
  // Strip apostrophes, hyphens, periods entirely.
  s = s.replace(/['‘’`.,]/g, '')
  s = s.replace(/-/g, ' ')
  // Drop common suffixes after the last space.
  s = s.replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '')
  // Collapse repeated whitespace, trim.
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

/**
 * `normalizePlayerName` with spaces removed. The resolver searches several spellings of one
 * name ("Ja'Marr Chase", "Ja Marr Chase", "jamarr chase"); this makes every one of them
 * compare equal to the provider's "Ja'Marr Chase" without loosening the match any further.
 */
export function compactPlayerName(name: string | null | undefined): string {
  return normalizePlayerName(name).replace(/\s+/g, '')
}

export function pickHeadshotCandidate<T>(
  rows: readonly T[],
  opts: {
    search: string
    nameOf: (row: T) => string | null | undefined
    teamCodeOf: (row: T) => string | null | undefined
    teamCode?: string | null
  },
): T | null {
  const wanted = compactPlayerName(opts.search)
  if (!wanted) return null

  const named = rows.filter((row) => compactPlayerName(opts.nameOf(row)) === wanted)
  if (named.length === 0) return null

  const teamCode = (opts.teamCode ?? '').trim().toUpperCase()
  if (teamCode) {
    const sameTeam = named.filter(
      (row) => (opts.teamCodeOf(row) ?? '').trim().toUpperCase() === teamCode,
    )
    if (sameTeam.length === 1) return sameTeam[0]!
    if (sameTeam.length > 1) return null
  }

  return named.length === 1 ? named[0]! : null
}

/*
 * ── Team / position agreement for headshot binding ─────────────────────────────────────────
 *
 * A headshot is bound to a PERSON, so the question is never "does anything about this row
 * match" but "does anything about this row CONTRADICT the player we are drawing". The resolver
 * used to accept a row when team OR position matched and then fell back to `rows[0]`; measured in
 * production 2026-10-11 that put CB Chris Jones's photo (Sleeper 5815) on DL Chris Jones (KC),
 * a QB's photo on LB Cole McDonald (KC) and an LB's on S Tre Thomas.
 *
 * Every comparison below is three-valued. `unknown` means one side did not say, or the two sides
 * speak different vocabularies we cannot reconcile — it is NOT agreement and NOT contradiction.
 */
export type HeadshotFieldRelation = 'same' | 'different' | 'unknown'

/** Football position families. EDGE and OLB straddle the line, so they belong to both. */
const FOOTBALL_POSITION_FAMILIES: Record<string, readonly string[]> = {
  QB: ['QB'], QUARTERBACK: ['QB'],
  RB: ['RB'], HB: ['RB'], FB: ['RB'], 'RUNNING BACK': ['RB'], HALFBACK: ['RB'], FULLBACK: ['RB'],
  WR: ['WR'], 'WIDE RECEIVER': ['WR'], RECEIVER: ['WR'],
  TE: ['TE'], 'TIGHT END': ['TE'],
  OL: ['OL'], OT: ['OL'], OG: ['OL'], IOL: ['OL'], C: ['OL'], G: ['OL'], T: ['OL'],
  'OFFENSIVE LINEMAN': ['OL'], 'OFFENSIVE TACKLE': ['OL'], 'OFFENSIVE GUARD': ['OL'], CENTER: ['OL'], GUARD: ['OL'],
  DL: ['DL'], DE: ['DL'], DT: ['DL'], NT: ['DL'],
  'DEFENSIVE LINEMAN': ['DL'], 'DEFENSIVE END': ['DL'], 'DEFENSIVE TACKLE': ['DL'], 'NOSE TACKLE': ['DL'],
  EDGE: ['DL', 'LB'], 'EDGE RUSHER': ['DL', 'LB'], OLB: ['LB', 'DL'], 'OUTSIDE LINEBACKER': ['LB', 'DL'],
  LB: ['LB'], ILB: ['LB'], MLB: ['LB'], LINEBACKER: ['LB'], 'INSIDE LINEBACKER': ['LB'], 'MIDDLE LINEBACKER': ['LB'],
  DB: ['DB'], CB: ['DB'], S: ['DB'], SS: ['DB'], FS: ['DB'], SAF: ['DB'],
  'DEFENSIVE BACK': ['DB'], CORNERBACK: ['DB'], SAFETY: ['DB'], 'FREE SAFETY': ['DB'], 'STRONG SAFETY': ['DB'],
  K: ['K'], PK: ['K'], KICKER: ['K'], PLACEKICKER: ['K'],
  P: ['P'], PUNTER: ['P'],
  LS: ['LS'], 'LONG SNAPPER': ['LS'],
}

const FOOTBALL_SPORTS = new Set(['NFL', 'NCAAF'])

function upperToken(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
}

/**
 * Do two position labels describe the same kind of player? Football labels fold into families
 * (so DT agrees with DL, CB with S, and "Quarterback" with QB). For any other sport only an exact
 * label match is evidence; two different labels are `unknown`, since feeds disagree on vocabulary
 * ("G" vs "PG") far more often than namesakes collide.
 */
export function headshotPositionRelation(
  sport: string | null | undefined,
  a: string | null | undefined,
  b: string | null | undefined,
): HeadshotFieldRelation {
  const pa = upperToken(a)
  const pb = upperToken(b)
  if (!pa || !pb) return 'unknown'
  if (pa === pb) return 'same'
  if (!FOOTBALL_SPORTS.has(upperToken(sport))) return 'unknown'
  const fa = FOOTBALL_POSITION_FAMILIES[pa]
  const fb = FOOTBALL_POSITION_FAMILIES[pb]
  if (!fa || !fb) return 'unknown'
  return fa.some((family) => fb.includes(family)) ? 'same' : 'different'
}

/**
 * Do two team labels name the same club? NFL labels go through `normalizeTeamAbbrev`, which knows
 * every code, full name, city and mascot — and a label it cannot place is a non-NFL team, so it
 * DIFFERS from an NFL club (an NCAAF namesake is somebody else). Other sports carry no shared
 * table: equal labels are `same`, and labels in the same form (both codes or both names) that
 * differ are `different`; a code against a full name is `unknown`.
 */
export function headshotTeamRelation(
  sport: string | null | undefined,
  a: string | null | undefined,
  b: string | null | undefined,
): HeadshotFieldRelation {
  const ta = upperToken(a)
  const tb = upperToken(b)
  if (!ta || !tb) return 'unknown'
  if (ta === tb) return 'same'
  if (upperToken(sport) === 'NFL') {
    const ca = normalizeTeamAbbrev(ta)
    const cb = normalizeTeamAbbrev(tb)
    const na = Boolean(ca && getTeamInfo(ca))
    const nb = Boolean(cb && getTeamInfo(cb))
    if (na && nb) return ca === cb ? 'same' : 'different'
    if (na || nb) return 'different'
    return 'unknown'
  }
  const shortA = ta.length <= 4
  const shortB = tb.length <= 4
  return shortA === shortB ? 'different' : 'unknown'
}

export interface HeadshotIdentityLookup {
  sport: string | null | undefined
  team?: string | null
  position?: string | null
}

/** True when either field is stated on both sides and disagrees. */
export function headshotContradicts(
  lookup: HeadshotIdentityLookup,
  candidate: { team?: string | null; position?: string | null },
): boolean {
  return (
    headshotTeamRelation(lookup.sport, lookup.team, candidate.team) === 'different' ||
    headshotPositionRelation(lookup.sport, lookup.position, candidate.position) === 'different'
  )
}

/**
 * Pick the headshot for a player out of local roster rows that share his name (the
 * `SportsPlayer` cache tier), or refuse.
 *
 *   1. Drop every row whose team or position CONTRADICTS the lookup.
 *   2. An image carried by a contradicting row belongs to that other person, so it is not
 *      evidence for ours even when an agreeing row also carries it. This is what catches the
 *      production rows above: a resolver write-back copied CB Chris Jones's photo onto the DL's
 *      own `SportsPlayer` row, so the DL row agreed on team and position and still held the
 *      wrong face.
 *   3. Require positive evidence: rows agreeing on TEAM when any do, otherwise rows agreeing on
 *      POSITION. Only a lookup with neither field falls back to every surviving row.
 *   4. Bind only when exactly one distinct image remains. Two images means two candidates we
 *      cannot tell apart, and no image beats a stranger's.
 */
/** One Sleeper player as the Sleeper headshot tier sees him. `id` is the Sleeper player id. */
export interface SleeperHeadshotCandidate {
  id: string
  name: string
  position?: string | null
  team?: string | null
}

/**
 * Which Sleeper player's thumbnail (`sleepercdn.com/…/thumb/<id>.jpg`) is this player's — or none.
 *
 * 🛑 A SLEEPER THUMBNAIL NAMES ITS OWNER, SO A NAME SEARCH THAT PICKS THE WRONG ID PUBLISHES A
 * STRANGER'S FACE UNDER A STAMP THE REST OF THE APP TRUSTS. The Sleeper tier used to take any
 * blob row whose name CONTAINED the search, skip the team check whenever the row had no team,
 * and never look at position. Measured in production 2026-10-13: S Mike Brown (TEN) was stamped
 * with Sleeper 1321 — a free-agent WR Mike Brown — because a free agent passes a team filter by
 * having no team; Sleeper also lists an OL and a DB of that name.
 *
 *   1. The subject's own Sleeper id, when known, is the answer and the only answer.
 *   2. Otherwise bind by name only through `resolveVerifiedMatch` (exact normalized name;
 *      ambiguity refuses), and then require BOTH an agreeing position group and the same stated
 *      NFL club. A free agent, a missing position or an unplaceable team cannot verify anyone.
 */
export function pickSleeperHeadshotPlayer<T extends SleeperHeadshotCandidate>(
  candidates: readonly T[],
  subject: { sleeperId?: string | null; name: string; position?: string | null; team?: string | null },
): T | null {
  const own = String(subject.sleeperId ?? '').trim()
  if (own) return candidates.find((c) => String(c.id).trim() === own) ?? null

  const wantTeam = normalizeTeamAbbrev(subject.team)
  if (!wantTeam || !getTeamInfo(wantTeam) || !String(subject.position ?? '').trim()) return null
  const index = buildNameIndex(candidates.map((c) => ({ ...c, team: normalizeTeamAbbrev(c.team) })))
  const { match } = resolveVerifiedMatch(index, { name: subject.name, position: subject.position, team: wantTeam })
  if (!match || match.team !== wantTeam || !positionGroupsAgree(match.position, subject.position)) return null
  return candidates.find((c) => c.id === match.id) ?? null
}

export function pickHeadshotFromRosterRows<T extends { imageUrl: string | null; team: string | null; position: string | null }>(
  rows: readonly T[],
  lookup: HeadshotIdentityLookup,
  isUsableUrl: (url: string | null | undefined) => boolean = (url) => Boolean(url && url.trim()),
): string | null {
  const foreign = new Set<string>()
  const agreeing: T[] = []
  for (const row of rows) {
    if (headshotContradicts(lookup, row)) {
      if (row.imageUrl) foreign.add(row.imageUrl.trim())
    } else {
      agreeing.push(row)
    }
  }
  const usable = agreeing.filter(
    (row) => isUsableUrl(row.imageUrl) && !foreign.has(String(row.imageUrl).trim()),
  )
  const byTeam = usable.filter((row) => headshotTeamRelation(lookup.sport, lookup.team, row.team) === 'same')
  const byPosition = usable.filter(
    (row) => headshotPositionRelation(lookup.sport, lookup.position, row.position) === 'same',
  )
  const lookupSaysNothing = !upperToken(lookup.team) && !upperToken(lookup.position)
  const tier = byTeam.length > 0 ? byTeam : byPosition.length > 0 ? byPosition : lookupSaysNothing ? usable : []
  const urls = [...new Set(tier.map((row) => String(row.imageUrl).trim()))]
  return urls.length === 1 ? urls[0]! : null
}
