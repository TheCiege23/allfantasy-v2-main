/**
 * English + Spanish copy for the NBA/NHL/MLB dynasty format presets and the commissioner
 * "Taxi squad" section.
 *
 * Kept beside `lib/i18n/translations` rather than in it: the dictionary is large and edited by many
 * concurrent changes, and these strings belong to two components only. Both read `useLanguage()`
 * and pick a column here; anything that is not Spanish reads English.
 */
export type DynastyFormatLang = 'en' | 'es'

export function dynastyFormatLang(language: string | null | undefined): DynastyFormatLang {
  return String(language ?? '').toLowerCase().startsWith('es') ? 'es' : 'en'
}

type Copy = { label: string; hint: string }

export const DYNASTY_SPORT_PRESET_COPY: Record<string, Record<DynastyFormatLang, Copy>> = {
  nba_dynasty_points_taxi: {
    en: { label: 'Points dynasty + taxi (standard)', hint: '10 starters · 8 bench · 3 IL · 4 taxi (rookies + 2nd year).' },
    es: { label: 'Dinastía por puntos + taxi (estándar)', hint: '10 titulares · 8 banca · 3 IL · 4 taxi (novatos + 2.º año).' },
  },
  nba_dynasty_points_compact: {
    en: { label: 'Compact points dynasty', hint: '10 starters · 5 bench · 3 IL · 3 taxi (rookies only).' },
    es: { label: 'Dinastía por puntos compacta', hint: '10 titulares · 5 banca · 3 IL · 3 taxi (solo novatos).' },
  },
  nba_dynasty_points_deep: {
    en: { label: 'Deep points dynasty', hint: '10 starters · 12 bench · 4 IL · 6 taxi (up to 3rd year).' },
    es: { label: 'Dinastía por puntos profunda', hint: '10 titulares · 12 banca · 4 IL · 6 taxi (hasta 3.er año).' },
  },
  nhl_dynasty_points_taxi: {
    en: { label: 'Skater/goalie points dynasty + taxi', hint: '14 starters (2 G) · 9 bench · 3 IR · 4 taxi (rookies + 2nd year).' },
    es: { label: 'Dinastía por puntos (patinadores/porteros) + taxi', hint: '14 titulares (2 G) · 9 banca · 3 IR · 4 taxi (novatos + 2.º año).' },
  },
  nhl_dynasty_points_minors: {
    en: { label: 'Points dynasty with deep minors (taxi)', hint: '14 starters (2 G) · 10 bench · 3 IR · 8 taxi for prospects (up to 3rd year).' },
    es: { label: 'Dinastía por puntos con ligas menores (taxi)', hint: '14 titulares (2 G) · 10 banca · 3 IR · 8 taxi para prospectos (hasta 3.er año).' },
  },
  mlb_dynasty_points_minors: {
    en: { label: 'Points dynasty with minor-league slots', hint: '23 starters · 12 bench · 4 IL · 6 minor-league (taxi) slots.' },
    es: { label: 'Dinastía por puntos con plazas de ligas menores', hint: '23 titulares · 12 banca · 4 IL · 6 plazas de ligas menores (taxi).' },
  },
  mlb_dynasty_points_deep: {
    en: { label: 'Deep-bench points dynasty', hint: '23 starters · 16 bench · 6 IL · 10 minor-league (taxi) slots.' },
    es: { label: 'Dinastía por puntos con banca profunda', hint: '23 titulares · 16 banca · 6 IL · 10 plazas de ligas menores (taxi).' },
  },
}

export function dynastySportPresetCopy(id: string, lang: DynastyFormatLang): Copy {
  return DYNASTY_SPORT_PRESET_COPY[id]?.[lang] ?? { label: id, hint: '' }
}

