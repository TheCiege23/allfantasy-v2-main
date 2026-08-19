import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LANG,
  FUTURE_LANGUAGE_CODES,
  getIntlLocale,
  getLanguageOptionLabel,
  getLanguageSupportStatus,
  getLanguageTextDirection,
  resolveLanguage,
} from '@/lib/i18n/constants'
import {
  formatLocalizedCurrency,
  formatLocalizedDate,
  formatLocalizedNumber,
  resolveIntlLocale,
} from '@/lib/i18n/formatting'

describe('i18n foundation', () => {
  it('resolves unsupported language codes to the default language', () => {
    expect(resolveLanguage('de')).toBe(DEFAULT_LANG)
    expect(resolveLanguage('')).toBe(DEFAULT_LANG)
    expect(resolveLanguage(null)).toBe(DEFAULT_LANG)
    expect(resolveLanguage(undefined)).toBe(DEFAULT_LANG)
  })

  it('classifies incomplete languages without pretending they are production-ready', () => {
    expect(getLanguageSupportStatus('en')).toBe('production-ready')
    expect(getLanguageSupportStatus('es')).toBe('partial')
    expect(getLanguageOptionLabel('es')).toContain('Partial')
    expect(getLanguageSupportStatus('zh')).toBe('beta')
    expect(getLanguageSupportStatus('fil')).toBe('beta')
    expect(getLanguageSupportStatus('vi')).toBe('beta')
    for (const lang of FUTURE_LANGUAGE_CODES) {
      expect(getLanguageSupportStatus(lang)).toBe('future-only')
      expect(getLanguageOptionLabel(lang)).toContain('Coming Soon')
    }
  })

  it('exposes text direction for RTL readiness', () => {
    expect(getLanguageTextDirection('en')).toBe('ltr')
    expect(getLanguageTextDirection('es')).toBe('ltr')
    expect(getLanguageTextDirection('ar')).toBe('rtl')
  })

  it('maps app language codes to Intl-compatible locales', () => {
    expect(getIntlLocale('en')).toBe('en-US')
    expect(getIntlLocale('es')).toBe('es')
    expect(getIntlLocale('zh')).toBe('zh-CN')
    expect(resolveIntlLocale('bogus')).toBe('en-US')
  })

  it('formats dates, numbers, and currency through the shared locale helpers', () => {
    const date = new Date(Date.UTC(2026, 6, 1, 16, 30, 0))

    expect(formatLocalizedDate(date, 'en', { month: 'short', day: 'numeric', timeZone: 'UTC' })).toBe('Jul 1')
    expect(formatLocalizedNumber(1234567.89, 'en')).toBe('1,234,567.89')
    expect(formatLocalizedCurrency(12.5, 'en')).toBe('$12.50')
  })
})
