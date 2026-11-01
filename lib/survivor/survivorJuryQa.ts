/**
 * Jury Q&A and closing speeches — pure rules (no DB). The service (survivorJuryQaService.ts) stores
 * every step as an append-only SurvivorAuditLog event and folds them here, so there is no new table:
 *
 *   jury_question_asked     { jurorRosterId, finalistRosterId, text }   one per juror per finalist
 *   jury_question_answered  { jurorRosterId, finalistRosterId, text }   editable until the answer window closes
 *   jury_answer_seen        { jurorRosterId, finalistRosterId }         the juror confirms they read it
 *   finalist_closing_speech { finalistRosterId, text }                  one post, editable until the speech window closes
 *
 * The original league's rule (gap report §6 #57): "one question… per finalist", inside a window the
 * host sets; finalists must respond. A question is keyed by (juror, finalist), so a second ask is
 * refused rather than overwriting the first — "I will always take the first submission".
 */

import {
  CLOSING_SPEECH_MAX_CHARS,
  JURY_ANSWER_MAX_CHARS,
  JURY_QUESTION_MAX_CHARS,
  type WindowState,
} from './survivorFinaleSettings'

export const JURY_QA_EVENT_TYPES = ['jury_question_asked', 'jury_question_answered', 'jury_answer_seen', 'finalist_closing_speech'] as const
export type JuryQaEventType = (typeof JURY_QA_EVENT_TYPES)[number]

export interface JuryQaEvent {
  eventType: string
  metadata: unknown
  createdAt: Date
}

export interface JuryQuestion {
  id: string
  jurorRosterId: string
  finalistRosterId: string
  question: string
  askedAt: string
  answer: string | null
  answeredAt: string | null
  seenAt: string | null
}

export interface ClosingSpeech {
  finalistRosterId: string
  text: string
  postedAt: string
  updatedAt: string
}

export interface JuryQaState {
  questions: JuryQuestion[]
  speeches: ClosingSpeech[]
}

export function juryQuestionId(jurorRosterId: string, finalistRosterId: string): string {
  return `${jurorRosterId}:${finalistRosterId}`
}

function str(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Fold the events (any order) into the current Q&A state. Oldest event first wins for a question. */
export function foldJuryQa(events: ReadonlyArray<JuryQaEvent>): JuryQaState {
  const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const questions = new Map<string, JuryQuestion>()
  const speeches = new Map<string, ClosingSpeech>()
  for (const event of sorted) {
    const meta = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata) ? (event.metadata as Record<string, unknown>) : {}
    const at = event.createdAt.toISOString()
    if (event.eventType === 'finalist_closing_speech') {
      const finalistRosterId = str(meta, 'finalistRosterId')
      const text = str(meta, 'text')
      if (!finalistRosterId || !text) continue
      const prior = speeches.get(finalistRosterId)
      speeches.set(finalistRosterId, { finalistRosterId, text, postedAt: prior?.postedAt ?? at, updatedAt: at })
      continue
    }
    const jurorRosterId = str(meta, 'jurorRosterId')
    const finalistRosterId = str(meta, 'finalistRosterId')
    if (!jurorRosterId || !finalistRosterId) continue
    const id = juryQuestionId(jurorRosterId, finalistRosterId)
    const existing = questions.get(id)
    if (event.eventType === 'jury_question_asked') {
      const text = str(meta, 'text')
      if (!text || existing) continue // first submission stands
      questions.set(id, { id, jurorRosterId, finalistRosterId, question: text, askedAt: at, answer: null, answeredAt: null, seenAt: null })
    } else if (event.eventType === 'jury_question_answered') {
      const text = str(meta, 'text')
      if (!existing || !text) continue
      // A new answer is a new message: the juror's "seen" applied to the old one.
      questions.set(id, { ...existing, answer: text, answeredAt: at, seenAt: existing.answer === text ? existing.seenAt : null })
    } else if (event.eventType === 'jury_answer_seen') {
      if (!existing || !existing.answer) continue
      questions.set(id, { ...existing, seenAt: existing.seenAt ?? at })
    }
  }
  return {
    questions: [...questions.values()].sort((a, b) => a.askedAt.localeCompare(b.askedAt) || a.id.localeCompare(b.id)),
    speeches: [...speeches.values()].sort((a, b) => a.finalistRosterId.localeCompare(b.finalistRosterId)),
  }
}

export type JuryQaRefusal =
  | 'disabled'
  | 'finale_not_open'
  | 'vote_complete'
  | 'not_juror'
  | 'not_finalist'
  | 'unknown_finalist'
  | 'window_not_open'
  | 'window_closed'
  | 'already_asked'
  | 'no_question'
  | 'not_answered'
  | 'empty'
  | 'too_long'

