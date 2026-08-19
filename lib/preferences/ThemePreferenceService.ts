/**
 * Theme preference: read/write from localStorage (af_mode). Sync to API via PATCH /api/user/profile (themePreference).
 * Uses lib/theme for constants and resolution.
 */

import {
  THEME_STORAGE_KEY,
  THEME_COOKIE_KEY,
  DEFAULT_THEME,
  normalizeStoredTheme,
  type ThemeId,
} from "@/lib/theme"
import { applyThemeToDocument } from "@/lib/preferences/HtmlPreferenceSync"

export type ThemeMode = ThemeId

export function getStoredThemePreference(): ThemeMode | null {
  if (typeof window === "undefined") return null
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY)
    return value === null ? null : normalizeStoredTheme(value)
  } catch {}
  return null
}

export function getStoredTheme(): ThemeMode {
  return getStoredThemePreference() ?? DEFAULT_THEME
}

export function setStoredTheme(mode: ThemeMode): void {
  const stored = normalizeStoredTheme(mode)
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, stored)
  } catch {}
  try {
    document.cookie = `${THEME_COOKIE_KEY}=${stored}; path=/; max-age=31536000; samesite=lax`
  } catch {}
  try {
    applyThemeToDocument(stored)
  } catch {}
}
