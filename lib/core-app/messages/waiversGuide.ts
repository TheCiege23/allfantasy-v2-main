import { defineMessages } from '@/lib/i18n/messages'

/**
 * The Waivers page guide (components/core-app/screens/Waivers.tsx, WaiverLineupBoard.tsx,
 * lib/core-app/waiversGuide.ts).
 *
 * ⚠ SPANISH FOLLOWS THE APP'S WORDING RULINGS (__tests__/spanish-wording-rulings.test.tsx): a waiver
 * claim is «reclamo», the pool is «agentes libres», and no Spanish value says «waiver».
 */
export const waiversGuideMessages = defineMessages({
  en: {
    eyebrow: (league: string) => `Waivers · ${league}`,
    headPending: (league: string) => `Who to pick up in ${league}`,
    headBest: (name: string, gain: string, perGame: boolean) =>
      `Best pickup: ${name}, +${gain} points ${perGame ? 'a game' : 'this week'}`,
    headNone: 'No free agent beats your lineup this week',
    headNonePerGame: 'No free agent beats your lineup per game',
    intro: (league: string) =>
      `Find a free agent who’d improve your starting lineup, and decide if he’s worth your claim before waivers run. Ranked with ${league}’s own scoring.`,
    replaces: 'replaces',
    whyNotListed: 'Why some players aren’t listed',
    hideWhyNotListed: 'Hide the list notes',
    why: 'Why it matters',
    boardTeach:
      'A pickup only helps if he’d start for you. That’s why this list is ranked by what each player adds to your lineup, not by name or raw projection.',
    afTitle: (af: string) => `AllFantasy’s own projection: ${af}`,
  },
  es: {
    eyebrow: (league: string) => `Agentes libres · ${league}`,
    headPending: (league: string) => `A quién fichar en ${league}`,
    headBest: (name: string, gain: string, perGame: boolean) =>
      `Mejor fichaje: ${name}, +${gain} puntos ${perGame ? 'por partido' : 'esta semana'}`,
    headNone: 'Ningún agente libre mejora tu alineación esta semana',
    headNonePerGame: 'Ningún agente libre mejora tu alineación por partido',
    intro: (league: string) =>
      `Encuentra un agente libre que mejore tu alineación titular y decide si vale tu reclamo antes de que se procesen. Ordenado con la puntuación de ${league}.`,
    replaces: 'reemplaza a',
    whyNotListed: 'Por qué faltan algunos jugadores',
    hideWhyNotListed: 'Ocultar las notas',
    why: 'Por qué importa',
    boardTeach:
      'Un fichaje solo ayuda si sería titular para ti. Por eso la lista se ordena por lo que cada jugador suma a tu alineación, no por nombre ni por proyección bruta.',
    afTitle: (af: string) => `Proyección propia de AllFantasy: ${af}`,
  },
})
