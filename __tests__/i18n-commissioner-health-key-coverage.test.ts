import { describe, expect, it } from 'vitest'

import { translations } from '@/lib/i18n/translations'

/**
 * Every commissioner-health label exists in every locale.
 *
 * ── WHY THIS IS NOT COVERED ALREADY ─────────────────────────────────────────────────────────
 * `i18n-placeholder-parity.test.ts` checks that `{{placeholder}}` names agree between en and es
 * **for keys present in both** — it explicitly `continue`s past a key missing from one side. So a
 * label added to English and forgotten elsewhere passes every existing guard, and the failure is
 * silent: the UI renders the raw key, or English, to someone who reads neither.
 *
 * ⚠ THE PARTICIPATION KEY WAS ADDED TO FIVE LOCALES BY A SCRIPT ANCHORED POSITIONALLY, because
 * the English and Tagalog blocks render `…health.engagement` as the byte-identical string
 * "Engagement" — matching on the value would have inserted into whichever came first and skipped
 * the other. This is the check that the positional assumption held.
 */

const LOCALES = Object.keys(translations) as Array<keyof typeof translations>

const COMMISSIONER_HEALTH_KEYS = [
  'dashboard.warroom.commissionerHQ.health.participation',
  'dashboard.warroom.commissionerHQ.health.engagement',
  'dashboard.warroom.commissionerHQ.health.engagementScore',
  'dashboard.warroom.commissionerHQ.health.activeManagers',
]

describe('commissioner-health labels are translated everywhere', () => {
  it('the file carries the locales this expects', () => {
    /*
     * Pinned so adding a locale fails here — loudly, once — rather than in whatever surface the
     * untranslated key reaches first.
     *
     * ⚠ This assertion earned its keep on its first run: it was written expecting `tl` and the
     * file uses `fil`. Both are Filipino and the translation was unaffected, but a guard that
     * agrees with your assumptions cannot correct them.
     */
    expect(LOCALES.sort()).toEqual(['en', 'es', 'fil', 'vi', 'zh'])
  })

  for (const key of COMMISSIONER_HEALTH_KEYS) {
    it(`"${key}" is present in every locale`, () => {
      const missing = LOCALES.filter((l) => !(key in translations[l]))
      // Named, not counted: "expected 1 to be 0" would not say which language is broken.
      expect(missing).toEqual([])
    })

    it(`"${key}" is non-empty in every locale`, () => {
      const blank = LOCALES.filter((l) => !String(translations[l][key] ?? '').trim())
      expect(blank).toEqual([])
    })
  }

  it('🛑 participation is actually TRANSLATED, not English copied into every slot', () => {
    // The failure mode of a positional insert is writing the same string five times. Three of
    // these locales already render the neighbouring engagement key in their own language, so a
    // uniform value here would mean the script matched the wrong anchors.
    const values = LOCALES.map((l) => translations[l]['dashboard.warroom.commissionerHQ.health.participation'])
    expect(new Set(values).size).toBeGreaterThan(1)
    // And specifically: the non-Latin locale must not be sitting on the English word.
    expect(translations.zh['dashboard.warroom.commissionerHQ.health.participation']).not.toBe('Participation')
  })
})
