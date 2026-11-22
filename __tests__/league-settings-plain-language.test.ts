/**
 * League Settings speaks to commissioners, not to developers. Every user-facing settings string
 * (`lsHub.*`, `lsEd.*`) is scanned for implementation words — "JSON", "API", "canonical",
 * "backend"… — which used to show up in help text ("…attach commissioner metadata to the league
 * JSON blob", "Audit logging is ready to be wired"). A word here has to mean something to a
 * commissioner or it does not belong on the page.
 */
import { describe, expect, it } from 'vitest'
import { translations } from '@/lib/i18n/translations'

const JARGON = /\b(JSON|API|canonical|backend|payload|endpoint|schema|database|cron|enum|null|PATCH|wired|metadata|blob)\b/i

/** Keys no screen renders (verified by grep when this was written); kept for old imports only. */
const UNRENDERED = new Set(['lsEd.ro.importNotObject', 'lsEd.ro.invalidJson', 'lsEd.ro.importedJson'])

describe('League Settings copy is plain language', () => {
  it('has no developer jargon in any rendered settings string', () => {
    const offenders = Object.entries(translations.en)
      .filter(([key]) => (key.startsWith('lsHub.') || key.startsWith('lsEd.')) && !UNRENDERED.has(key))
      .filter(([, text]) => JARGON.test(text))
      .map(([key, text]) => `${key}: ${text}`)
    expect(offenders).toEqual([])
  })
})
