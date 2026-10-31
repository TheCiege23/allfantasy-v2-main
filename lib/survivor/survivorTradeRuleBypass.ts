/**
 * The bypass hook for the Survivor trade rules: anything that lets a trade skip the tribe and
 * played-player rules (never the commissioner's weekly freeze) plugs in here, so the rule check in
 * survivorTradeRuleHook.ts never needs to know about it.
 *
 * Built in: a "free trade" reward recorded by the effect engine (lib/survivor/SurvivorEffectEngine.ts)
 * for this Survivor week, on any roster in the trade, with one of SURVIVOR_FREE_TRADE_REWARD_TYPES.
 * No such reward type exists yet; when the effect engine grows one under any of these names it takes
 * effect here with no further change. A different mechanism registers its own provider:
 *
 *   registerSurvivorTradeBypassProvider(async ({ leagueId, rosterIds, week }) => ({ bypass: …, source: 'my_token' }))
 *
 * Providers must be read-only: a bypass check runs at proposal, at acceptance and at settlement, so
 * consuming a token belongs to whatever settles the trade, never to the check.
 */

export const SURVIVOR_FREE_TRADE_REWARD_TYPES = ['free_trade', 'free_trade_token', 'free_same_position_trade'] as const

export interface SurvivorTradeBypassContext {
  leagueId: string
  week: number
  /** League `Roster` ids of every team in the trade (the id space the effect engine keys on). */
  rosterIds: string[]
}

export type SurvivorTradeBypassProvider = (ctx: SurvivorTradeBypassContext) => Promise<{ bypass: boolean; source?: string } | null>

async function freeTradeEffectProvider(ctx: SurvivorTradeBypassContext): Promise<{ bypass: boolean; source?: string } | null> {
  if (ctx.week < 1 || ctx.rosterIds.length === 0) return null
  const { getActiveEffectsForRoster } = await import('./SurvivorEffectEngine')
  for (const rosterId of ctx.rosterIds) {
    const effects = await getActiveEffectsForRoster(ctx.leagueId, rosterId, ctx.week)
    const hit = effects.find((e) => (SURVIVOR_FREE_TRADE_REWARD_TYPES as readonly string[]).includes(e.rewardType) && e.appliedMode !== 'queued')
    if (hit) return { bypass: true, source: hit.rewardType }
  }
  return null
}

const providers: SurvivorTradeBypassProvider[] = [freeTradeEffectProvider]

/** Add a bypass provider; returns a function that removes it again (tests, feature flags). */
export function registerSurvivorTradeBypassProvider(provider: SurvivorTradeBypassProvider): () => void {
  providers.push(provider)
  return () => {
    const i = providers.indexOf(provider)
    if (i >= 0) providers.splice(i, 1)
  }
}

/** The first provider that grants a bypass wins. A provider that throws grants nothing. */
export async function resolveSurvivorTradeBypass(ctx: SurvivorTradeBypassContext): Promise<{ bypass: boolean; source: string | null }> {
  for (const provider of providers) {
    const result = await provider(ctx).catch(() => null)
    if (result?.bypass) return { bypass: true, source: result.source ?? null }
  }
  return { bypass: false, source: null }
}
