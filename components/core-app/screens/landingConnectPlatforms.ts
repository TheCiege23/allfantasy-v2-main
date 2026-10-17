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
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'

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

/** The live platforms' names, in config order — what the landing copy lists in its sentences. */
export function getLandingLivePlatformNames(
  options: ReadonlyArray<Pick<(typeof IMPORT_PROVIDER_UI_OPTIONS)[number], 'provider' | 'label' | 'available'>> =
    IMPORT_PROVIDER_UI_OPTIONS,
): string[] {
  return getLandingConnectPlatforms(options)
    .filter((p) => p.state === 'live')
    .map((p) => p.name)
}

/*
 * ⚠ TWO SPORT LISTS, BECAUSE THERE ARE TWO TRUE ANSWERS. The strip used to print
 * "NFL · NBA · NHL · MLB · NCAA · SOCCER" under "Connects to", which reads as an import claim —
 * and every import today is football (the config's `supportedSports`). Leagues CREATED here run
 * all seven sports (`SUPPORTED_SPORTS`). Both are shown, each under its own label, and both are
 * read from the config that decides them, so neither can overclaim.
 */

/** Sports a live platform can import today, in `SUPPORTED_SPORTS` order. */
export function getLandingImportSports(
  options: ReadonlyArray<Pick<(typeof IMPORT_PROVIDER_UI_OPTIONS)[number], 'available' | 'supportedSports'>> =
    IMPORT_PROVIDER_UI_OPTIONS,
): string[] {
  const live = new Set<string>(options.filter((o) => o.available).flatMap((o) => o.supportedSports))
  return SUPPORTED_SPORTS.filter((s) => live.has(s))
}

/** Sports a league created on AllFantasy can run. */
export function getLandingCreateSports(): string[] {
  return [...SUPPORTED_SPORTS]
}
