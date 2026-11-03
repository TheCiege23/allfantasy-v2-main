import type { MatchupData, MatchupPlayerCell, MatchupSlot } from '@/lib/core-app/matchup'

/**
 * The matchup screen's three insight cards — swing game, lineup check, to win — and the slot-chip
 * tint, derived from what `getMatchupData` already loaded. Pure: no fetch, no clock, no guess.
 *
 * 🛑 EVERY CARD IS OPTIONAL, AND ABSENT IS THE ANSWER WHEN THE DATA IS NOT THERE. The redesign draws
 * a "left on the bench" card; this loader carries no bench, so that card is not drawn at all rather
 * than filled with a number nobody measured. Its place goes to the lineup check, which the stored
 * starters CAN answer: who in your lineup is certain to score nothing.
 */

export type WeekState = 'final' | 'live' | 'upcoming'

/** A position family for the slot chip's tint. Null when the label is not one we know for the sport. */
export type SlotFamily = 'qb' | 'rb' | 'wr' | 'te' | 'flex' | 'k'

const NFL: Record<string, SlotFamily> = {
  QB: 'qb',
  RB: 'rb',
  WR: 'wr',
  TE: 'te',
  K: 'k',
  DEF: 'k',
  DST: 'k',
  'D/ST': 'k',
  FLEX: 'flex',
  'W/R/T': 'flex',
  'W/R': 'flex',
  'W/T': 'flex',
  'R/W/T': 'flex',
  WRT: 'flex',
  'WR/TE': 'flex',
  'RB/WR': 'flex',
  REC_FLEX: 'flex',
  WRRB_FLEX: 'flex',
  SUPER_FLEX: 'flex',
  SUPERFLEX: 'flex',
  SF: 'flex',
  OP: 'flex',
  'Q/W/R/T': 'flex',
  // Defensive players share one family: a league either starts IDP or it does not.
  DL: 'flex',
  DE: 'flex',
  DT: 'flex',
  LB: 'flex',
  DB: 'flex',
  CB: 'flex',
  S: 'flex',
  IDP: 'flex',
  IDP_FLEX: 'flex',
}

const BASKETBALL: Record<string, SlotFamily> = {
  PG: 'wr',
  SG: 'wr',
  G: 'wr',
  SF: 'rb',
  PF: 'rb',
  F: 'rb',
  C: 'te',
  UTIL: 'flex',
  UT: 'flex',
  FLEX: 'flex',
}

const BASEBALL: Record<string, SlotFamily> = {
  C: 'te',
  '1B': 'wr',
  '2B': 'wr',
  '3B': 'wr',
  SS: 'wr',
  CI: 'wr',
  MI: 'wr',
  IF: 'wr',
  INF: 'wr',
  OF: 'rb',
  LF: 'rb',
  CF: 'rb',
  RF: 'rb',
  SP: 'qb',
  RP: 'qb',
  P: 'qb',
  DH: 'flex',
  UTIL: 'flex',
  UT: 'flex',
}

const HOCKEY: Record<string, SlotFamily> = {
  C: 'rb',
  LW: 'rb',
  RW: 'rb',
  W: 'rb',
  F: 'rb',
  D: 'wr',
  G: 'te',
  UTIL: 'flex',
}

const SOCCER: Record<string, SlotFamily> = {
  GK: 'te',
  G: 'te',
  D: 'wr',
  DEF: 'wr',
  M: 'rb',
  MID: 'rb',
  F: 'qb',
  FWD: 'qb',
  UTIL: 'flex',
}

/**
 * The tint family for one slot label, read under the league's sport — "C" is a centre in the NBA and
 * the NHL and a catcher in MLB, so the label alone cannot say. An unknown sport reads as NFL, the same
 * default the loader uses; an unknown label gets no tint rather than a wrong one.
 */
export function slotFamily(sport: string | null | undefined, slotLabel: string): SlotFamily | null {
  const label = slotLabel.trim().toUpperCase()
  const s = String(sport ?? 'NFL').toUpperCase()
  const table =
    s === 'NBA' || s === 'WNBA' || s === 'NCAAB' || s === 'NCAABB'
      ? BASKETBALL
      : s === 'MLB'
        ? BASEBALL
        : s === 'NHL'
          ? HOCKEY
          : s === 'SOCCER' || s === 'EPL' || s === 'MLS'
            ? SOCCER
            : NFL
  return table[label] ?? null
}

/** A starter whose own game has not started, or is on now — and who can still score. */
function stillToScore(c: MatchupPlayerCell | null): c is MatchupPlayerCell {
  return c != null && !c.empty && !c.unavailable && (c.gameState === 'live' || c.gameState === 'upcoming')
}

export type SwingGame = {
  /** "CIN @ BAL" when home is known, "CIN vs BAL" when it is not. */
  label: string
  /** Earliest kickoff among the starters in it, ISO — formatted by the browser. */
  kickoff: string | null
  live: boolean
  yours: string[]
  theirs: string[]
  /** Starters in this game, both sides. */
  inGame: number
  /** Starters still to score across the whole matchup, both sides. */
  remaining: number
}

