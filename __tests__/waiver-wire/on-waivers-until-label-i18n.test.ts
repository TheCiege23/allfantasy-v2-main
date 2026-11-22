/**
 * "On waivers until …" on the waiver wire (WaiverWirePage, NativeWaiversScreen) in Spanish (2026-10-26).
 *
 * The label was a hard-coded English template with the date formatted in the browser's default locale,
 * so a Spanish reader got "On waivers until mar 15:00". It now goes through `waiverClaim.onWaiversUntil`
 * and formats the date in the page's language; with no i18n passed it is the English it always was.
 */
import { describe, expect, it } from 'vitest'
import { translations } from '@/lib/i18n/translations'
import { tInterpolate } from '@/lib/i18n/tInterpolate'
import { onWaiversUntilDate, onWaiversUntilLabel } from '@/lib/waiver-wire/immediate-add-policy'

const UNTIL = new Date('2026-09-15T19:00:00Z')
const i18nFor = (language: 'en' | 'es') => ({
  language,
  tInterpolate: (key: string, vars: Record<string, string>) =>
    tInterpolate((k) => translations[language]?.[k] ?? translations.en[k] ?? k, key, vars),
})

describe('onWaiversUntilLabel', () => {
  it('🛑 without i18n it is exactly the English it was', () => {
    const date = UNTIL.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    expect(onWaiversUntilLabel(UNTIL)).toBe(`On waivers until ${date}`)
  })

  it('English through i18n matches the untranslated label', () => {
    expect(onWaiversUntilLabel(UNTIL, i18nFor('en'))).toBe(`On waivers until ${onWaiversUntilDate(UNTIL, 'en')}`)
  })

  it('Spanish reads «En reclamos hasta …» with a Spanish date and never says waiver', () => {
    const es = onWaiversUntilLabel(UNTIL, i18nFor('es'))
    const esDate = UNTIL.toLocaleString('es', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    expect(es).toBe(`En reclamos hasta el ${esDate}`)
    expect(es).not.toMatch(/waiver/i)
    expect(es).not.toContain('{{')
    // The weekday is Spanish, not the English "Tue".
    expect(esDate).not.toBe(UNTIL.toLocaleString('en', { weekday: 'short', hour: 'numeric', minute: '2-digit' }))
  })

  it('the key exists in both dictionaries', () => {
    expect(translations.en['waiverClaim.onWaiversUntil']).toBe('On waivers until {{date}}')
    expect(translations.es['waiverClaim.onWaiversUntil']).toMatch(/reclamos/)
    expect(translations.es['waiverClaim.onWaiversUntil']).not.toMatch(/waiver/i)
  })
})
