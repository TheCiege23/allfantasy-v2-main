/**
 * Pure view-model helpers for the native league screens (handoff 2026-10-11, part B):
 * Matchup, Lineup, Waivers, Trades, Standings.
 *
 * Presentation only. Nothing here decides a score, a waiver, a trade or a tiebreak: standings rank
 * comes from the server (`/api/leagues/[id]/scoring/standings` applies the league's tiebreaks),
 * waiver processing stays in the waiver routes, and a lineup is still validated by
 * `/api/leagues/roster/save`. These helpers only shape what those already return.
 */
import { computeOptimalLineup, type LineupSlotSpec } from '@/lib/lineup-optimizer/optimalLineup'
import { normalizePositionForStarterEligibility } from '@/lib/roster/LineupTemplateValidation'
import type { ExpandedStarterSlot } from '@/lib/league/lineup-expand-template'
import type { RosterLineupLists } from '@/lib/league/lineup-swap'
import { detectPlayIn } from '@/lib/playoff-brackets/playIn'

/* ── Shared formatting ───────────────────────────────────────────────── */

/** `2` → `2nd`. Non-positive or non-finite input returns null so callers can omit it. */
export function ordinal(n: number | null | undefined): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null
  const i = Math.trunc(n)
  const mod100 = i % 100
  if (mod100 >= 11 && mod100 <= 13) return `${i}th`
  const suffix = ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[i % 10] ?? 'th'
  return `${i}${suffix}`
}

export function formatRecord(r: { wins: number; losses: number; ties?: number | null }): string {
  return `${r.wins}–${r.losses}${r.ties ? `–${r.ties}` : ''}`
}

/** One decimal, or an em dash for a missing number. Never prints NaN. */
export function fmt1(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(1) : '—'
}

