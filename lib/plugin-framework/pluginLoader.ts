import { definePlugin, type CoreLeaguePlugin } from './pluginContracts'
import { okPluginHook } from './pluginTypes'
import { getPlugin, registerPlugin } from './pluginRegistry'

export const RedraftPlugin = definePlugin({
  id: 'redraft',
  label: 'Redraft',
  version: '0.1.0',
  readiness: 'partial',
  description: 'Seasonal fantasy leagues with fresh rosters each season. Redraft is Plugin #1 and the first consumer of Core Engines.',
  capabilities: {
    lifecycle: 'partial',
    draft: 'implemented',
    schedule: 'partial',
    playoffs: 'partial',
    waivers: 'partial',
    trades: 'partial',
    scoring: 'partial',
    commissioner: 'partial',
    decisionOS: 'partial',
    behavioralIntelligence: 'partial',
    managerIntelligence: 'partial',
    leagueIntelligence: 'partial',
    platformIntelligence: 'partial',
  },
  lifecycle: {
    onLeagueCreated: async () => okPluginHook({ currentOwner: 'league-creation' }),
    onDraftCompleted: async () => okPluginHook({ currentOwner: 'live-draft-engine + redraft finalizer' }),
    onSeasonStarted: async () => okPluginHook({ currentOwner: 'redraft season activation' }),
    onWeekAdvanced: async () => okPluginHook({ currentOwner: 'redraft scoring runner' }),
    onPlayoffsStarted: async () => okPluginHook({ currentOwner: 'redraft playoff engine' }),
    onChampionFinalized: async () => okPluginHook({ currentOwner: 'redraft playoff finalizer' }),
  },
  metadata: {
    behaviorChanged: false,
    migrationRole: 'architecture_mapping_only',
  },
})

export function registerCorePlugins(): CoreLeaguePlugin[] {
  const registered: CoreLeaguePlugin[] = []
  if (!getPlugin(RedraftPlugin.id)) {
    registered.push(registerPlugin(RedraftPlugin))
  }
  return registered
}
