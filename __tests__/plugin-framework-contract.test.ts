import { describe, expect, it, beforeEach } from 'vitest'
import {
  CORE_PLUGIN_IDS,
  PLUGIN_HOOK_CATALOG,
  RedraftPlugin,
  getPlugin,
  normalizePluginKey,
  registerCorePlugins,
  registerPlugin,
  requirePlugin,
  resetPluginRegistryForTests,
  runLifecycleHook,
  definePlugin,
} from '@/lib/plugin-framework'

describe('Core Plugin Framework contract', () => {
  beforeEach(() => {
    resetPluginRegistryForTests()
  })

  it('declares the platform target plugin ids', () => {
    expect(CORE_PLUGIN_IDS).toEqual([
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
    ])
  })

  it('registers and looks up plugins without switch statements', () => {
    registerPlugin(RedraftPlugin)

    expect(getPlugin('redraft')?.id).toBe('redraft')
    expect(requirePlugin('redraft').label).toBe('Redraft')
  })

  it('normalizes common format aliases before lookup', () => {
    expect(normalizePluginKey('bestball')).toBe('best_ball')
    expect(normalizePluginKey('campus_to_canton')).toBe('c2c')
    expect(normalizePluginKey('campus-2-canton')).toBe('c2c')
    expect(normalizePluginKey('dynasty_idp')).toBe('idp')
  })

  it('registers Redraft as Plugin #1 through the core loader', () => {
    const registered = registerCorePlugins()

    expect(registered.map((p) => p.id)).toEqual(['redraft'])
    expect(getPlugin('redraft')).toBe(RedraftPlugin)
    expect(registerCorePlugins()).toEqual([])
  })

  it('runs lifecycle hooks deterministically and skips missing hooks safely', async () => {
    const plugin = definePlugin({
      ...RedraftPlugin,
      lifecycle: {
        onWeekAdvanced: async (context) => ({
          ok: true,
          metadata: { leagueId: context.leagueId, week: context.week },
        }),
      },
    })

    const ran = await runLifecycleHook(plugin, 'onWeekAdvanced', {
      leagueId: 'league-1',
      leagueType: 'redraft',
      week: 4,
    })
    const skipped = await runLifecycleHook(plugin, 'onLeagueArchived', {
      leagueId: 'league-1',
      leagueType: 'redraft',
    })

    expect(ran).toEqual({
      ok: true,
      pluginId: 'redraft',
      hook: 'onWeekAdvanced',
      metadata: { leagueId: 'league-1', week: 4 },
    })
    expect(skipped).toEqual({
      ok: true,
      pluginId: 'redraft',
      hook: 'onLeagueArchived',
      skipped: true,
    })
  })

  it('publishes the expected hook catalog for core engines', () => {
    expect(PLUGIN_HOOK_CATALOG.lifecycle).toContain('onDraftCompleted')
    expect(PLUGIN_HOOK_CATALOG.draft).toContain('pickValidation')
    expect(PLUGIN_HOOK_CATALOG.schedule).toContain('scheduleGenerator')
    expect(PLUGIN_HOOK_CATALOG.playoffs).toContain('bracketGenerator')
    expect(PLUGIN_HOOK_CATALOG.waivers).toContain('processingPolicy')
    expect(PLUGIN_HOOK_CATALOG.trades).toContain('assetValidation')
    expect(PLUGIN_HOOK_CATALOG.scoring).toContain('statCorrectionHooks')
    expect(PLUGIN_HOOK_CATALOG.commissioner).toContain('commissionerSettings')
    expect(PLUGIN_HOOK_CATALOG.decisionOS).toContain('recommendationInputs')
  })
})