/**
 * The real game holding the most of this matchup's unplayed starters — preferring one with starters
 * on BOTH sides, because a game that only feeds one lineup is a lead, not a swing.
 *
 * Needs a placed game for every starter it counts (`team` + `opponentClub`); a starter we could not
 * place is left out of the game and still counts toward `remaining`. Null on a final week, without a
 * board, or when no game holds at least two of the remaining starters.
 */
export function swingGame(data: MatchupData, weekState: WeekState): SwingGame | null {
  if (weekState === 'final' || !data.lineups.available) return null
  type Acc = { away: string | null; home: string | null; a: string; b: string; kickoff: string | null; live: boolean; yours: string[]; theirs: string[] }
  const games = new Map<string, Acc>()
  let remaining = 0
  const add = (c: MatchupPlayerCell | null, side: 'yours' | 'theirs') => {
    if (!stillToScore(c)) return
    remaining += 1
    if (!c.team || !c.opponentClub) return
    const [a, b] = [c.team, c.opponentClub].sort()
    const key = `${a}|${b}`
    const g = games.get(key) ?? { away: null, home: null, a, b, kickoff: null, live: false, yours: [], theirs: [] }
    if (c.home === true) {
      g.home = c.team
      g.away = c.opponentClub
    } else if (c.home === false) {
      g.away = c.team
      g.home = c.opponentClub
    }
    if (c.kickoff && (g.kickoff == null || c.kickoff < g.kickoff)) g.kickoff = c.kickoff
    if (c.gameState === 'live') g.live = true
    g[side].push(c.name ?? c.position ?? c.team)
    games.set(key, g)
  }
  for (const s of data.lineups.data) {
    add(s.you, 'yours')
    add(s.opponent, 'theirs')
  }
  const ranked = [...games.values()]
    .filter((g) => g.yours.length + g.theirs.length >= 2)
    .sort((x, y) => {
      const both = Number(y.yours.length > 0 && y.theirs.length > 0) - Number(x.yours.length > 0 && x.theirs.length > 0)
      if (both) return both
      const size = y.yours.length + y.theirs.length - (x.yours.length + x.theirs.length)
      if (size) return size
      // Earliest kickoff first; a game with no kickoff on file sorts last.
      if (x.kickoff == null || y.kickoff == null) return Number(x.kickoff == null) - Number(y.kickoff == null)
      return x.kickoff.localeCompare(y.kickoff)
    })
  const g = ranked[0]
  if (!g) return null
  return {
    label: g.away && g.home ? `${g.away} @ ${g.home}` : `${g.a} vs ${g.b}`,
    kickoff: g.kickoff,
    live: g.live,
    yours: g.yours,
    theirs: g.theirs,
    inGame: g.yours.length + g.theirs.length,
    remaining,
  }
}

export type LineupHole = {
  slot: string
  name: string | null
  reason: 'empty' | 'bye' | 'out'
}

/**
 * Your starters certain to score nothing: an empty slot, or a player ruled out or on bye. Only before
 * the week is final — afterwards nothing can be changed, and the board already shows the zeros.
 * An injury designation that is an UNCERTAINTY ("Q", "D") is not on this list: he may well play.
 */
export function lineupHoles(data: MatchupData, weekState: WeekState): LineupHole[] {
  if (weekState === 'final' || !data.lineups.available) return []
  const out: LineupHole[] = []
  for (const s of data.lineups.data as MatchupSlot[]) {
    const c = s.you
    if (!c) continue
    if (c.empty) out.push({ slot: s.slotLabel, name: null, reason: 'empty' })
    else if (c.unavailable) out.push({ slot: s.slotLabel, name: c.name, reason: c.unavailable === 'bye' ? 'bye' : 'out' })
  }
  return out
}

export type ToWin = {
  /** Points you still need to pass their projected final; 0 when you already have. */
  needed: number
  theirProjected: number
  yourScore: number
  /** Your starters whose game has not started. */
  yourLeft: number
  /** What those starters project for — null when any of them has no projection. */
  yourLeftProjected: number | null
}

/**
 * "To win": a live week only, from the scored total and the stored projected finals. Never on an
 * unplayed or finished week — before kickoff it would restate the projection, after it the result.
 *
 * The remaining projection counts only starters whose game has NOT started. A starter playing now
 * has a projection for his whole game and some of it is already in the score, so adding it would
 * count those points twice; he is left out, and the sentence says "still to play", which is exact.
 */
export function toWin(
  data: MatchupData,
  weekState: WeekState,
  scored: { you: number; opponent: number } | null,
): ToWin | null {
  if (weekState !== 'live' || !scored || !data.projectedFinal.available) return null
  const theirProjected = data.projectedFinal.data.opponent
  const needed = Math.max(0, Math.round((theirProjected - scored.you) * 10) / 10)
  let yourLeft = 0
  let sum = 0
  let priced = true
  if (data.lineups.available) {
    for (const s of data.lineups.data) {
      const c = s.you
      if (!c || c.empty || c.unavailable || c.gameState !== 'upcoming') continue
      if (c.actual != null && c.actual !== 0) continue
      yourLeft += 1
      if (c.projected == null) priced = false
      else sum += c.projected
    }
  } else {
    priced = false
  }
  return {
    needed,
    theirProjected,
    yourScore: scored.you,
    yourLeft,
    yourLeftProjected: priced && data.lineups.available ? Math.round(sum * 10) / 10 : null,
  }
}
