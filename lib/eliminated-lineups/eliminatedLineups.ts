/**
 * LINEUP MINIMUMS FOR ELIMINATED TEAMS — a team out of the playoff race still owes the league a real
 * lineup, because the teams still racing have to beat it. AF Commissioner.
 *
 * The rule is the commissioner's, in `League.settings.eliminated_lineup_minimum`:
 *   standard   'filled'    no empty starting slot
 *              'playable'  no empty slot, no starter on a bye, no starter listed Out / IR
 *   autoFill   AllFantasy fills only the slots that miss the standard, from the team's own bench, an
 *              hour at a time before kickoff. A starter who meets the standard is never moved.
 *
 * WHO IS ELIMINATED. Only what standings make certain, never an odds model:
 *   cannot_reach_line   in the regular season, more wins behind the last playoff spot than games left
 *                       to play — the same arithmetic as lib/trade-intel/contention.ts. The line team's
 *                       wins can only go up, so this cannot be undone by results.
 *   missed_playoffs     from the first playoff week, a team without a playoff seed: it is playing for
 *                       the consolation bracket, or for nothing, while the field plays for the title.
 * ⚠ BEFORE THE SEEDS ARE SET IN A PLAYOFF WEEK NOBODY IS CALLED ELIMINATED: "no seed" is not yet a fact.
 *
 * ⚠ "OUT / IR" IS READ NOW, BEFORE KICKOFF, WHICH IS WHEN IT IS A FACT. The lineup-integrity monitor
 * (lib/lineup-integrity) treats it as a soft signal because it reads it after the week; here it is the
 * status the manager would see on their own lineup screen. A starter whose game has started is left
 * out of the check — nobody can change him.
 *
 * Pure.
 */
import { isRuledOut } from '@/lib/core-app/injuryStatus'

export const ELIMINATED_LINEUP_RULE_KEY = 'eliminated_lineup_minimum'

export type LineupStandard = 'filled' | 'playable'
export const LINEUP_STANDARDS: readonly LineupStandard[] = ['filled', 'playable']

export type EliminatedLineupRule = { standard: LineupStandard; autoFill: boolean }

const isStandard = (v: unknown): v is LineupStandard => typeof v === 'string' && (LINEUP_STANDARDS as readonly string[]).includes(v)

/** The league's rule, or null when it is off. An unreadable value reads as off, never as a guess. */
export function readEliminatedLineupRule(settings: unknown): EliminatedLineupRule | null {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[ELIMINATED_LINEUP_RULE_KEY] : null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (o.enabled !== true || !isStandard(o.standard)) return null
  return { standard: o.standard, autoFill: o.autoFill === true }
}

