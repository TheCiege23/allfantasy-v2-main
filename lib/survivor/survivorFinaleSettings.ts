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
 *  - finalJuryStepEnabled: false, finalJuryStepCount: 1 (current behaviour: the finale opens with
 *    whoever is left; no extra castaway joins the jury after the last immunity).
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
  /**
   * The original league's last step: after the final immunity ("closest without going over"), one
   * more castaway joins the jury instead of a Tribal vote. Off by default (current behaviour).
   * See survivorFinalJuryStep.ts.
   */
  finalJuryStepEnabled: boolean
  /** How many castaways that step sends to the jury (1 to SURVIVOR_FINAL_JURY_STEP_MAX). */
  finalJuryStepCount: number
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
export const SURVIVOR_FINAL_JURY_STEP_MAX = 2

export const SURVIVOR_FINALE_DEFAULTS: SurvivorFinaleSettings = {
  juryQuestionsEnabled: true,
  closingSpeechesEnabled: true,
  sealedImmunity: false,
  votesDueHoursBeforeCeremony: 0,
  endOfSeasonBallotReveal: false,
  reunionChatEnabled: true,
  finalJuryStepEnabled: false,
  finalJuryStepCount: 1,
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
  const extra = num(s.finalJuryStepCount)
  return {
    juryQuestionsEnabled: bool(s.juryQuestionsEnabled, base.juryQuestionsEnabled),
    closingSpeechesEnabled: bool(s.closingSpeechesEnabled, base.closingSpeechesEnabled),
    sealedImmunity: bool(s.sealedImmunity, base.sealedImmunity),
    votesDueHoursBeforeCeremony: hours == null ? base.votesDueHoursBeforeCeremony : Math.min(SURVIVOR_VOTES_DUE_MAX_HOURS, Math.max(0, Math.floor(hours))),
    endOfSeasonBallotReveal: bool(s.endOfSeasonBallotReveal, base.endOfSeasonBallotReveal),
    reunionChatEnabled: bool(s.reunionChatEnabled, base.reunionChatEnabled),
    finalJuryStepEnabled: bool(s.finalJuryStepEnabled, base.finalJuryStepEnabled),
    finalJuryStepCount: extra == null ? base.finalJuryStepCount : Math.min(SURVIVOR_FINAL_JURY_STEP_MAX, Math.max(1, Math.floor(extra))),
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

const BOOLEAN_KEYS = ['juryQuestionsEnabled', 'closingSpeechesEnabled', 'sealedImmunity', 'endOfSeasonBallotReveal', 'reunionChatEnabled', 'finalJuryStepEnabled'] as const

export type FinaleCopyLang = 'en' | 'es'

/** League.language → the finale copy language. */
export function finaleCopyLang(language: unknown): FinaleCopyLang {
  return String(language ?? '').toLowerCase().startsWith('es') ? 'es' : 'en'
}

/**
 * Every commissioner-facing finale validation message, English and Spanish (League.language).
 * The commissioner route's `finale_settings` / `finale_windows` refusals come from here.
 */
export const FINALE_VALIDATION_COPY = {
  en: {
    mustBeBoolean: (key: string) => `${key} must be true or false.`,
    votesDueRange: `votesDueHoursBeforeCeremony must be a whole number from 0 to ${SURVIVOR_VOTES_DUE_MAX_HOURS}.`,
    juryStepCountRange: `finalJuryStepCount must be a whole number from 1 to ${SURVIVOR_FINAL_JURY_STEP_MAX}.`,
    noSettings: 'No finale settings in the request.',
    mustBeDate: (key: string) => `${key} must be a date and time.`,
    mustBeFuture: (key: string) => `${key} must be in the future.`,
    noWindows: 'No finale windows in the request.',
    questionOrder: 'The question window must open before it closes.',
    answersAfterQuestions: 'Finalists need until at least the end of the question window to answer.',
    voteAfterSpeeches: 'The jury vote must close after the closing speeches.',
    crowned: 'The jury has already crowned a champion.',
    councilOpen: 'Sealed immunity and the vote due time change after the open Tribal Council finishes.',
    juryStepLocked: 'The final jury step cannot change once the finale has started.',
  },
  es: {
    mustBeBoolean: (key: string) => `${key} debe ser verdadero o falso.`,
    votesDueRange: `votesDueHoursBeforeCeremony debe ser un número entero de 0 a ${SURVIVOR_VOTES_DUE_MAX_HOURS}.`,
    juryStepCountRange: `finalJuryStepCount debe ser un número entero de 1 a ${SURVIVOR_FINAL_JURY_STEP_MAX}.`,
    noSettings: 'La solicitud no trae reglas de la final.',
    mustBeDate: (key: string) => `${key} debe ser una fecha y hora.`,
    mustBeFuture: (key: string) => `${key} debe estar en el futuro.`,
    noWindows: 'La solicitud no trae plazos de la final.',
    questionOrder: 'El plazo de preguntas debe abrir antes de cerrar.',
    answersAfterQuestions: 'Los finalistas necesitan al menos hasta el cierre de las preguntas para responder.',
    voteAfterSpeeches: 'La votación del jurado debe cerrar después de los discursos finales.',
    crowned: 'El jurado ya coronó a un campeón.',
    councilOpen: 'La inmunidad sellada y la hora límite de los votos cambian cuando termina el Consejo Tribal abierto.',
    juryStepLocked: 'El paso final del jurado no puede cambiar una vez empezada la final.',
  },
} as const

/** Validate a commissioner patch of the finale rules. Returns the keys to merge into League.settings. */
export function validateSurvivorFinaleSettingsPatch(input: unknown, lang: FinaleCopyLang = 'en'): { ok: true; patch: Partial<SurvivorFinaleSettings> } | { ok: false; error: string } {
  const copy = FINALE_VALIDATION_COPY[lang]
  const body = rec(input)
  const patch: Partial<SurvivorFinaleSettings> = {}
  for (const key of BOOLEAN_KEYS) {
    if (!(key in body)) continue
    if (typeof body[key] !== 'boolean') return { ok: false, error: copy.mustBeBoolean(key) }
    patch[key] = body[key] as boolean
  }
  if ('votesDueHoursBeforeCeremony' in body) {
    const n = body.votesDueHoursBeforeCeremony
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > SURVIVOR_VOTES_DUE_MAX_HOURS) {
      return { ok: false, error: copy.votesDueRange }
    }
    patch.votesDueHoursBeforeCeremony = n
  }
  if ('finalJuryStepCount' in body) {
    const n = body.finalJuryStepCount
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > SURVIVOR_FINAL_JURY_STEP_MAX) {
      return { ok: false, error: copy.juryStepCountRange }
    }
    patch.finalJuryStepCount = n
  }
  if (!Object.keys(patch).length) return { ok: false, error: copy.noSettings }
  return { ok: true, patch }
}

