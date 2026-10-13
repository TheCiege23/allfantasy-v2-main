/**
 * Rolling Insights play-by-play → LiveEvent.
 *
 * Real plays, replacing the inference the box-score detector has to do. That
 * detector says so itself: "Real play-by-play would close that last gap." This
 * is that gap closed — a 25-yard run behind an earlier 40-yarder is a play here,
 * where `rushing_long` could never see it, and two touches in one poll interval
 * are two plays rather than a silence.
 *
 * ⚠ SHAPE IS FROM THE COMMITTED CONTRACT, NOT FROM PROBING.
 * contracts/rolling-insights/PLAY-BY-PLAY.yaml is normative and fully typed
 * (extracted from the vendor's OpenAPI 3.1.0 spec). Nothing here was learned by
 * calling the API. Every field below is one that contract declares required.
 *
 * ⚠ THE BOX-SCORE DETECTOR IS NOT REPLACED. It stays as the NCAAFB path — the
 * contract is explicit that college football has no play-by-play and the
 * box-diff limitation stands there. This is the NFL path only (PBP is MLB/NBA/
 * NFL, and unsupported for NHL/SOCCER/NCAAFB/NCAABB/PGA/DARTS).
 */

import type { LiveEvent, LiveEventType } from './eventDetector'
import { getTeamInfo } from '@/lib/team-abbrev'

/** Sports the vendor actually serves play-by-play for. */
export const PBP_SPORTS = ['MLB', 'NBA', 'NFL'] as const

/** The contract's `event` enum. `not_available` is a real value, not an error. */
type PlayEvent =
  | 'kickoff' | 'pass' | 'run' | 'sack' | 'interception' | 'incompletion'
  | 'fumble' | 'penalty' | 'field_goal' | 'punt' | 'safety' | 'not_available'

export type PbpPlayer = {
  id: number | null
  name: string
  role: string
  action: string
  position: string | null
  teamAbbr: string | null
}

export type PbpPlay = {
  sequence: number
  quarter: number
  gameClock: string
  event: PlayEvent
  yardsGained: number | null
  yardLine: string | null
  possession: string
  isTouchdown: boolean
  isScoringPlay: boolean
  isReturned: boolean
  isReversed: boolean
  description: string
  players: PbpPlayer[]
  pointsAfterType: string | null
  /** `details.pointsAfterTouchdown.successful`, or null when the vendor did not say. */
  pointsAfterSuccessful?: boolean | null
}

