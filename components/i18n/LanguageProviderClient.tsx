"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { translations } from "@/lib/i18n/translations";
import { LANG_STORAGE_KEY, DEFAULT_LANG, resolveLanguage, type LanguageCode } from "@/lib/i18n/constants";
import { setStoredLanguage } from "@/lib/preferences/LanguagePreferenceService";
import { applyLanguageToDocument } from "@/lib/preferences/HtmlPreferenceSync";
import {
  tInterpolate as resolveTInterpolate,
  type InterpolationVars,
} from "@/lib/i18n/tInterpolate";

type Language = LanguageCode;

type LanguageContextValue = {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  /** Same as `interpolateTemplate(t(key), vars)` — for copy with `{{placeholders}}`. */
  tInterpolate: (key: string, vars?: InterpolationVars) => string;
};

const LanguageContext = createContext<LanguageContextValue | undefined>(
  undefined
);

function fallbackT(key: string) {
  return translations[DEFAULT_LANG]?.[key] ?? translations.en[key] ?? key;
}

export const defaultLanguageValue: LanguageContextValue = {
  language: DEFAULT_LANG,
  setLanguage: () => {},
  t: fallbackT,
  tInterpolate: (key: string, vars: InterpolationVars = {}) =>
    resolveTInterpolate(fallbackT, key, vars),
};

export function LanguageProviderClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANG);
  const [messages, setMessages] = useState<Record<string, string>>(() => {
    return translations[language] || translations.en;
  });
  const activeLanguageRef = useRef<Language>(language);
  /*
   * 🛑 A LANGUAGE SWITCH MUST RE-RENDER THE SERVER'S TEXT TOO (2026-10-03). Switching only set
   * client state, so every string a server component or a /core loader wrote stayed in the old
   * language until the next navigation — the owner switched to Spanish and saw English
   * explanations. `ServerRenderPreferenceResolver` was written for exactly this ("setStoredLanguage()
   * writes document.cookie synchronously before router.refresh() is called"), but nothing called
   * refresh except `LanguageToggle`, and only where a page opted in.
   *
   * ⚠ READ FROM THE CONTEXT, NOT `useRouter()`. `useRouter` THROWS when no App Router is mounted
   * ("invariant expected app router to be mounted"), and this provider is rendered bare in tests.
   * The context is simply null there, and the refresh is skipped.
   */
  const router = useContext(AppRouterContext);
  const refreshServerText = () => {
    try {
      router?.refresh();
    } catch {
      // A failed refresh leaves the old server text until the next navigation — never worse than before.
    }
  };

  useEffect(() => {
    activeLanguageRef.current = language;
  }, [language]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    const bootstrapped = document.documentElement.dataset.lang;
    const resolved = resolveLanguage(stored || bootstrapped);
    setLanguageState(resolved);
    /*
     * The server rendered in the COOKIE's language (`data-lang`), the client reads localStorage first.
     * When they disagree — a cookie that expired, or a switch made on another device — the page shows
     * two languages at once. Align the cookie and re-render the server text, once: after the refresh
     * the cookie matches, so this cannot loop.
     */
    if (stored && bootstrapped && resolveLanguage(stored) !== resolveLanguage(bootstrapped)) {
      try {
        setStoredLanguage(resolved);
      } catch {
        // ignore
      }
      refreshServerText();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount by design
  }, []);

  useEffect(() => {
    applyLanguageToDocument(language);
    // Immediately reflect language switch with bundled copy while remote dictionary loads.
    setMessages(translations[language] || translations.en);

    let cancelled = false;
    fetch(`/api/i18n/translations?lang=${encodeURIComponent(language)}`, {
      cache: "no-store",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { messages?: Record<string, string> } | null) => {
        if (cancelled || activeLanguageRef.current !== language) return;
        const next = data?.messages;
        if (next && typeof next === "object") {
          setMessages(next);
          return;
        }
        setMessages(translations[language] || translations.en);
      })
      .catch(() => {
        if (!cancelled && activeLanguageRef.current === language) {
          setMessages(translations[language] || translations.en);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [language]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== LANG_STORAGE_KEY) return;
      const resolved = resolveLanguage(event.newValue);
      const changed = resolved !== activeLanguageRef.current;
      setLanguageState(resolved);
      // Another tab switched; the cookie it wrote is this tab's cookie too.
      if (changed) refreshServerText();
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const setLanguage = (lang: Language) => {
    const resolved = resolveLanguage(lang);
    const changed = resolved !== activeLanguageRef.current;
    setLanguageState(resolved);
    try {
      // Writes the cookie SYNCHRONOUSLY, so the refresh below renders in the new language.
      setStoredLanguage(resolved);
    } catch {
      // ignore
    }
    if (changed) refreshServerText();

    fetch("/api/i18n/preference", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: resolved }),
    }).catch(() => {});
  };

  const value = useMemo<LanguageContextValue>(() => {
    const t = (key: string) => {
      const dict = messages || translations[language] || translations.en;
      // Remote dictionaries may be partial. Keep bundled Spanish before English.
      return dict[key] ?? translations[language]?.[key] ?? translations.en[key] ?? key;
    };
    return {
      language,
      setLanguage,
      t,
      tInterpolate: (key: string, vars: InterpolationVars = {}) =>
        resolveTInterpolate(t, key, vars),
    };
  }, [language, messages]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within LanguageProviderClient");
  }
  return ctx;
}

export function useOptionalLanguage() {
  return useContext(LanguageContext) ?? defaultLanguageValue;
}

