import { describe, expect, it } from 'vitest'
import { HUB_WAIVER_TYPE_OPTIONS } from '@/components/league-settings/tabs/WaiversTab'
import { translationsEn } from '@/lib/i18n/translations-en'
import { translationsEsParity } from '@/lib/i18n/translations-es-parity'

/** Every waiver option is explained next to it, in English and Spanish (owner, 2026-11-26). */
describe('waiver option explanations', () => {
  it.each(HUB_WAIVER_TYPE_OPTIONS.map((o) => o.value))('%s has a one-line explanation in both languages', (type) => {
    const key = `lsHub.wv.explain.${type}`
    expect((translationsEn as Record<string, string>)[key]?.length).toBeGreaterThan(20)
    expect((translationsEsParity as Record<string, string>)[key]?.length).toBeGreaterThan(20)
  })

  it('the FAAB budget is explained too', () => {
    expect((translationsEn as Record<string, string>)['lsHub.wv.budgetHint']).toBeTruthy()
    expect((translationsEsParity as Record<string, string>)['lsHub.wv.budgetHint']).toBeTruthy()
  })
})
