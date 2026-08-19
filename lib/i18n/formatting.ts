import { DEFAULT_LANG, getIntlLocale, resolveLanguage, type LanguageCode } from './constants'

export type LocaleInput = LanguageCode | string | null | undefined

export function resolveIntlLocale(locale?: LocaleInput): string {
  return getIntlLocale(resolveLanguage(locale ?? DEFAULT_LANG))
}

export function formatLocalizedDate(
  value: Date | string | number,
  locale?: LocaleInput,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(resolveIntlLocale(locale), options).format(date)
}

export function formatLocalizedTime(
  value: Date | string | number,
  locale?: LocaleInput,
  options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' },
): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(resolveIntlLocale(locale), options).format(date)
}

export function formatLocalizedNumber(
  value: number,
  locale?: LocaleInput,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(resolveIntlLocale(locale), options).format(value)
}

export function formatLocalizedCurrency(
  value: number,
  locale?: LocaleInput,
  currency = 'USD',
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(resolveIntlLocale(locale), {
    style: 'currency',
    currency,
    ...options,
  }).format(value)
}
