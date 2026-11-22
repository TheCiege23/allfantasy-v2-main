/**
 * Filipino (beta) strings are written in Taglish: established English UI and sports words stay English
 * on purpose ("Admin", "Password", "Playoffs", "Waiver Wire"), as do product names and placeholder-only
 * strings. Anything else that is identical to the English value was simply left untranslated — 35 such
 * strings were translated on 2026-11-09. A new English copy has to be translated or listed here.
 *
 * Keys missing from `fil` are a separate matter: a beta language falls back to English by design.
 */
import { describe, expect, it } from 'vitest'
import { translations } from '@/lib/i18n/translations'

const KEPT_ENGLISH_ON_PURPOSE = new Set([
  'common.admin',
  'common.password',
  'tokens.header.homeLink',
  'tokens.pricing.planSupreme',
  'tokens.pricing.planWarRoom',
  'tokens.pricing.planCommissioner',
  'tokens.pricing.planPro',
  'tokens.pricing.tokenBadge',
  'tokens.history.entryTypeRefund',
  'dashboard.warroom.injury.out',
  'dashboard.warroom.seasonOutlook.seedValue',
  'dashboard.pulse.summary.score',
  'dashboard.warroom.myLeagueCard.waiversNote',
  'dashboard.warroom.lifecycle.playoffs',
  'dashboard.warroom.waiverWire.title',
])

describe('Filipino strings', () => {
  it('are translated unless they are kept in English on purpose', () => {
    const en = translations.en as Record<string, string>
    const fil = translations.fil as Record<string, string>
    const untranslated = Object.keys(fil).filter(
      (key) => fil[key] === en[key] && /[a-z]{3,}/i.test(en[key] ?? '') && !KEPT_ENGLISH_ON_PURPOSE.has(key),
    )
    expect(untranslated).toEqual([])
  })
})
