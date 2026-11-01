/**
 * Redraft native screens (batch A2 of the redraft visual upgrade): the pure mappings the five
 * `/league/[id]` screens — My team, Matchup, Players & waivers, Trades, Standings & playoffs — and the
 * Players tab use when the league carries the redraft identity (`resolveRedraftIdentity`). Design notes:
 * docs/design/redraft-native-screens.md.
 *
 * ⚠ EVERY FUNCTION HERE RETURNS `null` (or an empty list) WHEN THE DATA DOES NOT SAY. The screens drop
 * an element on `null`; they never fill one in. That is the whole contract: a bye badge needs a real
 * bye, an off-day badge needs a schedule that was actually loaded, "clinched" needs a generated
 * bracket, a FAAB meter needs both the budget and the balance.
 */
import type { RedraftSportTheme } from './redraftIdentity'

/* ── Position chips ─────────────────────────────────────────────────────────────────────────────── */

/**
 * The chip colour a position takes. Colours, not position names, because the same letters mean
 * different jobs by sport: `C` is a centre (NBA, NHL) or a catcher (MLB), `G` a guard (NBA) or a goalie
 * (NHL), `SF` a small forward (NBA) or a superflex slot (NFL), `DEF` a defence (NFL) or a defender
 * (soccer). redraft-native-screens.css maps each value to an existing /core token.
 */
export type RedraftPosTone = 'red' | 'green' | 'blue' | 'amber' | 'violet' | 'slate' | 'flex' | 'bench' | 'ir'

const COMMON: Record<string, RedraftPosTone> = { BN: 'bench', BENCH: 'bench', TX: 'bench', TAXI: 'bench', IR: 'ir', IL: 'ir', RES: 'ir' }

/** Per sport, by position or slot label. Football keeps the colours the native screens already use. */
const BY_SPORT: Record<RedraftSportTheme, Record<string, RedraftPosTone>> = {
  nfl: { QB: 'red', RB: 'green', WR: 'blue', TE: 'amber', K: 'violet', PK: 'violet', DEF: 'slate', DST: 'slate', 'D/ST': 'slate', FLEX: 'flex', FLX: 'flex', 'W/R/T': 'flex', WRT: 'flex', SF: 'flex', SUPER_FLEX: 'flex', OP: 'flex' },
  ncaaf: { QB: 'red', RB: 'green', WR: 'blue', TE: 'amber', K: 'violet', PK: 'violet', FLEX: 'flex', FLX: 'flex', 'W/R/T': 'flex', SF: 'flex', SUPER_FLEX: 'flex' },
  // Guards blue, forwards green, centres amber.
  nba: { PG: 'blue', SG: 'blue', G: 'blue', SF: 'green', PF: 'green', F: 'green', C: 'amber', UTIL: 'flex', UT: 'flex' },
  ncaab: { PG: 'blue', SG: 'blue', G: 'blue', SF: 'green', PF: 'green', F: 'green', C: 'amber', UTIL: 'flex', UT: 'flex' },
  // Centres blue, wingers green, defence amber, goalies red.
  nhl: { C: 'blue', LW: 'green', RW: 'green', W: 'green', F: 'green', D: 'amber', G: 'red', UTIL: 'flex', SKT: 'flex' },
  // Catcher violet, infield green, outfield blue, starters red, relievers amber.
  mlb: { C: 'violet', '1B': 'green', '2B': 'green', '3B': 'green', SS: 'green', IF: 'green', CI: 'green', MI: 'green', OF: 'blue', LF: 'blue', CF: 'blue', RF: 'blue', SP: 'red', RP: 'amber', P: 'red', DH: 'flex', UTIL: 'flex' },
  // Keeper amber, defenders blue, midfielders green, forwards red.
  soccer: { GK: 'amber', GKP: 'amber', DEF: 'blue', D: 'blue', MID: 'green', M: 'green', FWD: 'red', F: 'red', ST: 'red' },
}

/** The chip tone for a position or slot label in a sport; null when the sport does not use that label. */
export function redraftPositionTone(sport: RedraftSportTheme, position: string | null | undefined): RedraftPosTone | null {
  const p = String(position ?? '').trim().toUpperCase()
  if (!p) return null
  return COMMON[p] ?? BY_SPORT[sport][p] ?? null
}

/** The position filters a sport's player lists offer (the same set the waiver screen shows). */
export const REDRAFT_POSITION_FILTERS: Record<RedraftSportTheme, string[]> = {
  nfl: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'],
  ncaaf: ['QB', 'RB', 'WR', 'TE', 'K'],
  nba: ['PG', 'SG', 'SF', 'PF', 'C'],
  ncaab: ['G', 'F', 'C'],
  nhl: ['C', 'LW', 'RW', 'D', 'G'],
  mlb: ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP'],
  soccer: ['GKP', 'DEF', 'MID', 'FWD'],
}

/** Football is the only family whose stat table is rushing / receiving / passing. */
export function isFootballTheme(sport: RedraftSportTheme): boolean {
  return sport === 'nfl' || sport === 'ncaaf'
}

