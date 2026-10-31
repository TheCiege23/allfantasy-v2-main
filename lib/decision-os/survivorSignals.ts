import { SEVERITY_RANK, type AttentionSignalSeverity, type DecisionOsAttentionSignal } from './attentionSignals'

/**
 * Survivor governance facts as Decision OS attention signals.
 *
 * Same contract as `attentionSignals.ts` and `careerSignals.ts`: pure, zero I/O, and it only
 * relabels facts that ALREADY exist — the league's saved trade-rule window (computed by the same
 * `survivorTradeWindowStatus` the trade check enforces, so the signal and the refusal can never
 * disagree), the castaway's own conduct-strike rows, and a swap that is scheduled or sealed. The
 * caller (lib/survivor/survivorDecisionSignalInput.ts) reads them; nothing here decides anything.
 *
 * ⚠ LEAGUE IDS ONLY, NEVER NAMES. ⚠ SPOILER-SAFE: a swap signal says a swap is coming, never the draw.
 */

export interface SurvivorAttentionInputs {
  leagueId: string
  now: Date
  /** 'es' writes the signal in Spanish (League.language); anything else is English. */
  language?: string | null
  /** The viewer is a castaway still in the game (trade and swap signals are for them only). */
  activeCastaway: boolean
  /** Trade rules on and the castaway still in the game; null otherwise. */
  tradeWindow: { crossTribeClosesAt: Date | null; frozen: boolean; freezeStartsAt: Date | null } | null
  /** Before the merge (a cross-tribe window means nothing after it). */
  preMerge: boolean
  myStrikeCount: number
  strikeLimit: number
  /** A swap scheduled for this week, or one sealed and awaiting its reveal. */
  swap: { week: number; revealAt: Date | null } | null
}

/** "Tonight" = closes within this many hours. */
const TONIGHT_HOURS = 12
const URGENT_HOURS = 3

const hoursUntil = (target: Date, now: Date) => (target.getTime() - now.getTime()) / 3_600_000

function signal(input: SurvivorAttentionInputs, type: DecisionOsAttentionSignal['type'], key: string, severity: AttentionSignalSeverity, title: string, explanation: string, recommendedAction: string | null, timestamp: Date): DecisionOsAttentionSignal {
  return {
    id: `${type}:${input.leagueId}:${key}`,
    leagueId: input.leagueId,
    type,
    severity,
    priorityScore: SEVERITY_RANK[severity],
    title,
    explanation,
    recommendedAction,
    timestamp: timestamp.toISOString(),
    source: 'survivor',
  }
}

export function deriveSurvivorAttentionSignals(input: SurvivorAttentionInputs): DecisionOsAttentionSignal[] {
  const es = String(input.language ?? '').toLowerCase().startsWith('es')
  const out: DecisionOsAttentionSignal[] = []

  if (input.activeCastaway && input.tradeWindow) {
    const close = input.tradeWindow.crossTribeClosesAt
    if (input.preMerge && close) {
      const hours = hoursUntil(close, input.now)
      if (hours > 0 && hours <= TONIGHT_HOURS) {
        const severity: AttentionSignalSeverity = hours <= URGENT_HOURS ? 'high' : 'medium'
        out.push(signal(input, 'survivor_trade_window', `cross:${close.toISOString()}`, severity,
          es ? 'La ventana de cambios entre tribus cierra esta noche' : 'Cross-tribe trade window closes tonight',
          es ? `Los cambios con otras tribus cierran en ${Math.max(1, Math.round(hours))} h y vuelven después del Consejo Tribal.` : `Trades with other tribes close in ${Math.max(1, Math.round(hours))}h and reopen after Tribal Council.`,
          es ? 'Envía ahora cualquier oferta a otra tribu.' : 'Send any offer to another tribe now.', close))
      }
    }
    const freeze = input.tradeWindow.freezeStartsAt
    if (freeze) {
      const hours = hoursUntil(freeze, input.now)
      if (hours > 0 && hours <= TONIGHT_HOURS) {
        out.push(signal(input, 'survivor_trade_window', `freeze:${freeze.toISOString()}`, hours <= URGENT_HOURS ? 'high' : 'medium',
          es ? 'Los cambios se congelan esta noche' : 'Trades freeze tonight',
          es ? `Todos los cambios se congelan en ${Math.max(1, Math.round(hours))} h hasta después del Consejo Tribal.` : `Every trade freezes in ${Math.max(1, Math.round(hours))}h until after Tribal Council.`,
          es ? 'Cierra tus cambios antes de la congelación.' : 'Finish your trades before the freeze.', freeze))
      }
    }
  }

  if (input.myStrikeCount > 0) {
    const lastChance = input.myStrikeCount >= input.strikeLimit - 1
    const n = input.myStrikeCount
    out.push(signal(input, 'survivor_conduct_strike', `strikes:${n}`, lastChance ? 'high' : 'medium',
      es ? `Tienes ${n} ${n === 1 ? 'falta' : 'faltas'} de conducta` : `You have ${n} conduct ${n === 1 ? 'strike' : 'strikes'}`,
      es ? `El límite de esta liga es ${input.strikeLimit}.${lastChance && n < input.strikeLimit ? ' Una más y puedes quedar fuera.' : ''}` : `This league's limit is ${input.strikeLimit}.${lastChance && n < input.strikeLimit ? ' One more can remove you from the season.' : ''}`,
      es ? 'Revisa el motivo con Chimmy o el comisionado.' : 'Ask Chimmy or the commissioner about the reason.', input.now))
  }

  if (input.activeCastaway && input.swap) {
    const reveal = input.swap.revealAt
    out.push(signal(input, 'survivor_tribe_swap', `week:${input.swap.week}`, 'medium',
      es ? 'Cambio de tribus esta semana' : 'Tribe swap this week',
      reveal
        ? (es ? `Las nuevas tribus se revelan el ${reveal.toISOString()}. Tus ídolos viajan contigo.` : `The new tribes are revealed at ${reveal.toISOString()}. Your idols travel with you.`)
        : (es ? 'Las tribus se vuelven a repartir cuando termine esta semana; se revelan en el próximo cierre de alineaciones.' : 'The tribes are redrawn when this week ends and revealed at the next lineup lock.'),
      es ? 'Piensa en tus alianzas antes del cambio.' : 'Think about your alliances before the swap.', reveal ?? input.now))
  }
  return out
}
