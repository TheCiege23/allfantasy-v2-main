/**
 * Twist presets: one choice that sets how many twists a Survivor season has, so a commissioner new
 * to the format never has to read every setting. Pure and client-safe.
 *
 *  - simple   one Immunity Idol per tribe, no Exile, no surprise tribes
 *  - classic  the defaults: 7 idols drawn at random, Exile Island on
 *  - full     8 idols, Exile on, a surprise two-tribe week after the merge, and the top two
 *             tribes immune when there are three or more tribes
 *
 * A preset only writes settings that exist already; every one can still be changed on its own
 * before the draft, after which the league reads as "custom".
 */

import type { SurvivorFoundationSettings } from './survivorSettings'
import { SURVIVOR_IDOL_COUNT_DEFAULT } from './survivorIdolTypes'

export const SURVIVOR_TWIST_PRESET_IDS = ['simple', 'classic', 'full'] as const
export type SurvivorTwistPresetId = (typeof SURVIVOR_TWIST_PRESET_IDS)[number]
export const SURVIVOR_TWIST_PRESET_DEFAULT: SurvivorTwistPresetId = 'classic'
/** League settings key holding the preset the commissioner last chose. */
export const SURVIVOR_TWIST_PRESET_SETTING = 'survivor_twist_preset'

export const SURVIVOR_TWIST_PRESETS: Record<SurvivorTwistPresetId, { label: string; tagline: string; bullets: string[] }> = {
  simple: {
    label: 'Simple',
    tagline: 'Easy to learn. Great for a first Survivor season.',
    bullets: ['One Immunity Idol per tribe', 'No Exile Island: voted out means out', 'No surprise tribes'],
  },
  classic: {
    label: 'Classic',
    tagline: 'The full Survivor experience, as most people know it.',
    bullets: [`${SURVIVOR_IDOL_COUNT_DEFAULT} hidden idols`, 'Exile Island with a way back', 'Tribes, merge, jury and finale'],
  },
  full: {
    label: 'Full twists',
    tagline: 'For groups that want chaos every week.',
    bullets: ['8 hidden idols', 'Exile Island with a way back', 'A surprise tribe week after the merge', 'Top two tribes immune with 3+ tribes'],
  },
}

export function isSurvivorTwistPresetId(value: unknown): value is SurvivorTwistPresetId {
  return typeof value === 'string' && (SURVIVOR_TWIST_PRESET_IDS as readonly string[]).includes(value)
}

type FoundationPatch = Pick<SurvivorFoundationSettings,
  'idolsEnabled' | 'idolCount' | 'exileIslandEnabled' | 'eliminationOutcome' | 'postMergeSurpriseTribeWeeks' | 'twoHighestTribesImmune'>

/** Simple's idols: one Immunity Idol (the always-in, playable type) per tribe. */
export function simplePresetIdolTypeIds(tribeCount: number): string[] {
  const count = Math.max(2, Math.min(4, Math.round(tribeCount)))
  return Array.from({ length: count }, () => 'immunity')
}

/** The foundation settings a preset writes. */
export function survivorTwistFoundationPatch(id: SurvivorTwistPresetId, tribeCount: number): FoundationPatch {
  switch (id) {
    case 'simple':
      return { idolsEnabled: true, idolCount: simplePresetIdolTypeIds(tribeCount).length, exileIslandEnabled: false, eliminationOutcome: 'removed_to_waivers', postMergeSurpriseTribeWeeks: 0, twoHighestTribesImmune: false }
    case 'full':
      return { idolsEnabled: true, idolCount: 8, exileIslandEnabled: true, eliminationOutcome: 'exile_island', postMergeSurpriseTribeWeeks: 1, twoHighestTribesImmune: tribeCount >= 3 }
    default:
      return { idolsEnabled: true, idolCount: SURVIVOR_IDOL_COUNT_DEFAULT, exileIslandEnabled: true, eliminationOutcome: 'exile_island', postMergeSurpriseTribeWeeks: 0, twoHighestTribesImmune: false }
  }
}

export type SurvivorTwistIdolConfig = { mode: 'random'; count: number; pickedTypeIds: [] } | { mode: 'pick'; count: number; pickedTypeIds: string[] }

/** The idol setup a preset saves: Simple picks its idols, Classic and Full draw at random. */
export function survivorTwistIdolConfig(id: SurvivorTwistPresetId, tribeCount: number): SurvivorTwistIdolConfig {
  if (id === 'simple') {
    const picked = simplePresetIdolTypeIds(tribeCount)
    return { mode: 'pick', count: picked.length, pickedTypeIds: picked }
  }
  return { mode: 'random', count: id === 'full' ? 8 : SURVIVOR_IDOL_COUNT_DEFAULT, pickedTypeIds: [] }
}

/**
 * Which preset the league's current settings match, or 'custom' once any of them was changed by
 * hand. `idol` is the saved idol setup (mode, count and picks), when there is one.
 */
export function detectSurvivorTwistPreset(
  settings: Pick<SurvivorFoundationSettings, keyof FoundationPatch | 'tribeCount'>,
  idol: { mode: string; count: number; pickedTypeIds: readonly string[] } | null,
): SurvivorTwistPresetId | 'custom' {
  for (const id of SURVIVOR_TWIST_PRESET_IDS) {
    const patch = survivorTwistFoundationPatch(id, settings.tribeCount)
    const expected = survivorTwistIdolConfig(id, settings.tribeCount)
    const foundationMatches = (Object.keys(patch) as Array<keyof FoundationPatch>)
      .filter(key => key !== 'idolCount')
      .every(key => settings[key] === patch[key])
    const idolMatches = idol
      ? idol.mode === expected.mode && idol.count === expected.count &&
        (expected.mode === 'random' || [...idol.pickedTypeIds].sort().join() === [...expected.pickedTypeIds].sort().join())
      : expected.mode === 'random' && expected.count === SURVIVOR_IDOL_COUNT_DEFAULT
    if (foundationMatches && idolMatches) return id
  }
  return 'custom'
}
