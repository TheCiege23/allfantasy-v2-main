/**
 * Island control's two commissioner edits (components/core-app/survivor/SurvivorIslandSettings.tsx):
 * the banner scene picker and the inline rulebook editor. Both save through the Survivor settings
 * screen's own POST (`/api/leagues/[leagueId]/survivor/settings-screen`), which takes the WHOLE form
 * and re-checks every lock and range itself, so this module only decides what to show and builds
 * that form. Pure.
 */
import {
  SURVIVOR_ISLAND_SCENES,
  SURVIVOR_SETTINGS_LIMITS,
  isSettingLocked,
  type SurvivorIslandScenePreference,
  type SurvivorSettingsForm,
  type SurvivorSettingsLocks,
} from '@/lib/survivor/survivorSettingsScreen'

/** What `GET .../survivor/settings-screen` answers, as far as Island control reads it. */
export type IslandSettingsState = {
  form: SurvivorSettingsForm
  locks: SurvivorSettingsLocks
  context: { managers: number; firstWeek: number; lastWeek: number }
}

/** The picker's choices: follow the season first, then every scene in the art folder. */
export const ISLAND_SCENE_CHOICES: readonly SurvivorIslandScenePreference[] = ['auto', ...SURVIVOR_ISLAND_SCENES]

/** The thumbnail for a choice; 'auto' shows the beach, where every season starts. */
export function sceneArt(choice: SurvivorIslandScenePreference): string {
  return `/survivor/scenes/${choice === 'auto' ? 'beach' : choice}.svg`
}

/**
 * The rules Island control edits in place. A subset of the settings screen, chosen because each is
 * a single field with no cross-field side effect (tribe count resets slots, Exile on/off changes the
 * elimination outcome, the swap needs a week); everything else stays on the full settings page.
 */
export const INLINE_RULE_KEYS = ['voteDay', 'voteTime', 'selfVotesAllowed', 'idolCount', 'exileReturnTokens', 'mergeWeek'] as const
export type InlineRuleKey = (typeof INLINE_RULE_KEYS)[number]
export type InlineRuleEdits = Partial<Pick<SurvivorSettingsForm, InlineRuleKey>>

export type InlineRuleField = { key: InlineRuleKey; locked: boolean }

/**
 * The fields to draw, each with the settings screen's own lock (isSettingLocked: after the draft
 * only the vote deadline changes). Exile tokens only when Exile is on, the merge week only when the
 * merge is by week, since otherwise the field means nothing.
 */
export function inlineRuleFields(state: Pick<IslandSettingsState, 'form' | 'locks'>): InlineRuleField[] {
  return INLINE_RULE_KEYS
    .filter((key) => (key === 'exileReturnTokens' ? state.form.exileEnabled : key === 'mergeWeek' ? state.form.mergeTrigger === 'week' : true))
    .map((key) => ({ key, locked: isSettingLocked(key, state.locks) }))
}

/** The whole form to post: the saved one with only the inline keys replaced (any other key is ignored). */
export function applyInlineEdits(form: SurvivorSettingsForm, edits: InlineRuleEdits): SurvivorSettingsForm {
  const next: SurvivorSettingsForm = { ...form }
  for (const key of INLINE_RULE_KEYS) {
    if (edits[key] !== undefined) (next as Record<InlineRuleKey, unknown>)[key] = edits[key]
  }
  return next
}

/** The whole form with a new banner scene, nothing else changed. */
export function withIslandScene(form: SurvivorSettingsForm, scene: SurvivorIslandScenePreference): SurvivorSettingsForm {
  return { ...form, islandScene: scene }
}

/** Idol count choices (the settings screen's own range). */
export function idolCountChoices(): number[] {
  const [min, max] = SURVIVOR_SETTINGS_LIMITS.idolCount
  return Array.from({ length: max - min + 1 }, (_, i) => min + i)
}

/** Exile token choices, keeping a stored value above the usual range selectable (as the settings screen does). */
export function exileTokenChoices(current: number): number[] {
  const [min, max] = SURVIVOR_SETTINGS_LIMITS.exileReturnTokens
  const top = Math.max(max, Number.isInteger(current) ? current : max)
  return Array.from({ length: top - min + 1 }, (_, i) => min + i)
}