/** `Jalen Hurts` → `J. Hurts` (phone rows). Single-word names and D/ST names are kept whole. */
export function shortPlayerName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2 || /d\/st|defense/i.test(name)) return name.trim()
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`
}

export function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? '')
      .join('')
      .toUpperCase() || 'AF'
  )
}

/* ── Position tones ──────────────────────────────────────────────────── */

export type PositionTone = 'qb' | 'rb' | 'wr' | 'te' | 'k' | 'def' | 'flex' | 'bench' | 'ir' | 'other'

/**
 * The handoff colours positions QB/RB/WR/TE. The tone is a NAME, mapped to a /core token in
 * native-screens.css (`--nl-pos-*`), so no component carries a hex value.
 */
export function positionTone(position: string | null | undefined): PositionTone {
  const p = String(position ?? '').trim().toUpperCase()
  if (p === 'QB') return 'qb'
  if (p === 'RB') return 'rb'
  if (p === 'WR') return 'wr'
  if (p === 'TE') return 'te'
  if (p === 'K' || p === 'PK') return 'k'
  if (p === 'DEF' || p === 'DST' || p === 'D/ST') return 'def'
  if (p === 'BN' || p === 'BENCH') return 'bench'
  if (p === 'IR') return 'ir'
  if (p.includes('FLEX') || p === 'FLX' || p === 'SF' || p === 'SUPER_FLEX' || p === 'OP' || p === 'UTIL') return 'flex'
  return 'other'
}

/** Short slot label for the pill: `SUPER_FLEX` → `SF`, `FLEX` → `FLX`, `DST` → `DEF`. */
export function slotPillLabel(label: string | null | undefined): string {
  const p = String(label ?? '').trim().toUpperCase()
  if (!p) return '—'
  if (p === 'SUPER_FLEX' || p === 'SUPERFLEX') return 'SF'
  if (p === 'FLEX' || p === 'W/R/T' || p === 'WRT') return 'FLX'
  if (p === 'DST' || p === 'D/ST') return 'DEF'
  if (p === 'BENCH') return 'BN'
  return p.length > 4 ? p.slice(0, 4) : p
}

/* ── Matchup ─────────────────────────────────────────────────────────── */

/** Left/right point colour: the leader is `good`, the trailer `bad` once a row is decided either way. */
export function rowPointTone(mine: number, theirs: number, mineDone: boolean): 'good' | 'bad' | 'neutral' {
  if (mine > theirs) return 'good'
  if (mine < theirs && mineDone) return 'bad'
  return 'neutral'
}

export type ScoreboardRow = {
  rosterId: string
  teamName: string
  totalPoints: number | null
  opponentRosterId: string | null
}

export type ScoreboardPair = {
  home: ScoreboardRow
  away: ScoreboardRow | null
  /** True when the viewer is one of the two teams. */
  mine: boolean
}

/**
 * `teamWeekResult` rows are one per roster; a matchup is the pair joined on `opponentRosterId`.
 * Each matchup appears once, the viewer's first. A row whose opponent has no row of its own (a
 * bye, or the opponent's result not written yet) stands alone rather than being dropped.
 */
export function pairScoreboard(rows: ScoreboardRow[], viewerRosterId: string | null): ScoreboardPair[] {
  const byId = new Map(rows.map((r) => [r.rosterId, r]))
  const seen = new Set<string>()
  const out: ScoreboardPair[] = []
  for (const row of rows) {
    if (seen.has(row.rosterId)) continue
    seen.add(row.rosterId)
    const opp = row.opponentRosterId ? byId.get(row.opponentRosterId) ?? null : null
    if (opp) seen.add(opp.rosterId)
    const mine = viewerRosterId != null && (row.rosterId === viewerRosterId || opp?.rosterId === viewerRosterId)
    out.push({ home: row, away: opp, mine })
  }
  return out.sort((a, b) => Number(b.mine) - Number(a.mine))
}

/* ── Standings ───────────────────────────────────────────────────────── */

export type PlayoffFormat = {
  teams: number | null
  byes: number | null
  startWeek: number | null
  weeks: number | null
  consolation: 'toilet_bowl' | 'consolation' | 'none' | null
  /** A play-in week (lib/playoff-brackets/playIn.ts): `teams` counts the play-in seeds too. */
  playIn?: { qualifiers: number; games: Array<[number, number]> } | null
}

function finiteInt(v: unknown): number | null {
  if ((typeof v !== 'number' && typeof v !== 'string') || (typeof v === 'string' && !v.trim())) return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null
}

/**
 * Reads the playoff format from `League.settings` the same way
 * `lib/playoff-defaults/PlayoffBracketConfigResolver.ts` does — `settings.playoff_structure.<key>`
 * first, then `settings.<key>` — plus the `League.playoffStartWeek` column. A key the league never
 * set comes back null so the card can say "League default" instead of inventing a number.
 *
 * ⚠ THE LOWER BRACKET COMES FROM THE `League.playoffLowerBracket` COLUMN when it is set — the column
 * the bracket is built from (`getBracketConfigForLeague`) and the one the playoff settings panel
 * writes. The JSON flags beside it go stale when the commissioner changes the column, so the card
 * used to name a bracket the league would not play. The flags are read only when the column is unset.
 */
export function readPlayoffFormat(settings: unknown, playoffStartWeek?: number | null, playoffLowerBracket?: string | null): PlayoffFormat {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  const structure =
    s.playoff_structure && typeof s.playoff_structure === 'object' ? (s.playoff_structure as Record<string, unknown>) : {}
  const read = (...keys: string[]): unknown => {
    for (const k of keys) {
      if (structure[k] != null) return structure[k]
      if (s[k] != null) return s[k]
    }
    return undefined
  }
  const teams = finiteInt(read('playoff_team_count', 'playoffTeams', 'playoff_teams'))
  const byes = finiteInt(read('first_round_byes', 'playoffByes'))
  const columnStart = finiteInt(playoffStartWeek)
  const settingsStart = finiteInt(read('playoff_start_week', 'playoffStartWeek', 'playoff_week_start'))
  const startWeek = columnStart != null && columnStart > 0 ? columnStart : settingsStart != null && settingsStart > 0 ? settingsStart : null
  const explicitWeeks = finiteInt(read('playoff_weeks'))
  const storedPlan = Array.isArray(s.playoff_bye_plan) ? (s.playoff_bye_plan as unknown[]).map((v) => Number(v)) : null
  const playIn = teams != null ? detectPlayIn(teams, storedPlan) : null
  const weeks = explicitWeeks ?? (playIn ? (playoffRoundsFor(playIn.qualifiers) ?? 0) + 1 : teams != null && byes != null ? playoffRoundsFor(teams) : null)
  const toilet = read('toilet_bowl_enabled')
  const consolation = read('consolation_bracket_enabled')
  const column = String(playoffLowerBracket ?? '').trim().toLowerCase()
  // Exactly the bracket config's reading of the column: any other set value plays no lower bracket.
  const fromColumn: PlayoffFormat['consolation'] = !column
    ? null
    : column === 'toilet'
      ? 'toilet_bowl'
      : column === 'consolation' || column === 'consolation_bracket'
        ? 'consolation'
        : 'none'
  return {
    teams,
    byes,
    startWeek,
    weeks,
    // Only present for a play-in, so a league without one reads exactly as before.
    ...(playIn ? { playIn: { qualifiers: playIn.qualifiers, games: playIn.games } } : {}),
    consolation:
      fromColumn ??
      (toilet === true ? 'toilet_bowl' : consolation === true ? 'consolation' : toilet === false && consolation === false ? 'none' : null),
  }
}

/** Single-elimination rounds for N playoff teams: ceil(log2 N). 6 → 3, 4 → 2, 8 → 3. */
export function playoffRoundsFor(teams: number): number | null {
  if (!Number.isFinite(teams) || teams < 2) return null
  return Math.ceil(Math.log2(teams))
}

/** `W3` / `L1` → tone. Anything else (a tie streak, a dash) is neutral. */
export function streakTone(streak: string | null | undefined): 'good' | 'bad' | 'neutral' {
  const s = String(streak ?? '').trim().toUpperCase()
  if (/^W\d/.test(s)) return 'good'
  if (/^L\d/.test(s)) return 'bad'
  return 'neutral'
}

/** Odds bar tone: ≥40% good, ≥20% warn, below bad — the handoff's three-step ramp. */
export function oddsTone(pct: number | null | undefined): 'good' | 'accent' | 'warn' | 'bad' | 'neutral' {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return 'neutral'
  if (pct >= 70) return 'good'
  if (pct >= 30) return 'accent'
  if (pct >= 10) return 'warn'
  return 'bad'
}

/** `"7-4-1"` all-play → win share, counting a tie as half. Null when unparseable. */
export function allPlayShare(allPlay: string | null | undefined): number | null {
  const m = String(allPlay ?? '').match(/^(\d+)-(\d+)(?:-(\d+))?$/)
  if (!m) return null
  const w = Number(m[1])
  const l = Number(m[2])
  const t = Number(m[3] ?? 0)
  const games = w + l + t
  return games > 0 ? (w + t / 2) / games : null
}

export type PowerInputRow = { rosterId: string; allPlay?: string | null; pointsFor: number }

/**
 * The "Power" toggle. A ranking by all-play record (how a team would fare against every other
 * team every week, which removes schedule luck), then points for. Both come from the native
 * standings read; nothing is projected or provider-sourced. Rows without an all-play record sort
 * after rows with one, by points for.
 */
export function powerOrder<T extends PowerInputRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const sa = allPlayShare(a.allPlay)
    const sb = allPlayShare(b.allPlay)
    if (sa != null && sb != null && sa !== sb) return sb - sa
    if (sa != null && sb == null) return -1
    if (sa == null && sb != null) return 1
    return (b.pointsFor ?? 0) - (a.pointsFor ?? 0)
  })
}

/* ── Waivers ─────────────────────────────────────────────────────────── */

export type WaiverTxLike = { addPlayerId: string; dropPlayerId: string | null }
export type WaiverClaimLike = { addPlayerId: string }

/**
 * League-activity trend, signed: +2 per processed add and +1 per pending claim, as the existing
 * waiver wire weighs them (`WaiverWirePage` `trendMap`), but a drop counts −1 here rather than +1,
 * because this screen prints the number as a direction ("+9" / "−3") rather than using it only to
 * sort by activity. Display only; it ranks nothing that processing reads.
 */
export function waiverTrendByPlayer(transactions: WaiverTxLike[], claims: WaiverClaimLike[]): Map<string, number> {
  const m = new Map<string, number>()
  const bump = (id: string | null | undefined, by: number) => {
    if (!id) return
    m.set(id, (m.get(id) ?? 0) + by)
  }
  for (const tx of transactions) {
    bump(tx.addPlayerId, 2)
    bump(tx.dropPlayerId, -1)
  }
  for (const c of claims) bump(c.addPlayerId, 1)
  return m
}

export function signed(n: number): string {
  if (n > 0) return `+${n}`
  if (n < 0) return `−${Math.abs(n)}`
  return '0'
}

/* ── Lineup ──────────────────────────────────────────────────────────── */

export type LineupPlayerInfo = { position?: string | null; projectedPoints?: number | null }

/**
 * AF "optimal lineup": the exact optimiser (`computeOptimalLineup`, the same primitive Max PF uses)
 * over starters + bench, scored on each player's projection. Returns the new lists with starters
 * re-seated into slot order, or null when nothing would change or a slot could not be filled.
 *
 * IR / taxi / devy players are never considered — moving them is a roster decision, not a lineup
 * one. The server still validates the result on save; this only proposes it.
 */
export function optimalLineupLists(
  slots: ExpandedStarterSlot[],
  lists: RosterLineupLists,
  players: Record<string, LineupPlayerInfo | undefined>,
): RosterLineupLists | null {
  if (!slots.length) return null
  const pool = [...lists.starters, ...lists.bench].filter(Boolean)
  const specs: LineupSlotSpec[] = slots.map((slot, i) => ({
    slot: `S${i}`,
    eligible: slot.allowedPositions.map((p) => normalizePositionForStarterEligibility(String(p))),
    count: 1,
    slotOrder: i,
  }))
  const result = computeOptimalLineup({
    slots: specs,
    players: pool.map((id) => ({
      playerId: id,
      positions: [normalizePositionForStarterEligibility(String(players[id]?.position ?? ''))].filter(Boolean),
      points: Number(players[id]?.projectedPoints ?? 0) || 0,
    })),
  })
  if (result.unfilledSlots.length) return null
  const starters = slots.map((_, i) => result.assignments.find((a) => a.slot === `S${i}`)?.playerId ?? '')
  const startingSet = new Set(starters)
  const bench = pool.filter((id) => !startingSet.has(id))
  const unchanged = starters.every((id, i) => id === (lists.starters[i] ?? ''))
  if (unchanged) return null
  return { ...lists, starters, bench }
}

/**
 * `optimalLineupLists`, but a player whose game has started stays exactly where he is: a locked
 * starter keeps his slot and a locked bench player stays on the bench. Only the unlocked slots are
 * re-solved, from the unlocked players.
 */
export function optimalLineupListsRespectingLocks(
  slots: ExpandedStarterSlot[],
  lists: RosterLineupLists,
  players: Record<string, LineupPlayerInfo | undefined>,
  isLocked: (playerId: string) => boolean,
): RosterLineupLists | null {
  const openIdx = slots.map((_, i) => i).filter((i) => !(lists.starters[i] && isLocked(lists.starters[i])))
  if (!openIdx.length) return null
  const lockedBench = lists.bench.filter((id) => id && isLocked(id))
  const sub = optimalLineupLists(
    openIdx.map((i) => slots[i]),
    {
      ...lists,
      starters: openIdx.map((i) => lists.starters[i] ?? ''),
      bench: lists.bench.filter((id) => id && !isLocked(id)),
    },
    players,
  )
  if (!sub) return null
  const starters = [...lists.starters]
  openIdx.forEach((slotIndex, k) => {
    starters[slotIndex] = sub.starters[k] ?? ''
  })
  return { ...lists, starters, bench: [...lockedBench, ...sub.bench] }
}

/** Sum of projections over the given ids; null when no id has a projection. */
export function projectedTotal(ids: string[], players: Record<string, LineupPlayerInfo | undefined>): number | null {
  let total = 0
  let any = false
  for (const id of ids) {
    const v = players[id]?.projectedPoints
    if (typeof v === 'number' && Number.isFinite(v)) {
      total += v
      any = true
    }
  }
  return any ? total : null
}
