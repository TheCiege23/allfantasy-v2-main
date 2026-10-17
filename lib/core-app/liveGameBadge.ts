/**
 * The live game badge on a player's card: his club's game this week — LIVE with the score, or FINAL —
 * and his points in each of your leagues as that league's platform scored them.
 *
 * Pure, client-safe. The loader is liveGameBadgeLoader.ts.
 *
 * ⚠ THE FEEDS DISAGREE, SO THE STATE IS RECONCILED, NEVER READ FROM ONE ROW. Measured 2026-09-29 on the
 * Monday-night game (kickoff 00:15 UTC): hours after the whistle, `espn_live` still said `in_progress`
 * while rolling_insights and api_sports said `final`. So: any source saying final wins; a game can be
 * LIVE only between kickoff and `LIVE_WINDOW_H` after it; past that window it is treated as over
 * whatever a lagging feed says. Status casing varies (`Final` / `final`) and is folded.
 *
 * ⚠ AND THE WEEK NUMBER IS NOT A SLATE. The same feed leaves `seasonType` null and reuses week numbers
 * for August preseason games — measured: "week 4, final" rows that are preseason. The fixture is
 * chosen by KICKOFF TIME around now, preseason rows are dropped, and the week comes from that fixture.
 */

/** A game is only ever LIVE this long after kickoff; an NFL game with overtime runs ~4 hours. */
export const LIVE_WINDOW_H = 5
/** A finished game keeps its FINAL badge this long, then the card moves on to the next fixture. */
export const FINAL_SHOWN_H = 36

export type GameRow = {
  homeTeam: string | null
  awayTeam: string | null
  homeScore: number | null
  awayScore: number | null
  status: string | null
  startTime: Date | string | null
  seasonType: string | null
  week: number | null
  updatedAt?: Date | string | null
}

export type LiveGame = {
  state: 'live' | 'final'
  week: number
  kickoff: string
  home: string
  away: string
  homeScore: number | null
  awayScore: number | null
  /** True when he plays for the home side. */
  isHome: boolean
}

export type LeaguePoints = { leagueId: string; leagueName: string; points: number; isStarter: boolean; updatedAt: string; finalized: boolean }

export type LiveGameBadge = { game: LiveGame; leagues: LeaguePoints[] }

const H = 3_600_000
const ms = (d: Date | string | null | undefined) => (d == null ? NaN : new Date(d).getTime())
const norm = (s: string | null) => String(s ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
const isFinalStatus = (s: string | null) => ['final', 'final_ot', 'completed', 'complete', 'closed', 'post', 'ft'].includes(norm(s))
const isLiveStatus = (s: string | null) => ['in_progress', 'inprogress', 'live', 'halftime', 'in_play'].includes(norm(s))

/**
 * His club's game that is live now or finished in the last `FINAL_SHOWN_H`, reconciled across every
 * feed's rows for that fixture. Null before kickoff (the lock clock covers that) and between games.
 */
export function reconcileGame(args: { club: string; rows: readonly GameRow[]; now: Date; fold: (t: string) => string | null }): LiveGame | null {
  const now = args.now.getTime()
  // Every row involving his club, regular season only, kicked off and not stale.
  const mine = args.rows.flatMap((r) => {
    if (norm(r.seasonType) === 'pre' || norm(r.seasonType) === 'preseason') return []
    const kick = ms(r.startTime)
    if (!Number.isFinite(kick) || kick > now || now - kick > (LIVE_WINDOW_H + FINAL_SHOWN_H) * H) return []
    const home = r.homeTeam ? args.fold(r.homeTeam) : null
    const away = r.awayTeam ? args.fold(r.awayTeam) : null
    if (!home || !away || (home !== args.club && away !== args.club)) return []
    return [{ ...r, home, away, kick }]
  })
  if (mine.length === 0) return null
  // The most recent kickoff is the fixture; every feed's row for the same pairing near it is one game.
  const latest = mine.reduce((a, b) => (b.kick > a.kick ? b : a))
  const pairing = [latest.home, latest.away].sort().join('@')
  const fixture = mine.filter((r) => [r.home, r.away].sort().join('@') === pairing && Math.abs(r.kick - latest.kick) < 6 * H)
  const kick = latest.kick
  const anyFinal = fixture.some((r) => isFinalStatus(r.status))
  const anyLive = fixture.some((r) => isLiveStatus(r.status))
  const withinLive = now - kick <= LIVE_WINDOW_H * H
  const state: LiveGame['state'] | null = anyFinal || !withinLive ? 'final' : anyLive ? 'live' : null
  // Kicked off, inside the window, but no feed has picked it up yet: say nothing rather than guess.
  if (!state) return null
  // The score from a row that agrees with the state, newest first. For FINAL, a row that says final beats
  // any other — however recently a lagging feed touched its stale in-progress score — and only when no
  // feed says final (a game past the live window) does the newest scored row stand in.
  const scoredRows = fixture.filter((r) => r.homeScore != null && r.awayScore != null)
  const finals = scoredRows.filter((r) => isFinalStatus(r.status))
  const agreeing = (state === 'final' ? (finals.length > 0 ? finals : scoredRows) : scoredRows.filter((r) => isLiveStatus(r.status)))
    .slice()
    .sort((a, b) => (ms(b.updatedAt) || 0) - (ms(a.updatedAt) || 0))
  const scored = agreeing[0] ?? null
  const base = scored ?? fixture[0]
  const week = fixture.map((r) => r.week).find((w): w is number => typeof w === 'number') ?? null
  if (week == null) return null
  return {
    state,
    week,
    kickoff: new Date(kick).toISOString(),
    home: base.home,
    away: base.away,
    homeScore: scored ? scored.homeScore : null,
    awayScore: scored ? scored.awayScore : null,
    isHome: base.home === args.club,
  }
}

/** "BUF 24 – 20 KC" with his club first. */
export function scoreLine(g: LiveGame): string | null {
  if (g.homeScore == null || g.awayScore == null) return null
  const [us, them, usPts, themPts] = g.isHome ? [g.home, g.away, g.homeScore, g.awayScore] : [g.away, g.home, g.awayScore, g.homeScore]
  return `${us} ${usPts} – ${themPts} ${them}`
}

/** "just now", "4 min ago", "2 h ago". */
export function agoLabel(iso: string, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  return `${Math.round(min / 60)} h ago`
}
