// @vitest-environment node
/**
 * The /legacy-import "Provider connection details" copy followed the provider config the wrong
 * way round: it called Fantrax, MFL and Fleaflicker "coming soon" — all three live — and told users
 * any member "with a linked Yahoo account can import", while Yahoo is switched off. It now says how
 * each live platform imports, and only Yahoo is "not available yet". Pinned against
 * provider-ui-config's `available` flags, so the two cannot drift apart again.
 */
import { describe, expect, it } from 'vitest'

import { translations } from '@/lib/i18n/translations'
import { IMPORT_PROVIDER_UI_OPTIONS } from '@/lib/league-import/provider-ui-config'

const NOT_YET = { en: /coming soon|not available yet|isn't available yet/i, es: /pronto|aún no está disponible/i }

describe('import provider help copy', () => {
  it.each(['en', 'es'] as const)('%s: each platform detail says "not yet" exactly when the config has it off', (lang) => {
    const checked: string[] = []
    for (const o of IMPORT_PROVIDER_UI_OPTIONS) {
      const detail = translations[lang][`import.provider.${o.provider}.detail`]
      if (detail === undefined) continue
      checked.push(o.provider)
      expect(NOT_YET[lang].test(detail), `${lang} ${o.provider}: "${detail}"`).toBe(!o.available)
    }
    // Positive control: the loop really saw the platforms it is about, including one that is off.
    expect(checked).toEqual(expect.arrayContaining(['sleeper', 'espn', 'yahoo', 'fantrax', 'mfl', 'fleaflicker']))
    expect(IMPORT_PROVIDER_UI_OPTIONS.some((o) => !o.available && checked.includes(o.provider))).toBe(true)
  })

  it.each(['en', 'es'] as const)('%s: the help sentence no longer calls a live platform "coming soon"', (lang) => {
    const help = translations[lang]['import.providerHelp']
    for (const live of ['Fantrax', 'MFL', 'Fleaflicker']) {
      expect(help).toContain(live)
    }
    expect(help).not.toMatch(lang === 'en' ? /Fleaflicker import is coming soon/ : /Fleaflicker estará disponible pronto/)
    expect(help).toMatch(/Yahoo/)
  })
})
