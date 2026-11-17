import { defineMessages } from '@/lib/i18n/messages'

/**
 * The Matchup guide (components/core-app/screens/Matchup.tsx, lib/core-app/matchupGuide.ts).
 *
 * ⚠ SPANISH FOLLOWS THE APP'S WORDING RULINGS (__tests__/spanish-wording-rulings.test.tsx): a waiver
 * claim is «reclamo», the pool is «agentes libres», and no Spanish value says «waiver».
 */
export const matchupGuideMessages = defineMessages({
  en: {
    eyebrow: (week: number | null) => (week != null ? `Matchup · Week ${week}` : 'Matchup'),
    won: (a: string, b: string) => `You won ${a}–${b}`,
    lost: (a: string, b: string) => `You lost ${a}–${b}`,
    tied: (a: string, b: string) => `You tied ${a}–${b}`,
    liveAhead: (m: string) => `Ahead by ${m} so far`,
    liveBehind: (m: string) => `Behind by ${m} so far`,
    liveLevel: 'Level so far',
    projWin: (a: string, b: string) => `Projected to win, ${a}–${b}`,
    projLose: (a: string, b: string) => `Projected to lose, ${a}–${b}`,
    projLevel: (a: string, b: string) => `Projected level, ${a}–${b}`,
    toWinSuffix: (p: number) => ` · ${p}% to win`,
    chanceSuffix: (p: number) => ` · ${p}% chance`,
    unknown: 'This week’s matchup',
    intro: (platform: string | null) =>
      `Follow this week’s head-to-head: who’s ahead, which game decides it, and how much you still need.${platform ? ` Lineup changes are made on ${platform}.` : ''}`,
    chipWin: 'Win chance',
    chipProjected: 'Projected final',
    chipLeft: 'Players left, you vs them',
    howSure: 'How sure is this?',
    why: 'Why it matters',
    boardTeach:
      'Each row is your starter against theirs in the same slot. The rows still to play are where the matchup can turn — check them before kickoff.',
    historyTitle: 'Your history with them',
    marketTitle: 'Game outlook for your players (betting lines)',
  },
  es: {
    eyebrow: (week: number | null) => (week != null ? `Enfrentamiento · Semana ${week}` : 'Enfrentamiento'),
    won: (a: string, b: string) => `Ganaste ${a}–${b}`,
    lost: (a: string, b: string) => `Perdiste ${a}–${b}`,
    tied: (a: string, b: string) => `Empataste ${a}–${b}`,
    liveAhead: (m: string) => `Vas ganando por ${m}`,
    liveBehind: (m: string) => `Vas perdiendo por ${m}`,
    liveLevel: 'Empatados por ahora',
    projWin: (a: string, b: string) => `Proyección: ganas, ${a}–${b}`,
    projLose: (a: string, b: string) => `Proyección: pierdes, ${a}–${b}`,
    projLevel: (a: string, b: string) => `Proyección: empate, ${a}–${b}`,
    toWinSuffix: (p: number) => ` · ${p}% de ganar`,
    chanceSuffix: (p: number) => ` · ${p}% de probabilidad`,
    unknown: 'El enfrentamiento de esta semana',
    intro: (platform: string | null) =>
      `Sigue el enfrentamiento de esta semana: quién va ganando, qué partido lo decide y cuánto te falta.${platform ? ` Los cambios de alineación se hacen en ${platform}.` : ''}`,
    chipWin: 'Probabilidad de ganar',
    chipProjected: 'Final proyectado',
    chipLeft: 'Jugadores por jugar, tú contra ellos',
    howSure: '¿Qué tan seguro es?',
    why: 'Por qué importa',
    boardTeach:
      'Cada fila es tu titular contra el suyo en el mismo puesto. Las filas que aún no juegan son donde el enfrentamiento puede cambiar: revísalas antes del inicio.',
    historyTitle: 'Tu historial contra ellos',
    marketTitle: 'Panorama de los partidos de tus jugadores (líneas de apuestas)',
  },
})
