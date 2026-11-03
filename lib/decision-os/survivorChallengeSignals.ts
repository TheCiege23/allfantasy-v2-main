import { SEVERITY_RANK, type AttentionSignalSeverity, type DecisionOsAttentionSignal } from './attentionSignals'

/**
 * Survivor commissioner challenges as Decision OS attention signals: "Challenge locks in 2h and you
 * haven't answered" and "You won a challenge". (A prize that waits on a choice — "choose a tribemate"
 * — is the reward ledger's signal, `survivorPrizeSignals.ts`, so it is not repeated here.)
 *
 * Same contract as `attentionSignals.ts`, `careerSignals.ts` and `survivorPrizeSignals.ts`: pure,
 * zero I/O, interprets facts that ALREADY exist (the manager's own view of the challenge board,
 * `loadBuilderBoard`) and never invents one. Ids only, never another manager's answer.
 */

export interface SurvivorChallengeSignalChallenge {
  challengeId: string
  title: string
  status: string
  locksAt: string
  /** The manager (or their tribe) has answered. */
  answered: boolean
  scope: 'individual' | 'tribe'
  myResult: 'won' | 'lost' | 'void' | null
  week: number
  prizeText: string
}

export interface SurvivorChallengeSignalInput {
  leagueId: string
  currentWeek: number | null
  language?: string | null
  challenges: readonly SurvivorChallengeSignalChallenge[]
}

const HOUR_MS = 3_600_000
/** A challenge that locks inside a day is worth a nudge; inside two hours it is urgent. */
export const CHALLENGE_DUE_WINDOW_MS = 24 * HOUR_MS
export const CHALLENGE_URGENT_MS = 2 * HOUR_MS

const isEs = (language: string | null | undefined) => String(language ?? '').toLowerCase().startsWith('es')

function hoursLabel(ms: number, es: boolean): string {
  const h = Math.max(1, Math.round(ms / HOUR_MS))
  if (ms < HOUR_MS) return es ? 'menos de 1 h' : 'under 1h'
  return `${h}h`
}

export function deriveSurvivorChallengeSignals(inputs: readonly SurvivorChallengeSignalInput[], now: Date): DecisionOsAttentionSignal[] {
  const out: DecisionOsAttentionSignal[] = []
  for (const input of inputs) {
    const es = isEs(input.language)
    for (const c of input.challenges) {
      const left = new Date(c.locksAt).getTime() - now.getTime()
      if (c.status === 'open' && !c.answered && left > 0 && left <= CHALLENGE_DUE_WINDOW_MS) {
        const severity: AttentionSignalSeverity = left <= CHALLENGE_URGENT_MS ? 'high' : 'medium'
        out.push({
          id: `survivor_challenge_due:${input.leagueId}:${c.challengeId}`,
          leagueId: input.leagueId,
          type: 'survivor_challenge_due',
          severity,
          priorityScore: SEVERITY_RANK[severity],
          title: es
            ? `El reto "${c.title}" se cierra en ${hoursLabel(left, true)} y ${c.scope === 'tribe' ? 'tu tribu no ha respondido' : 'no has respondido'}`
            : `Challenge "${c.title}" locks in ${hoursLabel(left, false)} and ${c.scope === 'tribe' ? "your tribe hasn't answered" : "you haven't answered"}`,
          explanation: es ? `Premio: ${c.prizeText}. La primera respuesta cuenta.` : `Prize: ${c.prizeText}. The first answer stands.`,
          recommendedAction: es ? 'Abre Survivor y envía tu respuesta.' : 'Open Survivor and send your answer.',
          timestamp: now.toISOString(),
          source: 'survivor',
        })
      }
      // Only fresh wins (this week or last), so the queue does not fill with a season of history.
      if (c.status === 'complete' && c.myResult === 'won' && input.currentWeek != null && c.week >= input.currentWeek - 1) {
        out.push({
          id: `survivor_challenge_won:${input.leagueId}:${c.challengeId}`,
          leagueId: input.leagueId,
          type: 'survivor_challenge_won',
          severity: 'informational',
          priorityScore: SEVERITY_RANK.informational,
          title: es ? `Ganaste el reto "${c.title}"` : `You won the challenge "${c.title}"`,
          explanation: es ? `Premio: ${c.prizeText}.` : `Prize: ${c.prizeText}.`,
          recommendedAction: null,
          timestamp: now.toISOString(),
          source: 'survivor',
        })
      }
    }
  }
  return out
}
