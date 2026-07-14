/**
 * Global language (i18n) system. English & Spanish.
 */

export {
  LANG_STORAGE_KEY,
  LANG_COOKIE_KEY,
  DEFAULT_LANG,
  SUPPORTED_LANGUAGES,
  LANGUAGE_DISPLAY_NAMES,
  LANGUAGE_INTL_LOCALE,
  LANGUAGE_SUPPORT_STATUS,
  LANGUAGE_TEXT_DIRECTION,
  PRODUCTION_LANGUAGE_CODES,
  BETA_LANGUAGE_CODES,
  FUTURE_LANGUAGE_CODES,
  getLanguageDisplayName,
  getLanguageOptionLabel,
  getLanguageSupportStatus,
  getLanguageTextDirection,
  getIntlLocale,
  resolveLanguage,
  type LanguageCode,
  type LanguageSupportStatus,
  type TextDirection,
} from './constants'

export { translations } from './translations'
export {
  formatLocalizedCurrency,
  formatLocalizedDate,
  formatLocalizedNumber,
  formatLocalizedTime,
  resolveIntlLocale,
  type LocaleInput,
} from './formatting'