export type PbpGame = {
  gameId: string
  awayTeamName: string
  homeTeamName: string
  plays: PbpPlay[]
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null
const bool = (v: unknown): boolean => v === true

/**
 * ⚠ ENVELOPE IS `data.NFL[]`, AND A GAME CARRIES ITS OWN id. Parsing is total:
 * a row missing any of the contract's required keys is skipped rather than
 * half-built, because a play with no description or no possession cannot produce
 * a sentence a user would trust.
 */
export function parsePlayByPlay(payload: unknown, sport = 'NFL'): PbpGame[] {
  const root = (payload as { data?: Record<string, unknown> } | null)?.data
  const rows = root?.[sport]
  if (!Array.isArray(rows)) return []

  const games: PbpGame[] = []
  for (const raw of rows) {
    const g = raw as Record<string, unknown>
    const gameId = str(g.game_ID)
    const away = str(g.awayTeamName)
    const home = str(g.homeTeamName)
    const playRows = g.plays
    if (!gameId || !away || !home || !Array.isArray(playRows)) continue

    const plays: PbpPlay[] = []
    for (const pr of playRows) {
      const p = pr as Record<string, unknown>
      const sequence = num(p.sequence)
      const description = str(p.description)
      const possession = str(p.possession)
      if (sequence == null || !description || !possession) continue

      const details = (p.details ?? {}) as Record<string, unknown>
      const pat = (details.pointsAfterTouchdown ?? {}) as Record<string, unknown>

      const players: PbpPlayer[] = Array.isArray(p.players)
        ? (p.players as unknown[]).flatMap((xr) => {
            const x = xr as Record<string, unknown>
            const name = str(x.name)
            const role = str(x.role)
            const action = str(x.action)
            if (!name || !role || !action) return []
            return [{
              /* The contract says INTEGER; a numeric string is accepted too, because a null here
                 forces the `name:` fallback and costs every downstream join (GAPS.md N-18). */
              id: num(x.id) ?? (typeof x.id === 'string' && /^\d+$/.test(x.id.trim()) ? Number(x.id.trim()) : null),
              name,
              role,
              action,
              position: str(x.position),
              teamAbbr: str(x.teamAbbr),
            }]
          })
        : []

      plays.push({
        sequence,
        quarter: num(p.quarter) ?? 0,
        gameClock: str(p.gameClock) ?? '',
        event: (str(p.event) ?? 'not_available') as PlayEvent,
        /* `yardsGained` is the contract's designated field for 20+ detection and
           is duplicated at details.yardsGained; prefer the top-level one. */
        yardsGained: num(p.yardsGained) ?? num(details.yardsGained),
        // STRING and territory-prefixed ("BUF 25") — NOT the integer that
        // full_box.current.YardLine carries. Never compare the two.
        yardLine: str(p.yardLine),
        // FULL team name ("Buffalo Bills"), not the "BUF" that full_box uses.
        possession,
        isTouchdown: bool(p.isTouchdown),
        isScoringPlay: bool(p.isScoringPlay),
        isReturned: bool(p.isReturned),
        isReversed: bool(p.isReversed),
        description,
        players,
        pointsAfterType: str(pat.type),
        pointsAfterSuccessful: typeof pat.successful === 'boolean' ? pat.successful : null,
      })
    }

    games.push({ gameId, awayTeamName: away, homeTeamName: home, plays })
  }
  return games
}

/**
 * A team as one of the 32 canonical NFL codes, or null when it is not one we know. `possession` is a
 * FULL name ("Detroit Lions") and `teamAbbr` a code; both go through the same canonical table so they
 * can be compared. `ARZ` is the vendor-style Arizona code the shared alias table does not carry.
 */
function canonicalNflTeam(raw: string | null | undefined): string | null {
  const v = raw?.trim()
  if (!v) return null
  return getTeamInfo(v.toUpperCase() === 'ARZ' ? 'ARI' : v)?.canonical ?? null
}

/**
 * Did the team with the ball recover its own fumble? Then nothing changed hands.
 *
 * ⚠ `event: 'fumble'` WAS READ AS A TURNOVER WHOEVER RECOVERED. On prod 2026-10-11 "Tate Ratledge
 * recovered a fumble" and "Mike McGlinchey recovered a fumble" — both offensive linemen falling on
 * their own team's ball — were badged TURNOVER. A fumble is a turnover only when the DEFENCE recovers it.
 *
 * Three answers, not two: `true` own recovery, `false` the other side, `null` when either team cannot
 * be named — and the caller emits nothing for null, the same "no event rather than a guess" this module
 * already applies to the ambiguous `fumbler` role (GAPS.md N-06).
 */
export function recoveredByOffense(play: Pick<PbpPlay, 'possession' | 'players'>): boolean | null {
  const recoverer = play.players.find((x) => x.role === 'recoverer')
  if (!recoverer) return null
  const offense = canonicalNflTeam(play.possession)
  const recovering = canonicalNflTeam(recoverer.teamAbbr)
  if (!offense || !recovering) return null
  return offense === recovering
}

/**
 * 🛑 A TWO-POINT TRY RIDES ON THE TOUCHDOWN'S OWN ROW, AND ITS PLAYERS SHARE `players[]` WITH THE SCORE.
 *
 * Measured on prod 2026-10-12 (BUF @ LA, `20261012-1-8`, sequence 123): ONE play reads
 * "J.Allen up the middle for 1 yard, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. J.Allen pass to
 * D.Kincaid is complete. ATTEMPT SUCCEEDS." — `event: 'run'`, `isTouchdown: true`, and the try's
 * receiver in `players[]`. Picking the first rusher-or-receiver made Dalton Kincaid the scorer: ten
 * managers were pushed "Touchdown — Dalton Kincaid 1-yard receiving TD from Josh Allen", nine more
 * "Josh Allen 1-yard TD pass", and nobody was told about Allen's rushing TD or the 2-pt conversion.
 *
 * So the description is split at the gamebook's own marker: the text before it is the touchdown, the
 * text after it is the try, and each event only looks at the players its own text names. The contract
 * also declares `details.pointsAfterTouchdown`; its `successful` wins over the prose when present.
 */
const TWO_POINT_MARKER = /TWO-POINT CONVERSION ATTEMPT\.?/i
/** A try the DEFENCE took back — two points to a team defence, nothing to any player on this feed. */
const DEFENSIVE_TWO_POINT_MARKER = /DEFENSIVE TWO-POINT ATTEMPT/i

export type TwoPointTry = {
  /** The touchdown's own sentence — empty when the row is the try alone. */
  touchdownText: string
  /** The offence's try, cut before any defensive return. */
  tryText: string
  /** null when neither the details nor the prose say how it ended — never read as a score. */
  succeeded: boolean | null
  defensiveReturn: boolean
}

export function twoPointTryOf(play: Pick<PbpPlay, 'description' | 'pointsAfterType' | 'pointsAfterSuccessful'>): TwoPointTry | null {
  const declared = play.pointsAfterType === 'two_point_conversion'
  const declaredResult = declared ? play.pointsAfterSuccessful ?? null : null
  const marker = TWO_POINT_MARKER.exec(play.description)
  if (!marker) {
    // Declared but not written: the try's players cannot be told apart from the score's, so no try event.
    return declared ? { touchdownText: play.description, tryText: '', succeeded: declaredResult, defensiveReturn: false } : null
  }
  let tryText = play.description.slice(marker.index + marker[0].length)
  const defensive = DEFENSIVE_TWO_POINT_MARKER.exec(tryText)
  const defensiveText = defensive ? tryText.slice(defensive.index) : ''
  if (defensive) tryText = tryText.slice(0, defensive.index)
  const verdict = /ATTEMPT (SUCCEEDS|FAILS)/i.exec(tryText)
  return {
    touchdownText: play.description.slice(0, marker.index).trim(),
    tryText: tryText.trim(),
    succeeded: declaredResult ?? (verdict ? verdict[1]!.toUpperCase() === 'SUCCEEDS' : null),
    defensiveReturn: /ATTEMPT SUCCEEDS/i.test(defensiveText),
  }
}

const NAME_SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Does gamebook prose name this player? The prose writes "J.Allen" / "A.St. Brown" / "T.Bass" while
 * `players[]` carries "Josh Allen" (or the vendor's own short form, "A.St", "Bass").
 */
export function namedIn(text: string, name: string): boolean {
  const parts = name.trim().split(/\s+/).filter((part) => part && !NAME_SUFFIX.test(part))
  if (parts.length === 0 || !text) return false
  const body = /^\p{L}{1,2}\.\S/u.test(parts[0]!)
    ? parts.map(escapeRe).join('\\s*') // already the short form
    : parts.length === 1
      ? `(?:\\p{L}\\.\\s*)?${escapeRe(parts[0]!)}` // a bare surname, written after an initial
      : `${escapeRe(parts[0]![0]!)}\\.\\s*${parts.slice(1).map(escapeRe).join('\\s*')}`
  return new RegExp(`(?<![\\p{L}.])${body}(?!\\p{L})`, 'iu').test(text)
}

/** One person, whether or not the vendor sent ids — the try lists the same QB twice. */
function samePerson(a: PbpPlayer, b: PbpPlayer): boolean {
  if (a === b) return true
  if (a.id != null && b.id != null) return a.id === b.id
  return a.name === b.name
}

/**
 * ⚠ TOUCHDOWN IS NOT IN THE `event` ENUM, AND THIS IS THE BIGGEST TRAP IN THE
 * SCHEMA. The contract calls it out by name: there is no `scoringType` field and
 * no `touchdown` event, so a score has to be assembled from four signals.
 * Classifying on `event` alone silently drops every touchdown.
 */
function classify(play: PbpPlay): LiveEventType | null {
  if (play.isTouchdown) {
    // Unit attribution per the contract, cross-checked against player roles
    // rather than trusting `event` alone — a defensive score carries an
    // 'interceptor' or 'recoverer'.
    // An offence that falls on its own fumble in the end zone scored an offensive touchdown.
    const ownRecovery = play.event === 'fumble' && recoveredByOffense(play) === true
    const defensive =
      !ownRecovery &&
      (play.event === 'interception' ||
        play.event === 'fumble' ||
        play.event === 'safety' ||
        play.players.some((x) => x.role === 'interceptor' || x.role === 'recoverer'))
    if (defensive) return 'DEFENSIVE_SCORE'
    if (play.event === 'kickoff' || play.event === 'punt' || play.event === 'field_goal') {
      return 'SPECIAL_TEAMS_SCORE'
    }
    return 'TOUCHDOWN'
  }

  if (play.event === 'field_goal' && play.isScoringPlay) return 'FIELD_GOAL'
  if (play.event === 'safety') return 'DEFENSIVE_SCORE'
  if (play.event === 'interception') return 'TURNOVER'
  // Only a fumble the OTHER side recovered changed hands. Own or unknown is not a turnover; the play
  // can still be a big gain below.
  if (play.event === 'fumble' && recoveredByOffense(play) === false) return 'TURNOVER'
  // The contract's own threshold for a big play.
  if ((play.yardsGained ?? 0) >= 20) return 'BIG_PLAY'
  return null
}

/**
 * The player the event belongs to — the one a fantasy manager scores from.
 *
 * ⚠ `fumbler` IS DELIBERATELY NOT USED AS THE SUBJECT. The contract flags it as
 * ambiguous: it may name the player who fumbled OR the one who forced it, and
 * that is an open gap (N-06). Attributing a turnover to the wrong player is
 * worse than attributing it to none, so a fumble resolves through the recoverer
 * instead, and falls back to no event rather than guessing.
 */
function subjectOf(play: PbpPlay, type: LiveEventType): PbpPlayer | null {
  const by = (...roles: string[]) => play.players.find((x) => roles.includes(x.role)) ?? null
  switch (type) {
    case 'TOUCHDOWN':
      return by('rusher', 'receiver') ?? by('passer') ?? by('recoverer')
    case 'DEFENSIVE_SCORE':
      return by('interceptor', 'recoverer', 'defender')
    case 'SPECIAL_TEAMS_SCORE':
      return by('returner', 'kicker', 'punter')
    case 'FIELD_GOAL':
      return by('kicker')
    case 'TURNOVER':
      return by('interceptor', 'recoverer')
    case 'BIG_PLAY':
      return by('rusher', 'receiver') ?? by('passer')
    default:
      return null
  }
}

/**
 * Convert plays to the SAME LiveEvent shape the box-score detector emits, so
 * everything downstream — dedupe, notification selection, rendering — is shared
 * and neither source needs its own display path.
 *
 * ⚠ `sequence` IS A HIGH-WATER MARK, NOT A COUNT. The contract warns it is
 * monotonic but sparse (NFL samples jump 2, MLB 41, NBA 6), so callers must pass
 * the last sequence they saw and never assume 1..N or use it to count plays.
 */
export function playsToLiveEvents(
  game: PbpGame,
  opts: { sinceSequence?: number; now?: Date } = {},
): LiveEvent[] {
  const since = opts.sinceSequence ?? -1
  const now = opts.now ?? new Date()
  const out: LiveEvent[] = []

  for (const play of game.plays) {
    if (play.sequence <= since) continue
    /* A reversed play did not happen. Emitting it and correcting later is how a
       user gets told about a touchdown that was overturned on replay. */
    if (play.isReversed) continue

    const attempt = twoPointTryOf(play)
    const scoring = attempt ? scoringPartOf(play, attempt) : play
    const scored = scoring ? scoringEventOf(game, play, scoring, now) : null
    if (scored) out.push(scored)
    // After the touchdown it followed, so the phone hears them in the order they happened.
    const conversion = attempt ? twoPointEventOf(game, play, attempt, now) : null
    if (conversion) out.push(conversion)
  }

  return out
}

/** The play's own event — the touchdown, field goal, turnover or big gain — from `scoring`, the part of it that scored. */
function scoringEventOf(game: PbpGame, play: PbpPlay, scoring: PbpPlay, now: Date): LiveEvent | null {
  const type = classify(scoring)
  if (!type) return null
  let who = subjectOf(scoring, type)
  if (!who) return null
  // The try's QB may be the only entry naming the man who RAN the touchdown in (sequence 123 above).
  if (scoring !== play && play.event === 'run' && who.role === 'passer') who = { ...who, role: 'rusher' }
  // Only a pass has a passer; on a run or a return this is null.
  const passer = scoring.players.find((x) => x.role === 'passer') ?? null
  const thrower = passer && !samePerson(passer, who) ? passer : null

  return {
    gameId: game.gameId,
    // ⚠ INTEGER here; /injuries uses a STRING player_id for NFL. Cast on join.
    playerId: who.id != null ? String(who.id) : `name:${who.name}`,
    playerName: who.name,
    team: who.teamAbbr,
    type,
    stat: play.event,
    delta: play.yardsGained ?? 0,
    value: play.yardsGained ?? 0,
    detectedAt: now,
    /* Stable across retries and across BOTH sources: the game and the play's
       sequence identify a play uniquely, so a re-poll cannot double-notify. */
    idempotencyKey: `pbp:${game.gameId}:${play.sequence}:${type}`,
    // The touchdown's own sentence; a try that rode on it is its own event.
    detail: scoring.description,
    /*
     * Who did what, so a sentence can say it. `stat` above is the play's
     * `event` ('pass' / 'run'), which alone cannot tell the receiver of a pass
     * from the passer — the headline used to read it as a stat key and call
     * every catch a run. The passer rides along when he is not the subject, so
     * a receiving touchdown can name who threw it and his managers can be told.
     */
    role: who.role,
    passerId: thrower && thrower.id != null ? String(thrower.id) : null,
    passerName: thrower ? thrower.name : null,
  }
}

/**
 * The touchdown half of a play that carried a try: the same play, with only the players the
 * touchdown's own sentence names. Null when the row is the try alone — nothing scored a touchdown on it.
 *
 * When the prose names nobody we can match, the try's players are still excluded; a scorer we cannot
 * name is a missed alert, a try receiver called the scorer is a wrong one.
 */
function scoringPartOf(play: PbpPlay, attempt: TwoPointTry): PbpPlay | null {
  if (!attempt.tryText) return play
  if (!attempt.touchdownText) return null
  const named = play.players.filter((x) => namedIn(attempt.touchdownText, x.name))
  const players = named.length > 0 ? named : play.players.filter((x) => !namedIn(attempt.tryText, x.name))
  return { ...play, description: attempt.touchdownText, players }
}

/**
 * A successful offensive two-point try, as its own event about the player who scored it — the catch
 * or the run — with the passer riding along so his managers hear "2-pt conversion pass to …".
 *
 * Nothing for a failed try, a try nobody can be matched to, or a DEFENSIVE return: that is two points
 * to a team defence, and this feed alerts on players.
 */
function twoPointEventOf(game: PbpGame, play: PbpPlay, attempt: TwoPointTry, now: Date): LiveEvent | null {
  if (attempt.succeeded !== true || !attempt.tryText) return null
  const text = attempt.tryText
  const preferRole = (players: PbpPlayer[], role: string) => players.find((x) => x.role === role) ?? players[0] ?? null
  const pass = /\bpass\b/i.exec(text)
  let who: PbpPlayer | null
  let thrower: PbpPlayer | null = null
  if (pass) {
    const caught = text.slice(pass.index)
    const threw = text.slice(0, pass.index)
    who = preferRole(play.players.filter((x) => namedIn(caught, x.name)), 'receiver')
    thrower = preferRole(play.players.filter((x) => namedIn(threw, x.name)), 'passer')
    if (who) who = { ...who, role: 'receiver' }
  } else {
    who = preferRole(play.players.filter((x) => namedIn(text, x.name)), 'rusher')
    if (who) who = { ...who, role: 'rusher' }
  }
  if (!who) return null
  if (thrower && samePerson(thrower, who)) thrower = null
  return {
    gameId: game.gameId,
    playerId: who.id != null ? String(who.id) : `name:${who.name}`,
    playerName: who.name,
    team: who.teamAbbr,
    type: 'TWO_POINT_CONVERSION',
    // Not the play's `event`: that is the TOUCHDOWN's ('run' at sequence 123), and the try has no yards to show.
    stat: 'two_point_conversion',
    delta: 2,
    value: 2,
    detectedAt: now,
    idempotencyKey: `pbp:${game.gameId}:${play.sequence}:TWO_POINT_CONVERSION`,
    detail: text,
    role: who.role,
    passerId: thrower && thrower.id != null ? String(thrower.id) : null,
    passerName: thrower ? thrower.name : null,
  }
}
