export type Strategy = 'win-now' | 'balanced' | 'rebuild'
export interface StrategyState {
  active: Strategy
  revision: number
  pending: { strategy: Strategy; firstWeek: number; lastWeek: number; observations: number; evidenceIds: string[] } | null
}

/** Weekly persistence is evidence for a proposal, never permission to change a user's strategy. */
export function observeStrategy(state: StrategyState, observation: {
  strategy: Strategy; week: number; evidenceId: string; materialChange: boolean
}): StrategyState {
  if (!Number.isInteger(observation.week) || observation.week < 1 || !observation.evidenceId) return state
  const p = state.pending
  if (p && (observation.week <= p.lastWeek || p.evidenceIds.includes(observation.evidenceId))) return state
  if (observation.strategy === state.active || !observation.materialChange) return { ...state, pending: null }
  const contiguous = p && p.strategy === observation.strategy && observation.week === p.lastWeek + 1
  return { ...state, pending: contiguous ? {
    ...p, lastWeek: observation.week, observations: p.observations + 1,
    evidenceIds: [...p.evidenceIds, observation.evidenceId],
  } : { strategy: observation.strategy, firstWeek: observation.week, lastWeek: observation.week,
    observations: 1, evidenceIds: [observation.evidenceId] } }
}

/** Caller authenticates the owner and persists with a revision compare-and-swap. */
export function confirmStrategy(state: StrategyState, expectedRevision: number, strategy: Strategy): StrategyState {
  if (expectedRevision !== state.revision) throw new Error('Strategy revision changed')
  if (!state.pending || state.pending.strategy !== strategy || state.pending.observations < 3 || state.pending.lastWeek - state.pending.firstWeek < 2) {
    throw new Error('Strategy change needs three consecutive weekly observations')
  }
  return { active: strategy, revision: state.revision + 1, pending: null }
}
