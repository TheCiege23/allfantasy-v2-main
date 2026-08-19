import type { CoreLeaguePlugin } from './pluginContracts'
import type { CorePluginId } from './pluginTypes'

export type PluginLookupKey = CorePluginId | string | null | undefined

export class PluginRegistry {
  private readonly plugins = new Map<string, CoreLeaguePlugin>()

  registerPlugin(plugin: CoreLeaguePlugin): CoreLeaguePlugin {
    const key = normalizePluginKey(plugin.id)
    if (!key) throw new Error('Plugin id is required')
    this.plugins.set(key, plugin)
    return plugin
  }

  getPlugin(key: PluginLookupKey): CoreLeaguePlugin | undefined {
    const normalized = normalizePluginKey(key)
    if (!normalized) return undefined
    return this.plugins.get(normalized)
  }

  requirePlugin(key: PluginLookupKey): CoreLeaguePlugin {
    const plugin = this.getPlugin(key)
    if (!plugin) {
      throw new Error(`No league plugin registered for "${String(key ?? '')}"`)
    }
    return plugin
  }

  listPlugins(): CoreLeaguePlugin[] {
    return Array.from(this.plugins.values())
  }

  clear(): void {
    this.plugins.clear()
  }
}

export function normalizePluginKey(key: PluginLookupKey): string {
  const raw = String(key ?? '').trim().toLowerCase()
  if (raw === 'bestball') return 'best_ball'
  if (raw === 'campus_to_canton' || raw === 'campus-2-canton' || raw === 'campus_2_canton') return 'c2c'
  if (raw === 'dynasty_idp') return 'idp'
  return raw
}

const globalRegistry = new PluginRegistry()

export function registerPlugin(plugin: CoreLeaguePlugin): CoreLeaguePlugin {
  return globalRegistry.registerPlugin(plugin)
}

export function getPlugin(key: PluginLookupKey): CoreLeaguePlugin | undefined {
  return globalRegistry.getPlugin(key)
}

export function requirePlugin(key: PluginLookupKey): CoreLeaguePlugin {
  return globalRegistry.requirePlugin(key)
}

export function listPlugins(): CoreLeaguePlugin[] {
  return globalRegistry.listPlugins()
}

export function resetPluginRegistryForTests(): void {
  globalRegistry.clear()
}
