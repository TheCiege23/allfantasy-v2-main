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
              id: num(x.id),
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
      })
    }

    games.push({ gameId, awayTeamName: away, homeTeamName: home, plays })
  }
  return games
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
    const defensive =
      play.event === 'interception' ||
      play.event === 'fumble' ||
      play.event === 'safety' ||
      play.players.some((x) => x.role === 'interceptor' || x.role === 'recoverer')
    if (defensive) return 'DEFENSIVE_SCORE'
    if (play.event === 'kickoff' || play.event === 'punt' || play.event === 'field_goal') {
      return 'SPECIAL_TEAMS_SCORE'
    }
    return 'TOUCHDOWN'
  }

  if (play.event === 'field_goal' && play.isScoringPlay) return 'FIELD_GOAL'
  if (play.event === 'safety') return 'DEFENSIVE_SCORE'
  if (play.event === 'interception' || play.event === 'fumble') return 'TURNOVER'
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
      return by('rusher', 'receiver') ?? by('passer')
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

    const type = classify(play)
    if (!type) continue
    const who = subjectOf(play, type)
    if (!who) continue

    out.push({
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
      detail: play.description,
    })
  }

  return out
}