export interface JuryQaGate {
  enabled: boolean
  /** Finalists are set and no champion is crowned yet. */
  finaleOpen: boolean
  /** Every juror has voted or the deadline passed: the finale conversation is over. */
  voteComplete: boolean
  finalists: ReadonlyArray<string>
  jurors: ReadonlyArray<string>
  window: WindowState
}

function textRefusal(text: string, max: number): JuryQaRefusal | null {
  const trimmed = text.trim()
  if (!trimmed) return 'empty'
  if (trimmed.length > max) return 'too_long'
  return null
}

function liveRefusal(gate: JuryQaGate): JuryQaRefusal | null {
  if (!gate.enabled) return 'disabled'
  if (!gate.finaleOpen) return 'finale_not_open'
  if (gate.voteComplete) return 'vote_complete'
  if (gate.window === 'not_yet') return 'window_not_open'
  if (gate.window === 'closed') return 'window_closed'
  return null
}

export function refuseJuryQuestion(state: JuryQaState, gate: JuryQaGate, input: { jurorRosterId: string; finalistRosterId: string; text: string }): JuryQaRefusal | null {
  const live = liveRefusal(gate)
  if (live) return live
  if (!gate.jurors.includes(input.jurorRosterId)) return 'not_juror'
  if (!gate.finalists.includes(input.finalistRosterId)) return 'unknown_finalist'
  if (state.questions.some((q) => q.id === juryQuestionId(input.jurorRosterId, input.finalistRosterId))) return 'already_asked'
  return textRefusal(input.text, JURY_QUESTION_MAX_CHARS)
}

export function refuseFinalistAnswer(state: JuryQaState, gate: JuryQaGate, input: { finalistRosterId: string; jurorRosterId: string; text: string }): JuryQaRefusal | null {
  const live = liveRefusal(gate)
  if (live) return live
  if (!gate.finalists.includes(input.finalistRosterId)) return 'not_finalist'
  if (!state.questions.some((q) => q.id === juryQuestionId(input.jurorRosterId, input.finalistRosterId))) return 'no_question'
  return textRefusal(input.text, JURY_ANSWER_MAX_CHARS)
}

/** "Seen" is a read receipt: it is never refused for timing, only for who and what. */
export function refuseAnswerSeen(state: JuryQaState, gate: Pick<JuryQaGate, 'jurors'>, input: { jurorRosterId: string; finalistRosterId: string }): JuryQaRefusal | null {
  if (!gate.jurors.includes(input.jurorRosterId)) return 'not_juror'
  const q = state.questions.find((x) => x.id === juryQuestionId(input.jurorRosterId, input.finalistRosterId))
  if (!q) return 'no_question'
  if (!q.answer) return 'not_answered'
  return null
}

export function refuseClosingSpeech(gate: JuryQaGate, input: { finalistRosterId: string; text: string }): JuryQaRefusal | null {
  const live = liveRefusal(gate)
  if (live) return live
  if (!gate.finalists.includes(input.finalistRosterId)) return 'not_finalist'
  return textRefusal(input.text, CLOSING_SPEECH_MAX_CHARS)
}

/**
 * Who may READ the Q&A and the speeches: the jury, the finalists and a non-playing host while the
 * finale runs; everyone in the league once a champion is crowned. Nothing here is a ballot, but the
 * finale conversation belongs to the people in it until it is over.
 */
export function canReadJuryQa(viewer: { isJuror: boolean; isFinalist: boolean; isHost: boolean }, crowned: boolean): boolean {
  return crowned || viewer.isJuror || viewer.isFinalist || viewer.isHost
}

/** What one juror still owes and what one finalist still owes — the Decision OS / Chimmy read. */
export function juryQaTodo(state: JuryQaState, viewer: { rosterId: string | null; isJuror: boolean; isFinalist: boolean }, finalists: ReadonlyArray<string>, opts: { speechesEnabled: boolean }) {
  const rosterId = viewer.rosterId
  if (!rosterId) return { questionsToAsk: [] as string[], questionsToAnswer: [] as string[], answersToRead: [] as string[], speechMissing: false }
  const questionsToAsk = viewer.isJuror ? finalists.filter((f) => f !== rosterId && !state.questions.some((q) => q.id === juryQuestionId(rosterId, f))) : []
  const questionsToAnswer = viewer.isFinalist ? state.questions.filter((q) => q.finalistRosterId === rosterId && !q.answer).map((q) => q.id) : []
  const answersToRead = viewer.isJuror ? state.questions.filter((q) => q.jurorRosterId === rosterId && q.answer && !q.seenAt).map((q) => q.id) : []
  const speechMissing = viewer.isFinalist && opts.speechesEnabled && !state.speeches.some((s) => s.finalistRosterId === rosterId)
  return { questionsToAsk, questionsToAnswer, answersToRead, speechMissing }
}
