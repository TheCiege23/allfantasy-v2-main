import { SEVERITY_RANK, type AttentionSignalSeverity, type DecisionOsAttentionSignal } from './attentionSignals'

/**
 * Survivor finale and Tribal deadlines as Decision OS attention signals.
 *
 * Same contract as `attentionSignals.ts` / `careerSignals.ts`: pure, zero I/O, and it only
 * interprets state the Survivor engine ALREADY persisted — the jury Q&A fold, the closing-speech
 * window and the open council's ballot due time (lib/survivor/survivorFinaleSignalsLoader.ts reads
 * them). It invents nothing and never reads a ballot: "you have not voted" comes from the viewer's
 * OWN ballot only. League ids only, never names.
 *
 *   survivor_jury_question_window  "Jury question window closes in X"  (a juror with questions left)
 *   survivor_finalist_answer_due   "Answer the jury"                    (a finalist with questions waiting)
 *   survivor_closing_speech        "Write your closing speech"          (a finalist with no speech yet)
 *   survivor_votes_due             "Votes due in X"                     (an eligible voter with no ballot)
 */

export interface SurvivorFinaleSignalInputs {
  leagueId: string
  now: Date
  /** Juror: finalists still to be asked, and when the question window closes (null = no window). */
  questionsToAsk: number
  questionsDeadline: string | null
  questionWindowOpen: boolean
  /** Finalist: questions waiting for an answer, and the answer deadline. */
  questionsToAnswer: number
  answersDeadline: string | null
  answerWindowOpen: boolean
  /** Finalist: speeches on, none posted yet, window still open. */
  speechMissing: boolean
  speechesDeadline: string | null
  speechWindowOpen: boolean
  /** Tribal: the viewer can vote, has not, and ballots are due at this time. */
  ballotOwed: boolean
  ballotsDueAt: string | null
  /** League.language: titles and copy follow it (English / Spanish), like the newer Survivor signals. */
  language?: string | null
}

const isEs = (language: string | null | undefined) => String(language ?? '').toLowerCase().startsWith('es')

/** The Spanish X in "cierra en X". */
export function formatTimeLeftEs(ms: number): string {
  if (ms <= 0) return 'ya'
  if (ms < HOUR_MS) return `${Math.max(1, Math.round(ms / 60_000))} min`
  if (ms < 48 * HOUR_MS) return `${Math.round(ms / HOUR_MS)} h`
  return `${Math.round(ms / (24 * HOUR_MS))} días`
}

const HOUR = 3_600_000
const HOUR_MS = HOUR

