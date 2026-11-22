import { getLanguageTextDirection, resolveLanguage, type LanguageCode } from "@/lib/i18n/constants";
import { setAppIntlLanguage } from "@/lib/i18n/appLocale";
import { THEME_SYSTEM_RESOLVED_COOKIE_KEY, normalizeStoredTheme, resolveEffectiveDataMode } from "@/lib/theme";

function getDocumentElement(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.documentElement;
}

export function applyThemeToDocument(
  value: string | null | undefined
): "light" | "dark" | "legacy" {
  const resolved = resolveEffectiveDataMode(value);
  const root = getDocumentElement();
  if (root) {
    root.setAttribute("data-mode", resolved);
    root.style.colorScheme = resolved === "light" ? "light" : "dark";
  }
  // Remember what System resolved to so the server paints it on the next load.
  if (normalizeStoredTheme(value) === "system" && resolved !== "legacy") {
    try {
      document.cookie = `${THEME_SYSTEM_RESOLVED_COOKIE_KEY}=${resolved}; path=/; max-age=31536000; samesite=lax`;
    } catch {}
  }
  return resolved;
}

export function applyLanguageToDocument(
  value: string | null | undefined
): LanguageCode {
  const resolved = resolveLanguage(value);
  const root = getDocumentElement();
  if (root) {
    root.setAttribute("lang", resolved);
    root.setAttribute("data-lang", resolved);
    // The server sets `dir` from the cookie (app/layout.tsx); keep it in step on a live switch,
    // or a right-to-left language picked in-session would lay out left-to-right until reload.
    root.setAttribute("dir", getLanguageTextDirection(resolved));
  }
  // Numbers and dates across /core read this (lib/i18n/appLocale.ts).
  setAppIntlLanguage(resolved);
  return resolved;
}