/* ── My team ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * Daily-lineup leagues: the ids whose team has NO GAME on the day being shown. The roster route stamps
 * `periodOpponent` per row from that day's schedule — a team code, or `null` for no game. A `null` is
 * also what every row carries when the schedule did not load at all, so a null is trusted only when at
 * least one other row on the same roster names an opponent: that row proves the day's schedule was read.
 */
export function dailyOffDayIds(rows: ReadonlyArray<{ id: string; periodOpponent?: string | null }> | null | undefined): Set<string> {
  const list = rows ?? []
  const scheduleKnown = list.some(r => typeof r.periodOpponent === 'string' && r.periodOpponent.trim() !== '')
  if (!scheduleKnown) return new Set()
  return new Set(list.filter(r => Object.prototype.hasOwnProperty.call(r, 'periodOpponent') && r.periodOpponent === null).map(r => r.id))
}

/** Weekly leagues: a real bye — the game context says BYE, or his bye week is this week. */
export function isOnBye(p: { opponent?: string | null; byeWeek?: number | null } | null | undefined, week: number | null | undefined): boolean {
  if (!p) return false
  if (String(p.opponent ?? '').toUpperCase() === 'BYE') return true
  return week != null && p.byeWeek != null && Number(p.byeWeek) === Number(week)
}

/* ── Matchup ───────────────────────────────────────────────────────────────────────────────────── */

export type RedraftGameState = 'live' | 'final' | 'upcoming'

/** A starter's game, or null when the feed does not know (`unknown` is not the same as "not started"). */
export function slotGameState(status: string | null | undefined): RedraftGameState | null {
  const s = String(status ?? '').toLowerCase()
  if (s === 'live' || s === 'final' || s === 'upcoming') return s
  return null
}

export const MATCHUP_STATE_LABEL: Record<RedraftGameState, string> = { live: 'Live', final: 'Final', upcoming: 'Upcoming' }

/** Per side: how many starters are playing now, done, and still to play — only from known states. */
export function sideGameCounts(slots: ReadonlyArray<{ gameStatus?: string | null }>): Record<RedraftGameState, number> {
  const out: Record<RedraftGameState, number> = { live: 0, final: 0, upcoming: 0 }
  for (const s of slots) {
    const st = slotGameState(s.gameStatus)
    if (st) out[st]++
  }
  return out
}

/* ── Players & waivers ─────────────────────────────────────────────────────────────────────────── */

/** The league's claim system in words, or null for a value this screen does not recognise. */
export function waiverClaimTypeLabel(waiverType: string | null | undefined): string | null {
  const t = String(waiverType ?? '').trim().toLowerCase()
  if (t === 'faab') return 'FAAB bidding'
  if (t === 'rolling' || t === 'rolling_priority' || t === 'priority' || t === 'standard') return 'Rolling priority'
  if (t === 'reverse_standings') return 'Reverse standings'
  if (t === 'fcfs') return 'First come, first served'
  return null
}

export type FaabMeter = { remaining: number; budget: number; spent: number; pct: number }

/** The FAAB balance against the budget, or null unless both are real numbers and the budget is positive. */
export function faabMeter(remaining: number | null | undefined, budget: number | null | undefined): FaabMeter | null {
  if (remaining == null || budget == null) return null
  const r = Number(remaining)
  const b = Number(budget)
  if (!Number.isFinite(r) || !Number.isFinite(b) || b <= 0) return null
  const clamped = Math.max(0, Math.min(b, r))
  return { remaining: r, budget: b, spent: b - clamped, pct: Math.round((clamped / b) * 100) }
}

/** A claim row's status in words (the server's `WaiverClaim.status`); null for an unknown value. */
export function claimStatusLabel(status: string | null | undefined): { label: string; tone: 'accent' | 'good' | 'bad' | 'neutral' } | null {
  const s = String(status ?? '').trim().toLowerCase()
  if (!s || s === 'pending') return { label: 'Pending', tone: 'accent' }
  if (s === 'processed' || s === 'won' || s === 'successful' || s === 'approved') return { label: 'Won', tone: 'good' }
  if (s === 'failed' || s === 'lost' || s === 'rejected' || s === 'outbid') return { label: 'Lost', tone: 'bad' }
  if (s === 'cancelled' || s === 'canceled') return { label: 'Cancelled', tone: 'neutral' }
  return null
}

/* ── Trades ────────────────────────────────────────────────────────────────────────────────────── */

export type TradeDeadlineState =
  | { kind: 'none' }
  | { kind: 'set'; week: number }
  | { kind: 'open'; week: number; weeksLeft: number }
  | { kind: 'final'; week: number }
  | { kind: 'passed'; week: number }

/**
 * The trade deadline from the league's own settings (`League.tradeDeadlineWeek`). No deadline set is
 * a real state ("no deadline"); a deadline with no current week is shown without a countdown.
 */
export function tradeDeadlineState(deadlineWeek: number | null | undefined, currentWeek: number | null | undefined): TradeDeadlineState {
  const d = Number(deadlineWeek)
  if (deadlineWeek == null || !Number.isFinite(d) || d <= 0) return { kind: 'none' }
  const c = Number(currentWeek)
  if (currentWeek == null || !Number.isFinite(c) || c <= 0) return { kind: 'set', week: d }
  if (c > d) return { kind: 'passed', week: d }
  if (c === d) return { kind: 'final', week: d }
  return { kind: 'open', week: d, weeksLeft: d - c }
}

