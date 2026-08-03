import type { LandingLocale } from './index'

let activeLocale: LandingLocale = 'en'

export function getActiveLandingLocale(): LandingLocale {
  return activeLocale
}

export function setActiveLandingLocale(locale: LandingLocale): void {
  activeLocale = locale
}
