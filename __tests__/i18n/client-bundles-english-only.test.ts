import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { translations } from '@/lib/i18n/translations'
import { translationsEn } from '@/lib/i18n/translations-en'

/*
 * 🛑 The root-layout language provider shipped every language (~1.15 MB decoded) on every page and
 * re-downloaded English from /api/i18n/translations each load (2026-11-23). It must import English only,
 * statically; other languages load as their own chunk when chosen.
 */
const provider = readFileSync(join(process.cwd(), 'components/i18n/LanguageProviderClient.tsx'), 'utf8')

describe('client language bundle', () => {
  it('the provider statically imports the English dictionary only', () => {
    expect(provider).toMatch(/^import \{ translationsEn \} from "@\/lib\/i18n\/translations-en";$/m)
    expect(provider).not.toMatch(/^import [^\n]*from ["']@\/lib\/i18n\/translations["']/m)
    expect(provider).not.toMatch(/^import [^\n]*translations-es-parity/m)
  })

  it('other languages load lazily, from the combined module', () => {
    expect(provider).toMatch(/await import\("@\/lib\/i18n\/translations"\)/)
  })

  it('English makes no dictionary request', () => {
    expect(provider).toMatch(/if \(language === "en"\) return; \/\/ Bundled in full/)
  })

  it('the combined dictionary uses the very same English object', () => {
    expect(translations.en).toBe(translationsEn)
    expect(Object.keys(translationsEn).length).toBeGreaterThan(7000)
  })
})