export function tradeDeadlineLabel(s: TradeDeadlineState): string {
  switch (s.kind) {
    case 'none':
      return 'No trade deadline'
    case 'set':
      return `Deadline · Wk ${s.week}`
    case 'open':
      return `Deadline · Wk ${s.week} · ${s.weeksLeft} ${s.weeksLeft === 1 ? 'week' : 'weeks'} left`
    case 'final':
      return `Deadline week · Wk ${s.week}`
    case 'passed':
      return `Deadline passed · Wk ${s.week}`
  }
}

/** The state a trade card shows, from the real `AfLeagueTrade.status`; null when it is not an open state. */
export function tradeCardState(status: string | null | undefined): { label: string; tone: 'warn' | 'accent' | 'good' | 'bad' } | null {
  const s = String(status ?? '').trim().toLowerCase()
  if (s === 'pending') return { label: 'Awaiting response', tone: 'accent' }
  if (s === 'awaiting_commissioner') return { label: 'Commissioner review', tone: 'warn' }
  if (s === 'accepted' || s === 'completed' || s === 'executed') return { label: 'Completed', tone: 'good' }
  if (s === 'vetoed' || s === 'rejected' || s === 'declined') return { label: 'Declined', tone: 'bad' }
  return null
}

/* ── Standings & playoffs ──────────────────────────────────────────────────────────────────────── */

export type PlayoffRaceStatus = 'champion' | 'clinched' | 'eliminated'

/**
 * Clinched / eliminated are only claimed once the bracket is GENERATED: until then the playoff runtime's
 * seeds are "if the season ended today" and its `eliminatedRosterIds` are simply the teams below the
 * line right now — neither is a mathematical result, so nothing is shown before generation.
 */
export function playoffRaceStatus(
  runtime: { bracket?: { generated?: boolean; championRosterId?: string | null } | null; seeds?: ReadonlyArray<{ rosterId: string }> | null } | null | undefined,
  rosterId: string,
): PlayoffRaceStatus | null {
  const b = runtime?.bracket
  if (!b?.generated) return null
  if (b.championRosterId && b.championRosterId === rosterId) return 'champion'
  const seeded = new Set((runtime?.seeds ?? []).map(s => s.rosterId))
  if (!seeded.size) return null
  return seeded.has(rosterId) ? 'clinched' : 'eliminated'
}

export const PLAYOFF_RACE_LABEL: Record<PlayoffRaceStatus, string> = { champion: 'Champion', clinched: 'Clinched', eliminated: 'Eliminated' }

type RuntimeMatchup = {
  matchupId: string
  homeRosterId: string | null
  awayRosterId: string | null
  homeSeed: number | null
  awaySeed: number | null
  homeScore: number | null
  awayScore: number | null
  winnerRosterId: string | null
  status?: string | null
  bye?: boolean
  complete?: boolean
}
type RuntimeRound = { roundId: string; roundNumber: number; roundName: string; status?: string | null; matchups: RuntimeMatchup[] }

export type BracketSlot = { rosterId: string | null; name: string | null; seed: number | null; score: number | null; won: boolean }
export type BracketGame = { id: string; home: BracketSlot; away: BracketSlot | null; bye: boolean; state: 'final' | 'live' | 'scheduled'; viewer: boolean }
export type BracketColumn = { id: string; name: string; games: BracketGame[] }

/**
 * The championship bracket as columns, straight from the stored rounds. A slot with no team yet stays
 * `name: null` (the UI says "TBD"); a bye has no away slot. Nothing is projected forward.
 */
export function bracketColumns(
  rounds: ReadonlyArray<RuntimeRound> | null | undefined,
  nameOf: (rosterId: string) => string | null,
  viewerRosterId: string | null,
): BracketColumn[] {
  return [...(rounds ?? [])]
    .sort((a, b) => a.roundNumber - b.roundNumber)
    .map(r => ({
      id: r.roundId,
      name: r.roundName,
      games: r.matchups.map(m => {
        const slot = (id: string | null, seed: number | null, score: number | null): BracketSlot => ({ rosterId: id, name: id ? nameOf(id) : null, seed, score, won: Boolean(id && m.winnerRosterId === id) })
        const bye = Boolean(m.bye) || (Boolean(m.homeRosterId) && !m.awayRosterId && Boolean(m.complete || m.bye))
        const st = String(m.status ?? '').toLowerCase()
        return {
          id: m.matchupId,
          home: slot(m.homeRosterId, m.homeSeed, m.homeScore),
          away: bye ? null : slot(m.awayRosterId, m.awaySeed, m.awayScore),
          bye,
          state: m.complete || m.winnerRosterId ? 'final' : st === 'live' || st === 'in_progress' ? 'live' : 'scheduled',
          viewer: Boolean(viewerRosterId && (m.homeRosterId === viewerRosterId || m.awayRosterId === viewerRosterId)),
        }
      }),
    }))
}
