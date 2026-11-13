/**
 * AllFantasy AI Engine — Plugin Registry
 *
 * All sport plugins register here at module init.
 * To add a new sport:
 *   1. Create lib/ai/engine/plugins/<sport>.plugin.ts
 *   2. Import it below and call registerPlugin()
 *
 * Plugins are lazy-loaded: calling getPlugin() for an unregistered sport
 * returns null instead of throwing, so callers can degrade gracefully.
 */
import type { SportKey, SportPlugin, PluginRegistry } from "./types"

// ── Plugin imports ─────────────────────────────────────────────────────────────
import { worldCupPlugin } from "./plugins/worldCup.plugin"
import { nflPlugin } from "./plugins/nfl.plugin"
import { nbaPlugin } from "./plugins/nba.plugin"
import { mlbPlugin } from "./plugins/mlb.plugin"
import { nhlPlugin } from "./plugins/nhl.plugin"
import { eplPlugin } from "./plugins/epl.plugin"
import { marchMadnessPlugin } from "./plugins/marchMadness.plugin"
import { ufcPlugin } from "./plugins/ufc.plugin"
import { aewPlugin } from "./plugins/aew.plugin"
import { pickemPlugin } from "./plugins/pickem.plugin"
import { survivorPlugin } from "./plugins/survivor.plugin"
import { warRoomPlugin } from "./plugins/warRoom.plugin"

// ── Singleton registry ─────────────────────────────────────────────────────────
const _registry: PluginRegistry = new Map()

function registerPlugin(plugin: SportPlugin<unknown, unknown, unknown>): void {
  if (_registry.has(plugin.sport)) {
    console.warn(
      `[AIEngine] Plugin "${plugin.sport}" already registered. Overwriting with v${plugin.version}.`,
    )
  }
  _registry.set(plugin.sport, plugin)
}

// ── Auto-register all plugins on module load ───────────────────────────────────
registerPlugin(worldCupPlugin)
registerPlugin(nflPlugin)
registerPlugin(nbaPlugin)
registerPlugin(mlbPlugin)
registerPlugin(nhlPlugin)
registerPlugin(eplPlugin)
registerPlugin(marchMadnessPlugin)
registerPlugin(ufcPlugin)
registerPlugin(aewPlugin)
registerPlugin(pickemPlugin)
registerPlugin(survivorPlugin)
registerPlugin(warRoomPlugin)

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Retrieve a registered sport plugin.
 * Returns null if no plugin is registered for the given sport,
 * so callers can degrade gracefully rather than throwing.
 */
export function getPlugin(
  sport: SportKey,
): SportPlugin<unknown, unknown, unknown> | null {
  return _registry.get(sport) ?? null
}

/**
 * Register an additional plugin at runtime (e.g. in tests or feature flags).
 * Prefer adding imports above for production plugins.
 */
export { registerPlugin }