/** The final jury step decides who reaches the finale, so it cannot move once the finale has started. */
export const FINALE_SETTINGS_LOCKED_AFTER_FINALE_START: ReadonlyArray<keyof SurvivorFinaleSettings> = ['finalJuryStepEnabled', 'finalJuryStepCount']

export function finaleSettingsLockedAfterFinaleStart(patch: Partial<SurvivorFinaleSettings>, current: SurvivorFinaleSettings): Array<keyof SurvivorFinaleSettings> {
  return FINALE_SETTINGS_LOCKED_AFTER_FINALE_START.filter((key) => key in patch && patch[key] !== current[key])
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
  lang: FinaleCopyLang = 'en',
): { ok: true; windows: SurvivorFinaleWindows } | { ok: false; error: string } {
  const copy = FINALE_VALIDATION_COPY[lang]
  const body = rec(input)
  const next: SurvivorFinaleWindows = { ...current }
  let touched = false
  for (const key of WINDOW_KEYS) {
    if (!(key in body)) continue
    touched = true
    const raw = body[key]
    if (raw === null || raw === '') { next[key] = null; continue }
    const iso = isoOrNull(raw)
    if (!iso) return { ok: false, error: copy.mustBeDate(key) }
    next[key] = iso
  }
  if (!touched) return { ok: false, error: copy.noWindows }
  const t = (v: string | null) => (v ? new Date(v).getTime() : null)
  for (const key of ['questionsDeadline', 'answersDeadline', 'speechesDeadline'] as const) {
    if (key in body && next[key] && t(next[key])! <= now.getTime()) return { ok: false, error: copy.mustBeFuture(key) }
  }
  if (next.questionsOpenAt && next.questionsDeadline && t(next.questionsOpenAt)! >= t(next.questionsDeadline)!) {
    return { ok: false, error: copy.questionOrder }
  }
  if (next.questionsDeadline && next.answersDeadline && t(next.answersDeadline)! < t(next.questionsDeadline)!) {
    return { ok: false, error: copy.answersAfterQuestions }
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
