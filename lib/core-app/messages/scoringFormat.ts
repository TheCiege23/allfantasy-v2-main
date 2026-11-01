import { defineMessages } from '@/lib/i18n/messages'

/**
 * Scoring-format names — THE one term table for every /core surface that shows a league's scoring
 * (`scoringFormatText` in lib/core-app/scoringFormatText.ts is the only reader).
 *
 * The owner's ruling (2026-10-30, __tests__/spanish-wording-rulings.test.tsx §9): the scoring part of
 * a format label is TRANSLATED everywhere — "Half PPR" → «Medio PPR», "Standard" → «Estándar» — which
 * is what league settings, Chimmy's preferences and the scoring presets already said
 * (lib/i18n/league-rules-copy.ts `leagueRules.preset.*`, translations `settings.chimmyPrefs.scoring*`).
 * "PPR", "Superflex", "TEP", "IDP", "2QB", "Best Ball", "Dynasty" and the other format acronyms and
 * brand-like names are NOT terms here: they stay as written in every language.
 *
 * `en` is the text the label already carries, byte for byte: English output never changes.
 */
export const scoringFormatMessages = defineMessages({
  en: {
    halfPpr: 'Half PPR',
    standard: 'Standard',
    nonPpr: 'Non-PPR',
    standardScoring: 'Standard scoring',
  },
  es: {
    halfPpr: 'Medio PPR',
    standard: 'Estándar',
    nonPpr: 'Sin PPR',
    standardScoring: 'Puntuación estándar',
  },
})
