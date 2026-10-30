/**
 * English + Spanish copy for the C2C campus lineup panel on the Team tab
 * (app/league/[leagueId]/components/CampusLineupPanel.tsx). Kept beside `lib/i18n/translations`, like
 * dynasty-format-copy.ts: one component reads it, through `useLanguage()`; anything that is not Spanish
 * reads English. `{{n}}`-style placeholders are filled by `campusCopy`.
 */
export type CampusLang = 'en' | 'es'

export function campusLang(language: string | null | undefined): CampusLang {
  return String(language ?? '').toLowerCase().startsWith('es') ? 'es' : 'en'
}

export const CAMPUS_COPY = {
  title: { en: 'Campus lineup', es: 'Alineación universitaria' },
  intro: {
    en: 'Your college starters score from this week’s college games, added to your pro score.',
    es: 'Tus titulares universitarios suman puntos con los partidos universitarios de esta semana, además de tu puntuación profesional.',
  },
  filled: { en: '{{n}} of {{total}} campus spots filled', es: '{{n}} de {{total}} puestos universitarios ocupados' },
  slots: { en: 'Spots: {{slots}}', es: 'Puestos: {{slots}}' },
  weeks: { en: 'Counts college week {{weeks}} (NFL week {{nfl}}).', es: 'Cuenta la semana universitaria {{weeks}} (semana {{nfl}} de la NFL).' },
  noWeeks: {
    en: 'No college games count this week, so campus starters score 0 and your pro lineup decides.',
    es: 'Esta semana no cuenta ningún partido universitario: tus titulares universitarios suman 0 y decide tu alineación profesional.',
  },
  noSeats: { en: 'This league starts no college players.', es: 'Esta liga no alinea jugadores universitarios.' },
  noPlayers: { en: 'You have no college players yet.', es: 'Todavía no tienes jugadores universitarios.' },
  start: { en: 'Start', es: 'Alinear' },
  sit: { en: 'Sit', es: 'Sentar' },
  onCampus: { en: 'On campus', es: 'Titular' },
  noSpot: { en: 'No open campus spot for a {{pos}}', es: 'No hay un puesto universitario libre para un {{pos}}' },
  locked: { en: 'Lineups are locked right now.', es: 'Las alineaciones están bloqueadas ahora.' },
  saved: { en: 'Campus lineup saved', es: 'Alineación universitaria guardada' },
  notSaved: {
    en: 'Campus lineup was not saved. Your previous campus lineup is still active.',
    es: 'No se guardó la alineación universitaria. Sigue activa la anterior.',
  },
  askChimmy: { en: 'Ask Chimmy who to start on campus', es: 'Pregúntale a Chimmy a quién alinear' },
  chimmyPrompt: {
    en: 'Who should I start on campus this week in my C2C league? My campus spots are {{slots}} and my college players are {{players}}.',
    es: '¿A quién debo alinear como titular universitario esta semana en mi liga C2C? Mis puestos universitarios son {{slots}} y mis jugadores universitarios son {{players}}.',
  },
} as const satisfies Record<string, Record<CampusLang, string>>

export type CampusCopyKey = keyof typeof CAMPUS_COPY

export function campusCopy(lang: CampusLang, key: CampusCopyKey, vars: Record<string, string | number> = {}): string {
  return CAMPUS_COPY[key][lang].replace(/\{\{(\w+)\}\}/g, (_, k: string) => (k in vars ? String(vars[k]) : ''))
}
