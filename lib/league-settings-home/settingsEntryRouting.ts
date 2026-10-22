/**
 * One place for every league setting (2026-10-18, part 2). On a NATIVE league every way into
 * league or commissioner settings — the old settings modal's panel ids, `?settingsPanel=` deep links
 * (draft room gear, notification `actionHref`s, Chimmy), the commissioner workspace buttons, the
 * setup checklist — resolves here to the League Settings page (`?view=settings`) or one of its
 * sub-pages, so a commissioner always lands in the same place.
 *
 * Pure: no React, no router. Imported leagues never consult it — their settings modal is unchanged.
 */

import type { SettingsSubPageId } from './buildLeagueSettingsHome'

/** Every sub-page id the League Settings page can open. */
export const SETTINGS_SUB_PAGE_IDS: readonly SettingsSubPageId[] = [
  'general',
  'format',
  'roster',
  'scoring',
  'draft',
  'waivers',
  'trades',
  'guillotine-first-chop',
  'guillotine-chop-rules',
  'guillotine-rules',
  'playoffs',
  'members',
  'co-commissioners',
  'divisions',
  'ai',
  'commissioner-tools',
  'settings-lock',
  'score-adjustments',
  'survivor-tribes',
]

/**
 * Old entry ids → where they land now. `null` = the settings list itself. Keys are lower-case; the
 * lookup lower-cases its input. Sub-page ids map to themselves (added below), so a new link can
 * name the sub-page directly: `?settingsPanel=commissioner-tools`.
 */
export const LEGACY_SETTINGS_PANEL_TO_SUB_PAGE: Readonly<Record<string, SettingsSubPageId | null>> = {
  // The list itself
  settings: null,
  'league-settings': null,
  hub: null,
  // LeagueSettingsModal GENERAL / COMMISH cards and the control-center tab ids
  'general-info': 'general',
  'commish-general': 'general',
  conceptrules: 'format',
  'concept-rules': 'format',
  'devy-command-center': 'format',
  rosters: 'roster',
  'draft-settings': 'draft',
  waiver: 'waivers',
  trade: 'trades',
  playoff: 'playoffs',
  'members-commish': 'members',
  managers: 'members',
  'division-settings': 'divisions',
  'ai-settings': 'ai',
  commissioner: 'commissioner-tools',
  permissions: 'commissioner-tools',
  'commish-controls': 'commissioner-tools',
  'league-dues': 'commissioner-tools',
  dues: 'commissioner-tools',
  'league-history-commish': 'commissioner-tools',
  tribes: 'survivor-tribes',
  'tribe-setup': 'survivor-tribes',
  ...Object.fromEntries(SETTINGS_SUB_PAGE_IDS.map((id) => [id, id])),
}

/**
 * Where an old settings entry lands on a native league.
 * - a sub-page id → open that sub-page of the League Settings page
 * - `null` → the League Settings list (no panel, or a panel that means "settings")
 * - `undefined` → NOT a league setting (my team, notifications, invite sheet, draft results, AI
 *   feature cards, IDP panels…): keep opening the old modal panel for it.
 */
export function resolveLegacySettingsPanel(panel: string | null | undefined): SettingsSubPageId | null | undefined {
  const key = String(panel ?? '').trim().toLowerCase()
  if (!key) return null
  return Object.prototype.hasOwnProperty.call(LEGACY_SETTINGS_PANEL_TO_SUB_PAGE, key)
    ? LEGACY_SETTINGS_PANEL_TO_SUB_PAGE[key]
    : undefined
}

/** `/league/:id?view=settings[&settingsPanel=<sub-page>]` — the canonical link for a native league. */
export function leagueSettingsHomeHref(leagueId: string, subPage?: SettingsSubPageId | null): string {
  const base = `/league/${encodeURIComponent(leagueId)}?view=settings`
  return subPage ? `${base}&settingsPanel=${encodeURIComponent(subPage)}` : base
}

/**
 * Query string for the `/league/:id/settings` redirect: always `view=settings`, and an old
 * `?settingsPanel=` / `?panel=` carried over so a bookmarked or notified link keeps its target.
 */
export function legacySettingsRouteQuery(search: Record<string, string | string[] | undefined>): string {
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || ''
  const panel = pick(search.settingsPanel) || pick(search.panel)
  const params = new URLSearchParams({ view: 'settings' })
  if (panel) params.set('settingsPanel', panel)
  return params.toString()
}
