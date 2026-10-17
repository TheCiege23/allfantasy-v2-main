import { z } from 'zod'
import { confirmStrategy, observeStrategy, type StrategyState } from './strategy'

export const strategyName = z.enum(['win-now', 'balanced', 'rebuild'])
export const strategyScopeSchema = z.object({
  userId: z.string().trim().min(1).max(128), leagueId: z.string().trim().min(1).max(128),
  season: z.number().int().min(1900).max(2200),
}).strict()
const pendingSchema = z.object({ strategy: strategyName, firstWeek: z.number().int().min(1).max(60),
  lastWeek: z.number().int().min(1).max(60), observations: z.number().int().min(1).max(60),
  evidenceIds: z.array(z.string().min(1).max(200)).min(1).max(60),
}).strict().refine(p => p.lastWeek - p.firstWeek + 1 === p.observations &&
  p.observations === p.evidenceIds.length && new Set(p.evidenceIds).size === p.evidenceIds.length)
const storedSchema = strategyScopeSchema.extend({ id: z.string().min(1), active: strategyName,
  revision: z.number().int().nonnegative(), pending: pendingSchema.nullable(),
  lastObservedWeek: z.number().int().min(1).max(60).nullable(),
}).strip().refine(s => !s.pending || (s.pending.strategy !== s.active && s.pending.lastWeek === s.lastObservedWeek))
export type StrategyScope = z.infer<typeof strategyScopeSchema>
export type StoredStrategy = z.infer<typeof storedSchema>
export const strategyObservationSchema = z.object({ strategy: strategyName, week: z.number().int().min(1).max(60),
  evidenceId: z.string().trim().min(1).max(200), materialChange: z.boolean(), restartSequence: z.boolean().optional() }).strict()
export const strategyConfirmationSchema = z.object({ expectedRevision: z.number().int().nonnegative(),
  strategy: strategyName, confirmed: z.literal(true) }).strict()

export class StrategyStoreError extends Error {
  constructor(public code: 'CONFLICT' | 'NOT_READY' | 'INVALID_STATE') { super(code) }
}
/** Implementations commit the version check, state update and event together. */
export interface StrategyStorePort {
  read(scope: StrategyScope): Promise<unknown | null>
  initialize(scope: StrategyScope): Promise<unknown>
  commit(input: { scope: StrategyScope; previous: StoredStrategy; next: StoredStrategy;
    action: 'observe' | 'confirm'; evidenceId: string | null }): Promise<boolean>
}
function validate(value: unknown, scope: StrategyScope): StoredStrategy {
  const parsed = storedSchema.safeParse(value)
  if (!parsed.success || parsed.data.userId !== scope.userId || parsed.data.leagueId !== scope.leagueId || parsed.data.season !== scope.season) {
    throw new StrategyStoreError('INVALID_STATE')
  }
  return parsed.data
}
export async function readStrategy(scopeInput: StrategyScope, port: StrategyStorePort): Promise<StoredStrategy | null> {
  const scope = strategyScopeSchema.parse(scopeInput)
  const row = await port.read(scope)
  return row === null ? null : validate(row, scope)
}
/** Trusted server producer only. There is deliberately no public endpoint accepting observation evidence. */
export async function recordStrategyObservation(scopeInput: StrategyScope, input: z.infer<typeof strategyObservationSchema>, port: StrategyStorePort): Promise<StoredStrategy> {
  const scope = strategyScopeSchema.parse(scopeInput)
  const observation = strategyObservationSchema.parse(input)
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await readStrategy(scope, port) ?? validate(await port.initialize(scope), scope)
    // Stale observations cannot clear a newer proposal, even after a confirmation cleared pending.
    if (state.lastObservedWeek !== null && observation.week <= state.lastObservedWeek) return state
    if (state.pending?.evidenceIds.includes(observation.evidenceId)) return state
    const result = observeStrategy(observation.restartSequence ? { ...state, pending: null } : state, observation)
    const next = validate({ ...state, ...result, revision: state.revision + 1, lastObservedWeek: observation.week }, scope)
    if (await port.commit({ scope, previous: state, next, action: 'observe', evidenceId: observation.evidenceId })) return next
  }
  throw new StrategyStoreError('CONFLICT')
}
/** scope.userId must come from the authenticated session, never from client JSON. */
export async function confirmStoredStrategy(scopeInput: StrategyScope, input: z.infer<typeof strategyConfirmationSchema>, port: StrategyStorePort): Promise<StoredStrategy> {
  const scope = strategyScopeSchema.parse(scopeInput)
  const confirmation = strategyConfirmationSchema.parse(input)
  const previous = await readStrategy(scope, port)
  if (!previous) throw new StrategyStoreError('NOT_READY')
  if (confirmation.expectedRevision !== previous.revision) throw new StrategyStoreError('CONFLICT')
  let confirmed: StrategyState
  try { confirmed = confirmStrategy(previous, confirmation.expectedRevision, confirmation.strategy) }
  catch { throw new StrategyStoreError('NOT_READY') }
  const next = validate({ ...previous, ...confirmed }, scope)
  if (!await port.commit({ scope, previous, next, action: 'confirm', evidenceId: null })) throw new StrategyStoreError('CONFLICT')
  return next
}
/** Public owner view omits storage ids and source evidence identifiers. */
export function strategyOwnerView(row: StoredStrategy | null) {
  return row ? { available: true as const, active: row.active, revision: row.revision,
    pending: row.pending ? { strategy: row.pending.strategy, firstWeek: row.pending.firstWeek,
      lastWeek: row.pending.lastWeek, observations: row.pending.observations, readyToConfirm: row.pending.observations >= 3 } : null }
    : { available: false as const, active: null, revision: null, pending: null }
}
