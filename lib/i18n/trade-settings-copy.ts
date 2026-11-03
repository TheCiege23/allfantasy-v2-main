/**
 * English + Spanish copy for the commissioner Trade Settings panel
 * (components/app/settings/TradeSettingsPanel.tsx). Kept beside `lib/i18n/translations`, like
 * dynasty-format-copy.ts: one component reads it through `useLanguage()`; anything not Spanish reads English.
 */
export type TradeSettingsLang = 'en' | 'es'

export function tradeSettingsLang(language: string | null | undefined): TradeSettingsLang {
  return String(language ?? '').toLowerCase().startsWith('es') ? 'es' : 'en'
}

export const TRADE_SETTINGS_COPY = {
  title: { en: 'Trade Settings', es: 'Ajustes de intercambios' },
  selectLeague: { en: 'Select a league to view and edit trade rules.', es: 'Elige una liga para ver y editar sus reglas de intercambios.' },
  loading: { en: 'Loading…', es: 'Cargando…' },
  loadFailed: { en: 'Failed to load trade settings', es: 'No se pudieron cargar los ajustes de intercambios' },
  intro: { en: 'Configure trade review mode and league-vote veto threshold.', es: 'Configura la revisión de intercambios y el umbral de veto por votación de la liga.' },
  edit: { en: 'Edit', es: 'Editar' },
  cancel: { en: 'Cancel', es: 'Cancelar' },
  save: { en: 'Save', es: 'Guardar' },
  saved: { en: 'Trade settings saved', es: 'Ajustes de intercambios guardados' },
  saveFailed: { en: 'Failed to save trade settings', es: 'No se pudieron guardar los ajustes de intercambios' },
  reviewType: { en: 'Trade review type', es: 'Tipo de revisión de intercambios' },
  'review.none': { en: 'No review', es: 'Sin revisión' },
  'review.commissioner': { en: 'Commissioner review', es: 'Revisión del comisionado' },
  'review.league_vote': { en: 'League vote', es: 'Votación de la liga' },
  'review.instant': { en: 'Instant accept', es: 'Aceptación inmediata' },
  vetoThreshold: { en: 'Veto threshold', es: 'Umbral de veto' },
  vetoMode: { en: 'Counted as', es: 'Se cuenta como' },
  'vetoMode.count': { en: 'Number of votes', es: 'Número de votos' },
  'vetoMode.percent': { en: 'Percent of teams', es: 'Porcentaje de equipos' },
  'vetoHint.count': {
    en: 'This many veto votes stop a trade. Blank uses 4.',
    es: 'Esta cantidad de votos de veto detiene un intercambio. En blanco, se usan 4.',
  },
  'vetoHint.percent': {
    en: 'Veto votes from this percent of the league’s teams stop a trade.',
    es: 'Los votos de veto de este porcentaje de los equipos de la liga detienen un intercambio.',
  },
  'vetoValue.count': { en: '{{n}} veto votes', es: '{{n}} votos de veto' },
  'vetoValue.percent': { en: '{{n}}% of teams', es: '{{n}}% de los equipos' },
  'vetoValue.default': { en: '4 veto votes (default)', es: '4 votos de veto (predeterminado)' },
} as const satisfies Record<string, Record<TradeSettingsLang, string>>

export type TradeSettingsCopyKey = keyof typeof TRADE_SETTINGS_COPY

export function tradeSettingsCopy(lang: TradeSettingsLang, key: TradeSettingsCopyKey, vars: Record<string, string | number> = {}): string {
  return TRADE_SETTINGS_COPY[key][lang].replace(/\{\{(\w+)\}\}/g, (_, k: string) => (k in vars ? String(vars[k]) : ''))
}