export const DYNASTY_FORMAT_UI_COPY = {
  en: {
    formatLabel: 'Dynasty format',
    custom: 'Custom',
    formatHelp: 'Sets bench, injured-reserve and taxi depth plus points scoring. Starters follow the sport’s dynasty lineup.',
    editTitle: 'Dynasty format preset',
    editHelp: 'Before the draft you can switch to another preset. It rewrites bench, injured-reserve and taxi slots and taxi eligibility. Scoring is edited on the Scoring tab.',
    apply: 'Apply preset',
    applying: 'Applying…',
    applied: 'Preset applied',
    locked: 'Presets can only be applied before the draft.',
    failed: 'Could not apply the preset',
  },
  es: {
    formatLabel: 'Formato de dinastía',
    custom: 'Personalizado',
    formatHelp: 'Define la profundidad de banca, reserva de lesionados y taxi, con puntuación por puntos. Los titulares siguen la alineación de dinastía del deporte.',
    editTitle: 'Preajuste de formato de dinastía',
    editHelp: 'Antes del draft puedes cambiar a otro preajuste. Reescribe las plazas de banca, reserva de lesionados y taxi, y la elegibilidad del taxi. La puntuación se edita en la pestaña Puntuación.',
    apply: 'Aplicar preajuste',
    applying: 'Aplicando…',
    applied: 'Preajuste aplicado',
    locked: 'Los preajustes solo se pueden aplicar antes del draft.',
    failed: 'No se pudo aplicar el preajuste',
  },
} as const

export const TAXI_SECTION_COPY = {
  en: {
    title: 'Taxi squad',
    subtitle: 'Every taxi option for this league in one place.',
    slots: 'Taxi squad slots',
    allowNonRookies: 'Allow non-rookies on taxi',
    yearsLimit: 'Taxi years experience limit',
    noMax: 'No max',
    years: (n: number) => (n === 1 ? '1 year' : `${n} years`),
    deadline: 'Taxi deadline (week)',
    week: (n: number) => `Week ${n}`,
    deadlineHelp: 'After this week, taxi promotions follow your league’s promotion rules.',
    rulesTitle: 'Lock & promotion rules',
    lockBehavior: 'Lock rule',
    inSeasonMoves: 'Allow taxi moves in season',
    postseasonMoves: 'Allow taxi moves in the postseason',
    scoringOn: 'Taxi players score points',
    promotionDeadline: 'Promotion deadline (week)',
    none: 'None',
    saveFailed: 'Could not save the taxi rule',
  },
  es: {
    title: 'Escuadrón taxi',
    subtitle: 'Todas las opciones de taxi de esta liga en un solo lugar.',
    slots: 'Plazas del escuadrón taxi',
    allowNonRookies: 'Permitir no novatos en el taxi',
    yearsLimit: 'Límite de años de experiencia del taxi',
    noMax: 'Sin máximo',
    years: (n: number) => (n === 1 ? '1 año' : `${n} años`),
    deadline: 'Fecha límite del taxi (semana)',
    week: (n: number) => `Semana ${n}`,
    deadlineHelp: 'Después de esta semana, los ascensos del taxi siguen las reglas de ascenso de tu liga.',
    rulesTitle: 'Reglas de bloqueo y ascenso',
    lockBehavior: 'Regla de bloqueo',
    inSeasonMoves: 'Permitir movimientos de taxi en temporada',
    postseasonMoves: 'Permitir movimientos de taxi en postemporada',
    scoringOn: 'Los jugadores del taxi suman puntos',
    promotionDeadline: 'Fecha límite de ascenso (semana)',
    none: 'Ninguna',
    saveFailed: 'No se pudo guardar la regla del taxi',
  },
} as const

/** Labels for `TAXI_LOCK_BEHAVIOR_OPTIONS` values (lib/taxi/constants.ts). */
export const TAXI_LOCK_BEHAVIOR_COPY: Record<string, Record<DynastyFormatLang, string>> = {
  once_promoted_no_return: { en: 'Once promoted cannot return', es: 'Una vez ascendido no puede volver' },
  free_move: { en: 'Can move freely', es: 'Puede moverse libremente' },
  commissioner_custom: { en: 'Commissioner custom', es: 'Personalizado por el comisionado' },
}
