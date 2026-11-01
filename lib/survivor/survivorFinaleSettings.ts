/**
 * Jury, finale and reunion rules (original-league fidelity, gap report §4 #39/#45, §6 #57–#62).
 * Pure: no I/O, safe on the client. Everything is read from `League.settings` JSON (top level, or
 * the nested `survivorFoundationSettings` snapshot) — no column, no migration.
 *
 * Two kinds of value live here and they are stored apart on purpose:
 *
 *  - RULES (`SurvivorFinaleSettings`): how this league plays its finale. Commissioner settings,
 *    saved through the commissioner route's `finale_settings` action. Every default keeps the
 *    behaviour a league had before these rules existed, except the reunion (see below).
 *  - WINDOWS (`SurvivorFinaleWindows`, key `survivorFinaleWindows`): this season's live timers for
 *    the jury Q&A and the closing speeches. Saved through `finale_windows`. Nothing set means "open
 *    while the finale is open", which is what the jury page did before.
 *
 * DEFAULTS
 *  - juryQuestionsEnabled: true. No window set means a juror may ask while the finale is open.
 *  - closingSpeechesEnabled: true. With no speech window the jury vote is NOT held back (current
 *    behaviour); with one, jury voting opens when it closes (the original rule).
 *  - sealedImmunity: false (current behaviour: the immunity winner is public at once).
 *  - votesDueHoursBeforeCeremony: 0 (current behaviour: ballots are due at the ceremony).
 *  - endOfSeasonBallotReveal: false (opt-in).
 *  - reunionChatEnabled: true. The task asks for the reunion to reopen automatically; it can only
 *    happen after a champion is crowned, so no running season changes.
 */

export interface SurvivorFinaleSettings {
  /** Jurors may ask each finalist one question. */
  juryQuestionsEnabled: boolean
  /** Each finalist posts one closing statement before jury voting. */
  closingSpeechesEnabled: boolean
  /** Individual immunity stays hidden until every vote is cast (then read with the votes). */
  sealedImmunity: boolean
  /** Ballots are due this many hours before the Tribal ceremony. 0 = at the ceremony. */
  votesDueHoursBeforeCeremony: number
  /** After the season is complete, show who voted for whom at every council. Never before. */
  endOfSeasonBallotReveal: boolean
  /** After the finale, the league chat reopens to everyone, voted-out managers and jury included. */
  reunionChatEnabled: boolean
}

export interface SurvivorFinaleWindows {
  /** Jurors may ask from this moment (null = as soon as the finale opens). */
  questionsOpenAt: string | null
  /** Jurors may ask until this moment (mirrored to JurySession.questionsDeadline). */
  questionsDeadline: string | null
  /** Finalists may answer until this moment (null = until the jury vote is complete). */
  answersDeadline: string | null
  /** Closing speeches are editable until this moment; jury voting opens when it passes. */
  speechesDeadline: string | null
}

export const SURVIVOR_FINALE_SETTINGS_KEY_WINDOWS = 'survivorFinaleWindows'
export const SURVIVOR_VOTES_DUE_MAX_HOURS = 72
export const JURY_QUESTION_MAX_CHARS = 500
export const JURY_ANSWER_MAX_CHARS = 1000
export const CLOSING_SPEECH_MAX_CHARS = 2000

export const SURVIVOR_FINALE_DEFAULTS: SurvivorFinaleSettings = {
  juryQuestionsEnabled: true,
  closingSpeechesEnabled: true,
  sealedImmunity: false,
  votesDueHoursBeforeCeremony: 0,
  endOfSeasonBallotReveal: false,
  reunionChatEnabled: true,
}

export const EMPTY_FINALE_WINDOWS: SurvivorFinaleWindows = {
  questionsOpenAt: null,
  questionsDeadline: null,
  answersDeadline: null,
  speechesDeadline: null,
}

type Rec = Record<string, unknown>

function rec(value: unknown): Rec {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : {}
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function readSurvivorFinaleSettings(settings: unknown): SurvivorFinaleSettings {
  const top = rec(settings)
  const s = { ...rec(top.survivorFoundationSettings), ...top }
  const base = SURVIVOR_FINALE_DEFAULTS
  const hours = num(s.votesDueHoursBeforeCeremony)
  return {
    juryQuestionsEnabled: bool(s.juryQuestionsEnabled, base.juryQuestionsEnabled),
    closingSpeechesEnabled: bool(s.closingSpeechesEnabled, base.closingSpeechesEnabled),
    sealedImmunity: bool(s.sealedImmunity, base.sealedImmunity),
    votesDueHoursBeforeCeremony: hours == null ? base.votesDueHoursBeforeCeremony : Math.min(SURVIVOR_VOTES_DUE_MAX_HOURS, Math.max(0, Math.floor(hours))),
    endOfSeasonBallotReveal: bool(s.endOfSeasonBallotReveal, base.endOfSeasonBallotReveal),
    reunionChatEnabled: bool(s.reunionChatEnabled, base.reunionChatEnabled),
  }
}

export function readSurvivorFinaleWindows(settings: unknown): SurvivorFinaleWindows {
  const w = rec(rec(settings)[SURVIVOR_FINALE_SETTINGS_KEY_WINDOWS])
  return {
    questionsOpenAt: isoOrNull(w.questionsOpenAt),
    questionsDeadline: isoOrNull(w.questionsDeadline),
    answersDeadline: isoOrNull(w.answersDeadline),
    speechesDeadline: isoOrNull(w.speechesDeadline),
  }
}

const BOOLEAN_KEYS = ['juryQuestionsEnabled', 'closingSpeechesEnabled', 'sealedImmunity', 'endOfSeasonBallotReveal', 'reunionChatEnabled'] as const

/** Validate a commissioner patch of the finale rules. Returns the keys to merge into League.settings. */
export function validateSurvivorFinaleSettingsPatch(input: unknown): { ok: true; patch: Partial<SurvivorFinaleSettings> } | { ok: false; error: string } {
  const body = rec(input)
  const patch: Partial<SurvivorFinaleSettings> = {}
  for (const key of BOOLEAN_KEYS) {
    if (!(key in body)) continue
    if (typeof body[key] !== 'boolean') return { ok: false, error: `${key} must be true or false.` }
    patch[key] = body[key] as boolean
  }
  if ('votesDueHoursBeforeCeremony' in body) {
    const n = body.votesDueHoursBeforeCeremony
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > SURVIVOR_VOTES_DUE_MAX_HOURS) {
      return { ok: false, error: `votesDueHoursBeforeCeremony must be a whole number from 0 to ${SURVIVOR_VOTES_DUE_MAX_HOURS}.` }
    }
    patch.votesDueHoursBeforeCeremony = n
  }
  if (!Object.keys(patch).length) return { ok: false, error: 'No finale settings in the request.' }
  return { ok: true, patch }
}

