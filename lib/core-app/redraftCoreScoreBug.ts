/**
 * /core Matchup + Live scores, redraft batch B3 (2026-10-31): the pure mappings behind the broadcast
 * score bugs. No rendering, so every sport and every state is unit-tested
 * (__tests__/core-app/redraftCoreScoreBug.test.ts).
 *
 * 🛑 REAL DATA ONLY. A label is built from what the feed sent — the server's `clockLabel` and the
 * feed's `statusDetail` (lib/live/liveScoresPage.ts) — and nothing is estimated. A period of 0 is a
 * feed placeholder, never a period: "Q0 · 15:00" prints no period, and a game with no usable label
 * says "Live" rather than inventing one.
 *
 * The styling these feed is redraft-only (components/core-app/af-core-redraft-matchup.css, scoped to
 * the /core shell's `data-format="redraft"`); the mappings themselves are format-free, so every other
 * league renders the same text it always did.
 */
import { gameStage, type GameStage } from '@/lib/live/gameStage'

export type BugTone = GameStage

export type LiveBugInput = {
  sport: string
  isLive: boolean
  completed: boolean
  clockLabel: string | null
  statusDetail: string
}

/** A label whose leading period is 0 ("Q0", "P0", "Inn 0", "0H", "0OT") — a placeholder, not a period. */
const PERIOD_ZERO = /^(?:(?:Q|P|Inn\s?|OT)0+|0+(?:H|OT))(?=$|[\s·])/i

/**
 * The period text of a live game, cleaned for the bug. Null when nothing usable is left.
 *
 * - `Q0 · 15:00` → the period is dropped; a bare clock is not a period either, so → null.
 * - NHL `P4` → `OT`: regulation is three periods, so ESPN's fourth is overtime. `P5` and later stay as
 *   the server wrote them — a fifth period is a shootout in the regular season and 2OT in the playoffs,
 *   and the row does not say which.
 * - Everything else (`Q3 · 8:42`, `P2 · 12:41`, `2H · 8:12`, `Bot 6th`, `Halftime`) passes through.
 */
export function cleanPeriodLabel(sport: string, label: string | null | undefined): string | null {
  const text = String(label ?? '').trim()
  if (!text) return null
  if (PERIOD_ZERO.test(text)) return null
  if (sport.toUpperCase() === 'NHL') return text.replace(/^P4(?=$|[\s·])/, 'OT')
  return text
}

/**
 * The bug's status bar for one game: its tone (the bar colour), the word the bar leads with, and the
 * period / start text beside it.
 *
 * - live: word `LIVE`, label = the cleaned clock label, else the cleaned status text, else null (the
 *   bar then says only LIVE — never "Q0").
 * - final: word `FINAL`, label = the feed's own final text when it says more ("Final/OT"), else null.
 * - upcoming: no word, label = the feed's start text ("Sun, 1:00 PM EDT").
 */
export function liveGameBug(game: LiveBugInput): { tone: BugTone; word: 'LIVE' | 'FINAL' | null; label: string | null } {
  const tone = gameStage(game)
  const detail = String(game.statusDetail ?? '').trim()
  if (tone === 'live') {
    return { tone, word: 'LIVE', label: cleanPeriodLabel(game.sport, game.clockLabel) ?? cleanPeriodLabel(game.sport, detail) }
  }
  if (tone === 'final') {
    return { tone, word: 'FINAL', label: /^final$/i.test(detail) || !detail ? null : detail }
  }
  return { tone, word: null, label: detail || null }
}

/** The per-player marker on a LIVE board: playing now, yet to play, or done. Null before kickoff and for a ruled-out starter. */
export function playerGameMark(
  cell: { empty?: boolean; unavailable?: string | null; gameState?: string | null } | null,
  live: boolean,
): 'live' | 'upcoming' | 'final' | null {
  if (!live || !cell || cell.empty || cell.unavailable) return null
  const s = cell.gameState
  return s === 'live' || s === 'upcoming' || s === 'final' ? s : null
}
