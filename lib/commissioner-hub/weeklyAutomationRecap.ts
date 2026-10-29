/**
 * "What AllFantasy did this week" — one message to the commissioner summing up the automations' own
 * actions over the past week (phase 9, 2026-10-29). Each action already lands as its own notification
 * or log row; this is the weekly view of them, so a commissioner can see the league running itself.
 *
 * Counted from the rows the automations write — `automation_audit_logs` (lineup saves), the league
 * audit log (Chimmy's claims, tanking steps, mode changes) and draft picks made with `source = 'auto'`.
 * Nothing is counted that is not recorded, so a line is never an estimate. A week with nothing to report
 * sends nothing.
 *
 * Pure.
 */

export type RecapCounts = {
  emptySpotsFilled: number
  byesBenched: number
  managedLineupsSet: number
  eliminatedLineupsFilled: number
  irMoves: number
  autopilotClaims: number
  autoPicks: number
  tankingWarnings: number
  tankingPenalties: number
  newOwnerHandovers: number
  autoHandovers: number
}

export const EMPTY_RECAP: RecapCounts = {
  emptySpotsFilled: 0,
  byesBenched: 0,
  managedLineupsSet: 0,
  eliminatedLineupsFilled: 0,
  irMoves: 0,
  autopilotClaims: 0,
  autoPicks: 0,
  tankingWarnings: 0,
  tankingPenalties: 0,
  newOwnerHandovers: 0,
  autoHandovers: 0,
}

/** Which recorded action counts toward which line. Automation-log `action` and league-audit `actionType`. */
export const RECAP_ACTIONS: Record<string, keyof RecapCounts> = {
  'fill_empty_starters.applied': 'emptySpotsFilled',
  'auto_bench_bye.applied': 'byesBenched',
  'inactive_manager.lineup_set': 'managedLineupsSet',
  'eliminated_lineup.filled': 'eliminatedLineupsFilled',
  'ir_auto_move.moved': 'irMoves',
  'chimmy_autopilot.claim': 'autopilotClaims',
  'integrity.tanking_warning': 'tankingWarnings',
  'integrity.tanking_strike': 'tankingWarnings',
  'integrity.tanking_pick_forfeited': 'tankingPenalties',
  'integrity.tanking_lottery_odds_cut': 'tankingPenalties',
  'integrity.tanking_faab_taken': 'tankingPenalties',
  'inactive_manager_mode.ended_new_owner': 'newOwnerHandovers',
  'inactive_manager_mode.auto_handover': 'autoHandovers',
}

export function countRecapActions(actions: ReadonlyArray<{ action: string; n: number }>, autoPicks: number): RecapCounts {
  const out: RecapCounts = { ...EMPTY_RECAP, autoPicks }
  for (const { action, n } of actions) {
    const key = RECAP_ACTIONS[action]
    if (key) out[key] += n
  }
  return out
}

