/**
 * The landing page's "Connects to" strip, derived from the import availability config.
 *
 * 🛑 THIS USED TO BE A HARDCODED LIST, AND IT DRIFTED FOR TWO WEEKS. `LandingV4` carried its own
 * `PLATFORMS` array, so when Fantrax and MFL flipped to available on 2026-08-27 the public page kept
 * saying "MFL · Fantrax — soon", and Fleaflicker, live the same week, was never on it at all.
 * `lib/league-import/provider-ui-config.ts` is the authority for whether a real user can import from a
 * platform today (its header says so), so the strip reads it rather than restating it.
 *
 * Only the NAME is local. The config's labels are written for the import screen
 * ("MyFantasyLeague (MFL)"), which is too long for a row of chips. Whether a platform is live is
 * never decided here.
 */

import { IMPORT_PROVIDER_UI_OPTIONS } from '@/lib/league-import/provider-ui-config'
import type { ImportProvider } from '@/lib/league-import/types'

export type LandingConnectPlatform = {
  provider: ImportProvider
  name: string
  state: 'live' | 'soon'
}

const STRIP_NAMES: Partial<Record<ImportProvider, string>> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  fantrax: 'Fantrax',
  mfl: 'MFL',
  fleaflicker: 'Fleaflicker',
}

export function getLandingConnectPlatforms(
  options: ReadonlyArray<Pick<(typeof IMPORT_PROVIDER_UI_OPTIONS)[number], 'provider' | 'label' | 'available'>> =
    IMPORT_PROVIDER_UI_OPTIONS,
): LandingConnectPlatform[] {
  return options.map((o) => ({
    provider: o.provider,
    name: STRIP_NAMES[o.provider] ?? o.label,
    state: o.available ? 'live' : 'soon',
  }))
}
