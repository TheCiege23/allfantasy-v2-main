/**
 * Global theme system. Export constants and helpers for use across app.
 */

export {
  THEME_STORAGE_KEY,
  THEME_COOKIE_KEY,
  THEME_SYSTEM_RESOLVED_COOKIE_KEY,
  DEFAULT_THEME,
  THEME_IDS,
  THEME_DISPLAY_NAMES,
  getThemeDisplayName,
  isValidTheme,
  normalizeStoredTheme,
  resolveEffectiveDataMode,
  resolveServerDataMode,
  resolveTheme,
  getNextTheme,
  type ThemeId,
} from './constants'