export type RecapLanguage = 'en' | 'es'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The lines the commissioner reads, most common first; empty when there is nothing to report. */
export function recapLines(c: RecapCounts, lang: RecapLanguage = 'en'): string[] {
  const es = lang === 'es'
  const lines: Array<[number, string]> = es
    ? [
        [c.emptySpotsFilled, `llenó ${plural(c.emptySpotsFilled, 'puesto titular vacío', 'puestos titulares vacíos')}`],
        [c.byesBenched, `mandó a la banca a titulares en semana de descanso, ${plural(c.byesBenched, 'vez', 'veces')}, para quienes lo pidieron`],
        [c.managedLineupsSet, `puso ${plural(c.managedLineupsSet, 'alineación', 'alineaciones')} de equipos que maneja`],
        [c.eliminatedLineupsFilled, `completó alineaciones de equipos eliminados ${plural(c.eliminatedLineupsFilled, 'vez', 'veces')}`],
        [c.irMoves, `sacó de IR a ${plural(c.irMoves, 'jugador sano', 'jugadores sanos')}`],
        [c.autopilotClaims, `hizo ${plural(c.autopilotClaims, 'reclamo', 'reclamos')} para equipos con piloto automático de Chimmy`],
        [c.autoPicks, `hizo ${plural(c.autoPicks, 'selección', 'selecciones')} del draft por mánagers ausentes`],
        [c.tankingWarnings, `envió ${plural(c.tankingWarnings, 'aviso de tanking', 'avisos de tanking')}`],
        [c.tankingPenalties, `aplicó ${plural(c.tankingPenalties, 'sanción por tanking', 'sanciones por tanking')} que elegiste`],
        [c.newOwnerHandovers, `devolvió ${plural(c.newOwnerHandovers, 'equipo', 'equipos')} a un nuevo dueño`],
        [c.autoHandovers, `se hizo cargo de ${plural(c.autoHandovers, 'equipo', 'equipos')} sin actividad, como lo configuraste`],
      ]
    : [
        [c.emptySpotsFilled, `filled ${plural(c.emptySpotsFilled, 'empty starting spot', 'empty starting spots')}`],
        [c.byesBenched, `benched starters on bye for managers who asked, ${plural(c.byesBenched, 'time', 'times')}`],
        [c.managedLineupsSet, `set ${plural(c.managedLineupsSet, 'lineup', 'lineups')} for teams it runs`],
        [c.eliminatedLineupsFilled, `filled short lineups for eliminated teams ${plural(c.eliminatedLineupsFilled, 'time', 'times')}`],
        [c.irMoves, `moved ${plural(c.irMoves, 'healthy player', 'healthy players')} off IR`],
        [c.autopilotClaims, `made ${plural(c.autopilotClaims, 'waiver claim', 'waiver claims')} for teams on Chimmy autopilot`],
        [c.autoPicks, `made ${plural(c.autoPicks, 'draft pick', 'draft picks')} for managers who were not there`],
        [c.tankingWarnings, `sent ${plural(c.tankingWarnings, 'tanking warning', 'tanking warnings')}`],
        [c.tankingPenalties, `applied ${plural(c.tankingPenalties, 'tanking penalty', 'tanking penalties')} you chose`],
        [c.newOwnerHandovers, `handed ${plural(c.newOwnerHandovers, 'team', 'teams')} back to a new owner`],
        [c.autoHandovers, `took over ${plural(c.autoHandovers, 'team', 'teams')} with no activity, as you set up`],
      ]
  return lines.filter(([n]) => n > 0).sort((a, b) => b[0] - a[0]).map(([, text]) => text)
}

/** Recaps go out on Mondays (UTC): the hourly run tries each hour of that day; the week's recap is sent once. */
export function isRecapDay(now: Date): boolean {
  return now.getUTCDay() === 1
}

/** The week just finished: Monday 00:00 UTC to the next Monday, for a run at any time in the week after. */
export function previousRecapWeek(now: Date): { start: Date; end: Date; key: string } {
  const day = now.getUTCDay() // 0 Sunday … 6 Saturday
  const sinceMonday = (day + 6) % 7
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - sinceMonday))
  const start = new Date(end.getTime() - 7 * 86_400_000)
  return { start, end, key: start.toISOString().slice(0, 10) }
}

export function recapMessage(leagueName: string, lines: readonly string[], lang: RecapLanguage = 'en'): { title: string; body: string } {
  const es = lang === 'es'
  const and = es ? 'y' : 'and'
  const joined = lines.length === 1 ? lines[0] : `${lines.slice(0, -1).join('; ')}; ${and} ${lines[lines.length - 1]}`
  return es
    ? { title: `Lo que hizo AllFantasy esta semana · ${leagueName}`, body: `Esta semana AllFantasy ${joined}. Cada acción está en el registro de la liga.` }
    : { title: `What AllFantasy did this week · ${leagueName}`, body: `This week AllFantasy ${joined}. Every action is in the league log.` }
}
