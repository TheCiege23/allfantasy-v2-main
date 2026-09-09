import { resolveActiveLeagueId } from '../../resolveActiveLeagueId'
import { readLeagueSettingsSnapshot } from '../leagueSettingsReads'
import type { CommissionerErrorContract } from '../../contracts'
import type { SettingsClient } from './types'

/**
 * Settings, live.
 *
 * 🛑 THIS TAB WAS FIFTEEN LINES OF PLACEHOLDER CARD SITTING ON TOP OF 64 WORKING ROUTES. Every
 * capability it would expose — scoring, roster, waivers, playoffs, divisions, dues — already existed
 * under `app/api/commissioner/**`, already permission-gated. What was missing was a read that tells
 * the truth, and the obvious one does not: see `types.ts` for the measurement that rules out
 * `UnifiedLeagueSettingsService`, which defaults for all 288 leagues on production.
 *
 * ⚠ NO `callDecisionOS` HERE, AND THAT IS NOT AN OVERSIGHT. Every other live client in this program
 * reaches an intelligence API because it needs something DERIVED. Settings needs something STORED,
 * and `leagues.settings` is a column in the same database this request already has open. A
 * self-referential HTTP hop to one of the 64 routes would add a network round trip, a second auth
 * check and a serialisation pass to read a row we can read directly — and would put a request path
 * behind an HTTP call, which is the shape `scripts/check-db-first-api-boundary.mjs` exists to stop.
 *
 * Read-only, deliberately. An imported league's rules live on the platform of origin — Sleeper has
 * no write API at all — so `provenance.editableHere` is false and the view says where to go instead.
 * Rendering a save button that cannot save would be worse than the placeholder this replaces.
 */
function unavailable(message: string): CommissionerErrorContract {
  return {
    category: 'upstream_unavailable',
    message,
    moduleId: 'settings',
    retryable: false,
    timestamp: new Date().toISOString(),
  }
}

export const liveSettingsClient: SettingsClient = {
  /*
   * 🛑 NO `isLiveReady('settings')` GATE, AND THE OMISSION IS DELIBERATE RATHER THAN AN
   * INCONSISTENCY WITH THE OTHER ELEVEN NAMESPACES.
   *
   * That flag exists to stage a namespace's INTEGRATION WITH A REAL BACKEND — its own doc says it
   * governs "what a namespace's own live.ts does once the global mode is already 'live'". Settings
   * has no backend to integrate with: it reads a JSON column out of the same database this request
   * already has open. There is no partially-finished state for the flag to hold back.
   *
   * Adding one anyway would ship a tab that returns `upstream_unavailable` until somebody remembers
   * to flip a row in `platform_config` — a finished feature sitting behind an unset switch, which is
   * precisely the failure that kept this entire product on demo fixtures until 2026-09-09. A gate
   * whose only possible effect is to hide working code is not caution.
   */
  async getSnapshot() {
    const timestamp = new Date().toISOString()
    const leagueId = await resolveActiveLeagueId()
    if (!leagueId) {
      return { data: null, error: unavailable('No active league could be resolved for this session.'), source: 'live', timestamp }
    }

    const snapshot = await readLeagueSettingsSnapshot(leagueId)
    if (!snapshot) {
      return { data: null, error: unavailable('This league could not be read.'), source: 'live', timestamp }
    }

    /*
     * A snapshot whose every entry is null is returned rather than errored. "We hold no rules for
     * this league" is a true and useful answer — it tells a commissioner their import did not capture
     * settings, which is something they can act on — and the view renders each null as "not captured"
     * rather than as a blank. An error here would replace a specific finding with a generic failure.
     */
    return { data: snapshot, error: null, source: 'live', timestamp }
  },
}
