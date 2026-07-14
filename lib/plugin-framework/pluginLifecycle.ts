import type { CoreLeaguePlugin, PluginLifecycleHooks } from './pluginContracts'
import type { PluginContext, PluginHookResult } from './pluginTypes'

export const LIFECYCLE_HOOK_NAMES = [
  'onLeagueCreated',
  'onLeagueActivated',
  'onDraftCreated',
  'onDraftCompleted',
  'onSeasonStarted',
  'onWeekAdvanced',
  'onPlayoffsStarted',
  'onChampionFinalized',
  'onLeagueArchived',
  'onSeasonRolledOver',
] as const satisfies readonly (keyof PluginLifecycleHooks)[]

export type LifecycleHookName = (typeof LIFECYCLE_HOOK_NAMES)[number]

export type LifecycleHookRunResult = PluginHookResult & {
  pluginId: string
  hook: LifecycleHookName
  skipped?: boolean
}

export async function runLifecycleHook(
  plugin: CoreLeaguePlugin,
  hook: LifecycleHookName,
  context: PluginContext,
): Promise<LifecycleHookRunResult> {
  const handler = plugin.lifecycle?.[hook]
  if (!handler) {
    return { ok: true, pluginId: plugin.id, hook, skipped: true }
  }
  const result = await handler(context)
  return { ...result, pluginId: plugin.id, hook }
}
