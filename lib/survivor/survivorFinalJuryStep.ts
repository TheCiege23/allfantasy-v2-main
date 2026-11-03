/**
 * The final jury step — "add one more person to the jury" (original league, the finale).
 * Pure: no I/O. The server half is survivorFinalJuryStepService.ts; the season runner calls it.
 *
 * THE RULE
 *  In the original league the last immunity is "closest to the score without going over"
 *  (survivorClosestWithoutGoingOver.ts). No Tribal follows it: the castaway(s) who did worst in that
 *  challenge join the jury, and everyone else is a finalist. With the setting on
 *  (`finalJuryStepEnabled`, `finalJuryStepCount`, survivorFinaleSettings.ts):
 *
 *   1. Once the merged cast is down to `finalistCount + finalJuryStepCount`, the planned season stops
 *      holding Tribal Councils (`finalJuryStepSkipsCouncil`) — the step brings the cast down instead.
 *   2. The commissioner runs the last immunity with the challenge builder (kind
 *      `closest_without_going_over`, individual). When it is settled, the immunity winner is safe.
 *   3. The others are ranked by the same rule the challenge uses (highest guess not over the target,
 *      earliest submission on a tie; over-guessers after, smallest overshoot first). A castaway who did
 *      not answer ranks last; among non-answerers the order is by roster id, so it is deterministic.
 *   4. The bottom `finalJuryStepCount` of that ranking join the jury. They ask questions and vote like
 *      every juror, because the jury is the SurvivorJuryMember table and the finale reads it.
 *
 *  Applied once per season (an audit entry is the gate), so a re-run is a no-op.
 */

import { settleClosestWithoutGoingOver, type ClosestEntry } from './survivorClosestWithoutGoingOver'
import type { SurvivorFinaleSettings } from './survivorFinaleSettings'

export type FinalJuryStepSettings = Pick<SurvivorFinaleSettings, 'finalJuryStepEnabled' | 'finalJuryStepCount'>

export interface FinalJuryStepChallenge {
  challengeId: string
  /** The settled target (resultJson.truth.value). Null when not settled from a number. */
  target: number | null
  /** Immunity the settlement paid (resultJson.immunityRosterIds). */
  immunityRosterIds: readonly string[]
  /** One entry per roster: `userId` carries the ROSTER id here (the builder's individual entrant). */
  entries: readonly ClosestEntry[]
  allOverRule?: 'closest_overall' | 'no_winner'
}

export type FinalJuryStepPlan =
  | { status: 'off' }
  | { status: 'done' }
  | { status: 'not_due'; active: number; dueAt: number }
  | { status: 'awaiting_immunity'; dueAt: number }
  | { status: 'apply'; challengeId: string; immuneRosterId: string | null; ranking: string[]; cutRosterIds: string[] }

/** The cast size at which the step is due: the finalists plus the castaways who join the jury. */
export function finalJuryStepDueAt(settings: FinalJuryStepSettings, finalistCount: number): number {
  return finalistCount + Math.max(1, settings.finalJuryStepCount)
}

/**
 * True when a planned Tribal Council should NOT open because the final jury step will cut the cast
 * instead: the step is on, the cast is merged, and the cast is already at or below the step's size
 * (but still above the finalist count).
 */
export function finalJuryStepSkipsCouncil(settings: FinalJuryStepSettings, input: { finalistCount: number; activeCount: number; merged: boolean; applied: boolean }): boolean {
  if (!settings.finalJuryStepEnabled || !input.merged || input.applied) return false
  return input.activeCount > input.finalistCount && input.activeCount <= finalJuryStepDueAt(settings, input.finalistCount)
}

/** Best first. Answered castaways by the challenge rule, then non-answerers by roster id. */
export function rankFinalJuryStep(activeRosterIds: readonly string[], challenge: FinalJuryStepChallenge): string[] {
  const active = new Set(activeRosterIds)
  if (challenge.target == null) return [...active].sort()
  const entries = challenge.entries.filter((e) => active.has(e.userId))
  const settled = settleClosestWithoutGoingOver(entries, challenge.target, { allOverRule: challenge.allOverRule })
  const ranked = settled.ranked.map((r) => r.userId)
  const answered = new Set(ranked)
  return [...ranked, ...[...active].filter((id) => !answered.has(id)).sort()]
}

export function planFinalJuryStep(input: {
  settings: FinalJuryStepSettings
  finalistCount: number
  merged: boolean
  applied: boolean
  activeRosterIds: readonly string[]
  /** This week's settled closest-without-going-over challenge, if any. */
  challenge: FinalJuryStepChallenge | null
}): FinalJuryStepPlan {
  if (!input.settings.finalJuryStepEnabled) return { status: 'off' }
  if (input.applied) return { status: 'done' }
  const dueAt = finalJuryStepDueAt(input.settings, input.finalistCount)
  const active = [...new Set(input.activeRosterIds)]
  if (!input.merged || active.length !== dueAt) return { status: 'not_due', active: active.length, dueAt }
  if (!input.challenge || input.challenge.target == null) return { status: 'awaiting_immunity', dueAt }
  const ranking = rankFinalJuryStep(active, input.challenge)
  const immuneRosterId = input.challenge.immunityRosterIds.find((id) => active.includes(id)) ?? null
  const contenders = ranking.filter((id) => id !== immuneRosterId)
  const cut = contenders.slice(Math.max(0, contenders.length - (dueAt - input.finalistCount)))
  return { status: 'apply', challengeId: input.challenge.challengeId, immuneRosterId, ranking, cutRosterIds: cut }
}

type Lang = 'en' | 'es'

/** The public host line. Names the new jurors only — never the immunity winner (sealed immunity). */
export function finalJuryStepAnnouncement(names: readonly string[], lang: Lang = 'en'): string {
  const list = names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} ${lang === 'es' ? 'y' : 'and'} ${names[names.length - 1]}`
  if (lang === 'es') {
    return names.length === 1
      ? `Tras la última inmunidad, ${list} se une al jurado. Los demás pasan a la final.`
      : `Tras la última inmunidad, ${list} se unen al jurado. Los demás pasan a la final.`
  }
  return names.length === 1
    ? `After the last immunity, ${list} joins the jury. Everyone else goes to the finale.`
    : `After the last immunity, ${list} join the jury. Everyone else goes to the finale.`
}

/** The rules line Chimmy and the rulebook use. Null when the step is off. */
export function finalJuryStepRulesLine(settings: FinalJuryStepSettings, lang: Lang = 'en'): string | null {
  if (!settings.finalJuryStepEnabled) return null
  const n = Math.max(1, settings.finalJuryStepCount)
  if (lang === 'es') {
    return n === 1
      ? 'Después de la última inmunidad (lo más cerca del marcador sin pasarse), una persona más se une al jurado: quien quede más lejos en ese reto, sin Consejo Tribal. Quien gana la inmunidad está a salvo; si no respondes, quedas el último.'
      : `Después de la última inmunidad (lo más cerca del marcador sin pasarse), ${n} personas más se unen al jurado: las que queden más lejos en ese reto, sin Consejo Tribal. Quien gana la inmunidad está a salvo; si no respondes, quedas el último.`
  }
  return n === 1
    ? 'After the last immunity (closest to the score without going over), one more person joins the jury: whoever finishes furthest from it in that challenge, with no Tribal Council. The immunity winner is safe; not answering ranks you last.'
    : `After the last immunity (closest to the score without going over), ${n} more people join the jury: whoever finishes furthest from it in that challenge, with no Tribal Council. The immunity winner is safe; not answering ranks you last.`
}
