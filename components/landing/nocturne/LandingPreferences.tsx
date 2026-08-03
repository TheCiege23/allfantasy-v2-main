'use client'

import { useEffect, useState } from 'react'

export type LandingTheme = 'light' | 'dark' | 'af'
export type LandingLocale = 'en' | 'es' | 'zh' | 'fil' | 'vi'

const THEME_KEY = 'af-landing-theme'
const LOCALE_KEY = 'af-landing-locale'

const themeLabels: Record<LandingTheme, string> = {
  light: 'Light',
  dark: 'Dark',
  af: 'AF',
}

const localeLabels: Record<LandingLocale, string> = {
  en: 'English',
  es: 'Español',
  zh: '中文',
  fil: 'Filipino',
  vi: 'Tiếng Việt',
}

function isTheme(value: string | null): value is LandingTheme {
  return value === 'light' || value === 'dark' || value === 'af'
}

function isLocale(value: string | null): value is LandingLocale {
  return value === 'en' || value === 'es' || value === 'zh' || value === 'fil' || value === 'vi'
}

function applyTheme(theme: LandingTheme) {
  document.documentElement.dataset.landingTheme = theme
  document.querySelector<HTMLElement>('.nocturne')?.setAttribute('data-landing-theme', theme)
}

export function LandingPreferences() {
  const [theme, setTheme] = useState<LandingTheme>('dark')
  const [locale, setLocale] = useState<LandingLocale>('en')

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(THEME_KEY)
    const savedLocale = window.localStorage.getItem(LOCALE_KEY)
    const initialTheme = isTheme(savedTheme) ? savedTheme : 'dark'
    const browserLocale = window.navigator.language.toLowerCase()
    const inferredLocale: LandingLocale = browserLocale.startsWith('es')
      ? 'es'
      : browserLocale.startsWith('zh')
        ? 'zh'
        : browserLocale.startsWith('fil') || browserLocale.startsWith('tl')
          ? 'fil'
          : browserLocale.startsWith('vi')
            ? 'vi'
            : 'en'
    const initialLocale = isLocale(savedLocale) ? savedLocale : inferredLocale

    setTheme(initialTheme)
    setLocale(initialLocale)
    applyTheme(initialTheme)

    if (!savedLocale && initialLocale !== 'en') {
      window.localStorage.setItem(LOCALE_KEY, initialLocale)
      window.location.reload()
    }
  }, [])

  function changeTheme(nextTheme: LandingTheme) {
    setTheme(nextTheme)
    window.localStorage.setItem(THEME_KEY, nextTheme)
    applyTheme(nextTheme)
  }

  function changeLocale(nextLocale: LandingLocale) {
    setLocale(nextLocale)
    window.localStorage.setItem(LOCALE_KEY, nextLocale)
    window.location.reload()
  }

  return (
    <aside className="landing-preferences" aria-label="Display and language preferences">
      <div className="landing-preferences__group" role="group" aria-label="Color mode">
        {(Object.keys(themeLabels) as LandingTheme[]).map((option) => (
          <button
            key={option}
            type="button"
            className={theme === option ? 'is-active' : undefined}
            aria-pressed={theme === option}
            onClick={() => changeTheme(option)}
          >
            {themeLabels[option]}
          </button>
        ))}
      </div>

      <label className="landing-preferences__language">
        <span className="n-visually-hidden">Language</span>
        <select value={locale} onChange={(event) => changeLocale(event.target.value as LandingLocale)}>
          {(Object.keys(localeLabels) as LandingLocale[]).map((option) => (
            <option key={option} value={option}>
              {localeLabels[option]}
            </option>
          ))}
        </select>
      </label>
    </aside>
  )
}
