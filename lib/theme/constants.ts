/**
 * Global theme system — Light, Dark, AF Legacy, System.
 * Used by: ThemeProvider, ModeToggle, layout script, SyncProfilePreferences, API profile.
 * Applies across: Landing, Sports app, Dashboard, Settings.
 */

export type ThemeId = 'light' | 'dark' | 'legacy' | 'system'

export const THEME_STORAGE_KEY = 'af_mode'
export const THEME_COOKIE_KEY = 'af_mode'

/**
 * Default theme when none is stored (must match layout script default).
 *
 * ⚠ DARK ON PURPOSE. The flagship signed-in surfaces are authored dark, and the
 * light-mode readability clamp covers only part of their palette — a fresh user
 * defaulted to light landed on the screens the product renders worst. Default
 * dark puts new users in the theme the product is actually built for; light
 * remains one toggle away.
 */
export const DEFAULT_THEME: ThemeId = 'dark'

export const THEME_IDS: ThemeId[] = ['light', 'dark', 'legacy', 'system']

export const THEME_DISPLAY_NAMES: Record<ThemeId, string> = {
  light: 'Light',
  dark: 'Dark',
  legacy: 'AF Legacy',
  system: 'System',
}

export function getThemeDisplayName(id: ThemeId): string {
  return THEME_DISPLAY_NAMES[id] ?? id
}

function systemPrefersLight(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches
  } catch {
    return false
  }
}

export function isValidTheme(value: string | null | undefined): value is ThemeId {
  return value === 'light' || value === 'dark' || value === 'legacy' || value === 'system'
}

/**
 * Normalize any string to a valid stored theme (what we persist in profile / localStorage).
 */
export function normalizeStoredTheme(value: string | null | undefined): ThemeId {
  if (value === 'light' || value === 'dark' || value === 'legacy' || value === 'system') {
    return value
  }
  if (value === 'af') return 'legacy'
  return DEFAULT_THEME
}

/**
 * Value for `data-mode` on <html>: `system` resolves to light or dark (legacy unchanged).
 * Fallback effective paint matches `DEFAULT_THEME` (currently light when unset/invalid input).
 */
export function resolveEffectiveDataMode(value: string | null | undefined): 'light' | 'dark' | 'legacy' {
  const stored = normalizeStoredTheme(value)
  if (stored === 'legacy') return 'legacy'
  if (stored === 'system') {
    return systemPrefersLight() ? 'light' : 'dark'
  }
  if (stored === 'light' || stored === 'dark') return stored
  const d = DEFAULT_THEME
  if (d === 'legacy') return 'legacy'
  if (d === 'system') return systemPrefersLight() ? 'light' : 'dark'
  return d
}

/**
 * @deprecated Use `normalizeStoredTheme` (persisted) or `resolveEffectiveDataMode` (DOM).
 * Kept for incremental migration — same as `normalizeStoredTheme`.
 */
export function resolveTheme(value: string | null | undefined): ThemeId {
  return normalizeStoredTheme(value)
}

/** Cycle order: light → dark → legacy → system → light. */
export function getNextTheme(current: ThemeId): ThemeId {
  if (current === 'light') return 'dark'
  if (current === 'dark') return 'legacy'
  if (current === 'legacy') return 'system'
  return 'light'
}