/** "45 min", "3 h", "2 days" — the X in "closes in X". */
export function formatTimeLeft(ms: number): string {
  if (ms <= 0) return 'now'
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60_000))} min`
  if (ms < 48 * HOUR) return `${Math.round(ms / HOUR)} h`
  return `${Math.round(ms / (24 * HOUR))} days`
}

function severityFor(deadline: string | null, now: Date): AttentionSignalSeverity {
  if (!deadline) return 'low'
  const left = new Date(deadline).getTime() - now.getTime()
  if (left <= 2 * HOUR) return 'high'
  if (left <= 24 * HOUR) return 'medium'
  return 'low'
}

function signal(input: SurvivorFinaleSignalInputs, type: DecisionOsAttentionSignal['type'], deadline: string | null, title: string, explanation: string, action: string): DecisionOsAttentionSignal {
  const severity = severityFor(deadline, input.now)
  return {
    // Stable per league + condition + deadline, so a consumer can dedupe without wall-clock noise.
    id: `${type}:${input.leagueId}:${deadline ?? 'open'}`,
    leagueId: input.leagueId,
    type,
    severity,
    priorityScore: SEVERITY_RANK[severity],
    title,
    explanation,
    recommendedAction: action,
    timestamp: input.now.toISOString(),
    source: 'survivor',
  }
}

const left = (deadline: string | null, now: Date) => (deadline ? formatTimeLeft(new Date(deadline).getTime() - now.getTime()) : null)
const future = (deadline: string | null, now: Date) => !deadline || new Date(deadline).getTime() > now.getTime()

export function deriveSurvivorFinaleSignals(input: SurvivorFinaleSignalInputs): DecisionOsAttentionSignal[] {
  if (isEs(input.language)) return deriveSurvivorFinaleSignalsEs(input)
  const out: DecisionOsAttentionSignal[] = []
  const { now } = input
  if (input.questionsToAsk > 0 && input.questionWindowOpen && future(input.questionsDeadline, now)) {
    const x = left(input.questionsDeadline, now)
    out.push(signal(input, 'survivor_jury_question_window', input.questionsDeadline,
      x ? `Jury question window closes in ${x}` : 'Ask the finalists your jury question',
      `You can still ask ${input.questionsToAsk} finalist${input.questionsToAsk === 1 ? '' : 's'} one question each.`,
      'Open the Jury chamber and ask your question.'))
  }
  if (input.questionsToAnswer > 0 && input.answerWindowOpen && future(input.answersDeadline, now)) {
    const x = left(input.answersDeadline, now)
    out.push(signal(input, 'survivor_finalist_answer_due', input.answersDeadline,
      x ? `Answer the jury — ${x} left` : 'Answer the jury',
      `${input.questionsToAnswer} juror question${input.questionsToAnswer === 1 ? ' is' : 's are'} waiting for your answer.`,
      'Open the Jury chamber and answer.'))
  }
  if (input.speechMissing && input.speechWindowOpen && future(input.speechesDeadline, now)) {
    const x = left(input.speechesDeadline, now)
    out.push(signal(input, 'survivor_closing_speech', input.speechesDeadline,
      x ? `Write your closing speech — ${x} left` : 'Write your closing speech',
      'Each finalist posts one closing speech for the jury before they vote.',
      'Open the Jury chamber and post your closing speech.'))
  }
  if (input.ballotOwed && input.ballotsDueAt && future(input.ballotsDueAt, now)) {
    out.push(signal(input, 'survivor_votes_due', input.ballotsDueAt,
      `Votes due in ${left(input.ballotsDueAt, now)}`,
      'You have not voted at this Tribal Council yet. A ballot after the due time does not count.',
      'Vote privately on the Tribal Council screen or with @Chimmy vote.'))
  }
  return out
}

/** The same four signals, same ids and severities, worded in Spanish. */
function deriveSurvivorFinaleSignalsEs(input: SurvivorFinaleSignalInputs): DecisionOsAttentionSignal[] {
  const out: DecisionOsAttentionSignal[] = []
  const { now } = input
  const leftEs = (deadline: string | null) => (deadline ? formatTimeLeftEs(new Date(deadline).getTime() - now.getTime()) : null)
  if (input.questionsToAsk > 0 && input.questionWindowOpen && future(input.questionsDeadline, now)) {
    const x = leftEs(input.questionsDeadline)
    out.push(signal(input, 'survivor_jury_question_window', input.questionsDeadline,
      x ? `Las preguntas del jurado cierran en ${x}` : 'Haz tu pregunta del jurado a los finalistas',
      `Todavía puedes hacer una pregunta a ${input.questionsToAsk === 1 ? '1 finalista' : `${input.questionsToAsk} finalistas`}.`,
      'Abre la sala del jurado y haz tu pregunta.'))
  }
  if (input.questionsToAnswer > 0 && input.answerWindowOpen && future(input.answersDeadline, now)) {
    const x = leftEs(input.answersDeadline)
    out.push(signal(input, 'survivor_finalist_answer_due', input.answersDeadline,
      x ? `Responde al jurado — quedan ${x}` : 'Responde al jurado',
      input.questionsToAnswer === 1 ? 'Una pregunta del jurado espera tu respuesta.' : `${input.questionsToAnswer} preguntas del jurado esperan tu respuesta.`,
      'Abre la sala del jurado y responde.'))
  }
  if (input.speechMissing && input.speechWindowOpen && future(input.speechesDeadline, now)) {
    const x = leftEs(input.speechesDeadline)
    out.push(signal(input, 'survivor_closing_speech', input.speechesDeadline,
      x ? `Escribe tu discurso final — quedan ${x}` : 'Escribe tu discurso final',
      'Cada finalista publica un discurso final para el jurado antes de que vote.',
      'Abre la sala del jurado y publica tu discurso final.'))
  }
  if (input.ballotOwed && input.ballotsDueAt && future(input.ballotsDueAt, now)) {
    out.push(signal(input, 'survivor_votes_due', input.ballotsDueAt,
      `Los votos vencen en ${leftEs(input.ballotsDueAt)}`,
      'Todavía no votaste en este Consejo Tribal. Un voto después de la hora límite no cuenta.',
      'Vota en privado en la pantalla del Consejo Tribal o con @Chimmy vote.'))
  }
  return out
}
