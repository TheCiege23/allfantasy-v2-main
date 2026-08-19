export const CORE_PLUGIN_IDS = [
  'redraft',
  'dynasty',
  'keeper',
  'best_ball',
  'guillotine',
  'survivor',
  'tournament',
  'big_brother',
  'zombie',
  'devy',
  'c2c',
  'idp',
] as const

export type CorePluginId = (typeof CORE_PLUGIN_IDS)[number]

export type PluginReadiness = 'implemented' | 'partial' | 'architecture_stub' | 'future'

export type PluginCapabilityStatus = 'implemented' | 'partial' | 'missing' | 'future'

export type PluginCapabilityMap = Partial<
  Record<
    | 'lifecycle'
    | 'draft'
    | 'schedule'
    | 'playoffs'
    | 'waivers'
    | 'trades'
    | 'scoring'
    | 'commissioner'
    | 'decisionOS'
    | 'behavioralIntelligence'
    | 'managerIntelligence'
    | 'leagueIntelligence'
    | 'platformIntelligence',
    PluginCapabilityStatus
  >
>

export type PluginContext = {
  leagueId: string
  leagueType: CorePluginId | string
  leagueVariant?: string | null
  sport?: string | null
  season?: number | null
  week?: number | null
  actorUserId?: string | null
  settings?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
}

export type PluginHookResult = {
  ok: boolean
  code?: string
  message?: string
  metadata?: Record<string, unknown>
}

export type PluginHookHandler<TContext extends PluginContext = PluginContext> = (
  context: TContext,
) => PluginHookResult | Promise<PluginHookResult>

export function okPluginHook(metadata?: Record<string, unknown>): PluginHookResult {
  return { ok: true, metadata }
}

export function blockedPluginHook(code: string, message: string): PluginHookResult {
  return { ok: false, code, message }
}
