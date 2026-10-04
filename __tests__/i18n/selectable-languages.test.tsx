// @vitest-environment jsdom
/**
 * The language pickers offer only languages /core actually reads (owner's ruling, 2026-10-04).
 *
 * Chinese, Filipino and Vietnamese were offered as "(Beta)" while nearly all of /core rendered English
 * for them, and no account had chosen one. They are hidden like French and Arabic before them — still
 * valid as stored values, so nothing anyone saved breaks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import {
  BETA_LANGUAGE_CODES,
  SELECTABLE_LANGUAGES,
  getLanguageOptionLabel,
  resolveLanguage,
} from '@/lib/i18n/constants'

const h = vi.hoisted(() => ({ language: 'en' as string }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k }),
}))
vi.mock('@/components/auth/useOptionalSession', () => ({ useOptionalSession: () => ({ data: null, status: 'unauthenticated' }) }))

import LanguageToggle from '@/components/i18n/LanguageToggle'

afterEach(() => {
  cleanup()
  h.language = 'en'
})

describe('selectable languages', () => {
  it('🛑 the pickers offer English and Spanish only', () => {
    expect(SELECTABLE_LANGUAGES).toEqual(['en', 'es'])
    for (const code of BETA_LANGUAGE_CODES) expect(SELECTABLE_LANGUAGES).not.toContain(code)
  })

  it('a hidden language is still a valid stored value, and keeps its "(Beta)" label', () => {
    for (const code of ['zh', 'fil', 'vi'] as const) {
      expect(resolveLanguage(code)).toBe(code)
      expect(getLanguageOptionLabel(code)).toMatch(/\(Beta\)$/)
    }
  })

  it('the toggle offers only the two, but still shows a hidden language someone already has', () => {
    render(<LanguageToggle />)
    expect(screen.getAllByRole('option').map((o) => (o as HTMLOptionElement).value)).toEqual(['en', 'es'])
    cleanup()
    h.language = 'zh'
    render(<LanguageToggle />)
    expect(screen.getAllByRole('option').map((o) => (o as HTMLOptionElement).value)).toEqual(['en', 'es', 'zh'])
  })
})