/** What a save may store: the rule switched on (with its standard), or off. */
export function parseEliminatedLineupRule(
  input: unknown,
): { ok: true; value: { enabled: true; standard: LineupStandard; autoFill: boolean } | { enabled: false } } | { ok: false; error: string } {
  if (input == null || input === false) return { ok: true, value: { enabled: false } }
  if (typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Send the lineup minimum as { enabled, standard, autoFill }.' }
  const o = input as Record<string, unknown>
  if (o.enabled === false) return { ok: true, value: { enabled: false } }
  if (o.enabled !== true) return { ok: false, error: 'Say whether the lineup minimum is on.' }
  if (!isStandard(o.standard)) return { ok: false, error: 'Pick a standard: "filled" (no empty slots) or "playable" (no empty slots, byes or Out/IR starters).' }
  if (o.autoFill !== undefined && typeof o.autoFill !== 'boolean') return { ok: false, error: 'autoFill is on or off.' }
  return { ok: true, value: { enabled: true, standard: o.standard, autoFill: o.autoFill === true } }
}

export type StandingTeam = { rosterId: string; wins: number; losses: number; ties: number; playoffSeed: number | null }
export type EliminationReason = 'cannot_reach_line' | 'missed_playoffs'

/**
 * The teams out of the race this week (see the header). `currentWeek` is the week being played;
 * `playoffStartWeek` the first playoff week.
 */
export function eliminatedTeams(input: {
  teams: readonly StandingTeam[]
  playoffTeams: number
  playoffStartWeek: number
  currentWeek: number
}): Map<string, EliminationReason> {
  const out = new Map<string, EliminationReason>()
  const { teams, playoffTeams, playoffStartWeek, currentWeek } = input
  if (playoffTeams <= 0 || playoffTeams >= teams.length || playoffStartWeek <= 0 || currentWeek <= 0) return out

  if (currentWeek >= playoffStartWeek) {
    if (!teams.some((t) => t.playoffSeed != null)) return out
    for (const t of teams) if (t.playoffSeed == null) out.set(t.rosterId, 'missed_playoffs')
    return out
  }

  const line = (t: StandingTeam) => t.wins + t.ties / 2
  const lineWins = [...teams].map(line).sort((a, b) => b - a)[playoffTeams - 1]!
  // This week and every regular-season week after it.
  const gamesLeft = playoffStartWeek - currentWeek
  for (const t of teams) if (lineWins - line(t) > gamesLeft) out.set(t.rosterId, 'cannot_reach_line')
  return out
}

/** One starting slot as the check sees it; null is an empty slot. */
export type StarterCheck = {
  playerId: string
  byeWeek: number | null
  injuryStatus: string | null
  /** His game has started: he cannot be moved, so he is not held against the lineup. */
  started: boolean
} | null

export type LineupShortfall = { emptySlots: number; byeStarters: string[]; outStarters: string[] }

export function lineupShortfall(input: { starters: readonly StarterCheck[]; week: number; standard: LineupStandard }): LineupShortfall {
  const s: LineupShortfall = { emptySlots: 0, byeStarters: [], outStarters: [] }
  for (const st of input.starters) {
    if (!st) {
      s.emptySlots++
      continue
    }
    if (input.standard === 'filled' || st.started) continue
    if (st.byeWeek != null && st.byeWeek === input.week) s.byeStarters.push(st.playerId)
    else if (isRuledOut(st.injuryStatus)) s.outStarters.push(st.playerId)
  }
  return s
}

export function meetsMinimum(s: LineupShortfall): boolean {
  return s.emptySlots === 0 && s.byeStarters.length === 0 && s.outStarters.length === 0
}

/** Starters who miss the standard — the only ones a fill may move. */
export function failingStarters(s: LineupShortfall): Set<string> {
  return new Set([...s.byeStarters, ...s.outStarters])
}

/** "1 empty slot; Travis Kelce on a bye; Joe Mixon listed Out/IR", in either language. */
export function describeShortfall(s: LineupShortfall, name: (playerId: string) => string, language: 'en' | 'es' = 'en'): string {
  const es = language === 'es'
  const parts: string[] = []
  if (s.emptySlots > 0) {
    parts.push(es ? `${s.emptySlots} ${s.emptySlots === 1 ? 'puesto vacío' : 'puestos vacíos'}` : `${s.emptySlots} empty ${s.emptySlots === 1 ? 'slot' : 'slots'}`)
  }
  if (s.byeStarters.length) parts.push(`${s.byeStarters.map(name).join(', ')} ${es ? 'en semana de descanso' : 'on a bye'}`)
  if (s.outStarters.length) parts.push(`${s.outStarters.map(name).join(', ')} ${es ? 'listado Out/IR' : 'listed Out/IR'}`)
  return parts.join('; ')
}

/** The rule in one sentence, for the league page and Chimmy. */
export function describeRule(rule: EliminatedLineupRule, language: 'en' | 'es' = 'en'): string {
  const es = language === 'es'
  const standard =
    rule.standard === 'filled'
      ? es ? 'sin puestos vacíos' : 'with no empty slots'
      : es ? 'sin puestos vacíos, jugadores en descanso ni jugadores Out/IR' : 'with no empty slots, no starters on a bye and no starters listed Out/IR'
  const fill = rule.autoFill
    ? es
      ? ' Si falta algo antes del inicio, AllFantasy cubre solo esos puestos con la banca del equipo.'
      : ' If one falls short before kickoff, AllFantasy fills only those slots from the team’s own bench.'
    : ''
  return es
    ? `Regla de la liga: un equipo eliminado de la carrera por los playoffs debe alinear un equipo completo ${standard}.${fill}`
    : `League rule: a team out of the playoff race must still start a lineup ${standard}.${fill}`
}