/**
 * The finale rules that would change the council in progress. Sealed immunity and the ballot due
 * time decide what a ballot shows and whether it counts, so they cannot move while a council is
 * open; everything else is safe all season.
 */
export const FINALE_SETTINGS_LOCKED_DURING_COUNCIL: ReadonlyArray<keyof SurvivorFinaleSettings> = ['sealedImmunity', 'votesDueHoursBeforeCeremony']

export function finaleSettingsLockedDuringCouncil(patch: Partial<SurvivorFinaleSettings>, current: SurvivorFinaleSettings): Array<keyof SurvivorFinaleSettings> {
  return FINALE_SETTINGS_LOCKED_DURING_COUNCIL.filter((key) => key in patch && patch[key] !== current[key])
}

const WINDOW_KEYS = ['questionsOpenAt', 'questionsDeadline', 'answersDeadline', 'speechesDeadline'] as const

/**
 * Validate the commissioner's finale windows. A key set to null clears that window. Order rules:
 * questions open < questions close <= answers close, and every set deadline lies in the future.
 */
export function validateFinaleWindowsPatch(
  input: unknown,
  current: SurvivorFinaleWindows,
  now: Date,
): { ok: true; windows: SurvivorFinaleWindows } | { ok: false; error: string } {
  const body = rec(input)
  const next: SurvivorFinaleWindows = { ...current }
  let touched = false
  for (const key of WINDOW_KEYS) {
    if (!(key in body)) continue
    touched = true
    const raw = body[key]
    if (raw === null || raw === '') { next[key] = null; continue }
    const iso = isoOrNull(raw)
    if (!iso) return { ok: false, error: `${key} must be a date and time.` }
    next[key] = iso
  }
  if (!touched) return { ok: false, error: 'No finale windows in the request.' }
  const t = (v: string | null) => (v ? new Date(v).getTime() : null)
  for (const key of ['questionsDeadline', 'answersDeadline', 'speechesDeadline'] as const) {
    if (key in body && next[key] && t(next[key])! <= now.getTime()) return { ok: false, error: `${key} must be in the future.` }
  }
  if (next.questionsOpenAt && next.questionsDeadline && t(next.questionsOpenAt)! >= t(next.questionsDeadline)!) {
    return { ok: false, error: 'The question window must open before it closes.' }
  }
  if (next.questionsDeadline && next.answersDeadline && t(next.answersDeadline)! < t(next.questionsDeadline)!) {
    return { ok: false, error: 'Finalists need until at least the end of the question window to answer.' }
  }
  return { ok: true, windows: next }
}

export type WindowState = 'not_yet' | 'open' | 'closed'

function windowState(openAt: string | null, closeAt: string | null, now: Date): WindowState {
  if (openAt && now.getTime() < new Date(openAt).getTime()) return 'not_yet'
  if (closeAt && now.getTime() >= new Date(closeAt).getTime()) return 'closed'
  return 'open'
}

export function juryQuestionWindow(windows: SurvivorFinaleWindows, now: Date): WindowState {
  return windowState(windows.questionsOpenAt, windows.questionsDeadline, now)
}

export function finalistAnswerWindow(windows: SurvivorFinaleWindows, now: Date): WindowState {
  return windowState(windows.questionsOpenAt, windows.answersDeadline, now)
}

export function closingSpeechWindow(windows: SurvivorFinaleWindows, now: Date): WindowState {
  return windowState(null, windows.speechesDeadline, now)
}

/**
 * Jury voting waits for the closing speeches only when the commissioner set a speech window and
 * speeches are on. With no window it is never held back, so an existing league votes as before.
 */
export function juryVotingHeldForSpeeches(settings: Pick<SurvivorFinaleSettings, 'closingSpeechesEnabled'>, windows: SurvivorFinaleWindows, now: Date): boolean {
  return settings.closingSpeechesEnabled && Boolean(windows.speechesDeadline) && closingSpeechWindow(windows, now) === 'open'
}

/** When ballots are due: N hours before the ceremony (the council's close). 0 = at the ceremony. */
export function ballotsDueAt(ceremonyAt: Date, hoursBefore: number): Date {
  const hours = Number.isFinite(hoursBefore) ? Math.max(0, Math.min(SURVIVOR_VOTES_DUE_MAX_HOURS, Math.floor(hoursBefore))) : 0
  return new Date(ceremonyAt.getTime() - hours * 3_600_000)
}
