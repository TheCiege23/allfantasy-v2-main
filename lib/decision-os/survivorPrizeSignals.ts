import { SEVERITY_RANK, type AttentionSignalSeverity, type DecisionOsAttentionSignal } from './attentionSignals'

/**
 * Survivor reward facts as Decision OS attention signals ("your tribe won FAAB", "you hold a free
 * trade", "choose who gets your points").
 *
 * Same contract as `attentionSignals.ts` and `careerSignals.ts`: pure, zero I/O, interpret outputs
 * that ALREADY exist and never invent one. The input is the manager's OWN slice of the Survivor
 * reward ledger (`listSurvivorRewards(leagueId, { rosterId })`), already described in the league's
 * language by `describeSurvivorReward`, so a signal can never disagree with what Chimmy says. Ids
 * only, never names. Nothing here reveals another manager's reward or blocker.
 */

export interface SurvivorRewardSignalReward {
  rewardId: string
  type: string
  status: string
  week: number
  applyWeek: number
  /** `describeSurvivorReward(record, language)`. */
  text: string
  /** Source kind (`weekly_prize`, `challenge`, …). */
  sourceKind?: string | null
}

export interface SurvivorRewardSignalInput {
  leagueId: string
  currentWeek: number | null
  language?: string | null
  rewards: readonly SurvivorRewardSignalReward[]
}

const es = (language: string | null | undefined) => String(language ?? '').toLowerCase().startsWith('es')

type Kind = 'choice' | 'trade_token' | 'blocker' | 'deferred' | 'won'

const SEVERITY: Record<Kind, AttentionSignalSeverity> = {
  choice: 'high',
  trade_token: 'medium',
  deferred: 'low',
  blocker: 'informational',
  won: 'informational',
}

function title(kind: Kind, r: SurvivorRewardSignalReward, spanish: boolean): string {
  switch (kind) {
    case 'choice': return spanish ? 'Elige a quién va tu recompensa de Survivor' : 'Choose who gets your Survivor reward'
    case 'trade_token': return spanish ? 'Tienes un intercambio libre' : 'You hold a free trade'
    case 'blocker': return spanish ? 'Tienes un bloqueador de robos' : 'You hold a steal blocker'
    case 'deferred': return spanish ? `Un premio de Survivor se paga en la semana ${r.applyWeek}` : `A Survivor prize pays out in week ${r.applyWeek}`
    case 'won':
      if (r.sourceKind === 'weekly_prize' && r.type === 'faab_grant') return spanish ? 'Tu tribu ganó FAAB' : 'Your tribe won FAAB'
      return spanish ? 'Ganaste una recompensa de Survivor' : 'You won a Survivor reward'
  }
}

function action(kind: Kind, spanish: boolean): string | null {
  switch (kind) {
    case 'choice': return spanish ? 'Abre Survivor y elige el objetivo antes de la próxima actualización.' : 'Open Survivor and choose the target before the next update.'
    case 'trade_token': return spanish ? 'Úsalo en un intercambio de la misma posición; no cuenta para las restricciones de Survivor.' : 'Use it on a same-position trade; it skips the Survivor trade restrictions.'
    default: return null
  }
}

function kindOf(r: SurvivorRewardSignalReward, currentWeek: number | null): Kind | null {
  if (r.status === 'awaiting_choice') return 'choice'
  if (r.status === 'available' && r.type === 'free_trade_token') return 'trade_token'
  if (r.status === 'available' && r.type === 'steal_blocker') return 'blocker'
  if (r.status === 'deferred') return 'deferred'
  // Only fresh wins: this week's or last week's, so the queue does not fill with a season of history.
  if (r.status === 'applied' && currentWeek != null && r.week >= currentWeek - 1) return 'won'
  return null
}

export function deriveSurvivorAttentionSignals(inputs: readonly SurvivorRewardSignalInput[], now: Date): DecisionOsAttentionSignal[] {
  const out: DecisionOsAttentionSignal[] = []
  for (const input of inputs) {
    const spanish = es(input.language)
    for (const r of input.rewards) {
      const kind = kindOf(r, input.currentWeek)
      if (!kind) continue
      const severity = SEVERITY[kind]
      out.push({
        id: `survivor_reward:${input.leagueId}:${r.rewardId}:${r.status}`,
        leagueId: input.leagueId,
        type: 'survivor_reward',
        severity,
        priorityScore: SEVERITY_RANK[severity],
        title: title(kind, r, spanish),
        explanation: r.text,
        recommendedAction: action(kind, spanish),
        timestamp: now.toISOString(),
        source: 'survivor',
      })
    }
  }
  return out
}
