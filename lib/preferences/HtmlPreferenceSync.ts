import {
  DEFAULT_LANG,
  LANG_STORAGE_KEY,
  resolveLanguage,
  type LanguageCode,
} from "@/lib/i18n/constants";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  normalizeStoredTheme,
  resolveEffectiveDataMode,
} from "@/lib/theme";

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
  }
  return resolved;
}

export function buildThemeInitScript(serverMode?: string | null): string {
  const fallbackStored = normalizeStoredTheme(serverMode ?? DEFAULT_THEME);
  const fallbackEffective = resolveEffectiveDataMode(serverMode ?? DEFAULT_THEME);
  const fallbackColorScheme = fallbackEffective === "light" ? "light" : "dark";

  return `
    (function(){
      try {
        var fallbackEffective = ${JSON.stringify(fallbackEffective)};
        var raw = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
        var stored = raw;
        if (stored !== "dark" && stored !== "light" && stored !== "legacy" && stored !== "system") {
          stored = ${JSON.stringify(fallbackStored)};
        }
        var eff;
        if (stored === "legacy") eff = "legacy";
        else if (stored === "system") {
          try {
            eff = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
          } catch (e) {
            eff = fallbackEffective === "legacy" ? "dark" : fallbackEffective;
          }
        } else if (stored === "light" || stored === "dark") eff = stored;
        else eff = fallbackEffective === "legacy" ? "dark" : fallbackEffective;
        document.documentElement.setAttribute("data-mode", eff);
        document.documentElement.style.colorScheme = eff === "light" ? "light" : "dark";
      } catch (e) {
        document.documentElement.setAttribute("data-mode", ${JSON.stringify(fallbackEffective)});
        document.documentElement.style.colorScheme = ${JSON.stringify(fallbackColorScheme)};
      }
    })();
  `;
}

export function buildLanguageInitScript(serverLang?: string | null): string {
  const fallbackLanguage = resolveLanguage(serverLang ?? DEFAULT_LANG);

  return `
    (function(){
      try {
        var fallbackLang = ${JSON.stringify(fallbackLanguage)};
        var lang = localStorage.getItem(${JSON.stringify(LANG_STORAGE_KEY)}) || fallbackLang;
        if (lang !== "en" && lang !== "es" && lang !== "zh" && lang !== "fil" && lang !== "vi") lang = fallbackLang;
        document.documentElement.setAttribute("lang", lang);
        document.documentElement.setAttribute("data-lang", lang);
      } catch (e) {
        document.documentElement.setAttribute("lang", ${JSON.stringify(fallbackLanguage)});
        document.documentElement.setAttribute("data-lang", ${JSON.stringify(fallbackLanguage)});
      }
    })();
  `;
}
