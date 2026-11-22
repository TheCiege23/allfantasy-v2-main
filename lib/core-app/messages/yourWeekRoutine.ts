import { weekdayEs } from '@/lib/core-app/kickoffText'
import { defineMessages } from '@/lib/i18n/messages'

/**
 * "Your week" routine card (components/core-app/screens/YourWeekRoutine.tsx). Every string is the one
 * the card printed before the move, byte for byte, in both languages — a relocation, not a rewrite.
 */
export const yourWeekRoutineMessages = defineMessages({
  en: {
    yourWeek: 'Your week',
    weekday: (day: string): string => day,
    done: 'Done',
    recapTitle: (week: number, season: number, wins: number, losses: number) => `${season} week ${week} recap: ${wins}-${losses}`,
    biggestWin: (league: string, margin: string) => `Biggest win: ${league} by ${margin}`,
    closestLoss: (league: string, margin: string) => `Closest loss: ${league} by ${margin}`,
    topScorer: (name: string, points: string, league: string) => `Top scorer: ${name} ${points} (${league})`,
    recapPending: 'Monday night games may still change these.',
    awardsTitle: (week: number) => `Week ${week} awards`,
    ptMargin: ' pt margin',
    awardShareTitle: (label: string, league: string, week: number) => `${label} — ${league}, week ${week}`,
    upsetsTitle: (week: number) => `Week ${week} upsets`,
    won: 'won',
    preGameChance: 'pre-game win chance',
    upsetShareTitle: (league: string, week: number) => `Upset win — ${league}, week ${week}`,
  },
  es: {
    yourWeek: 'Tu semana',
    weekday: (day) => weekdayEs(day),
    done: 'Hecho',
    recapTitle: (week, season, wins, losses) => `Resumen de la semana ${week} de ${season}: ${wins}-${losses}`,
    biggestWin: (league, margin) => `Mayor victoria: ${league} por ${margin}`,
    closestLoss: (league, margin) => `Derrota más ajustada: ${league} por ${margin}`,
    topScorer: (name, points, league) => `Máximo anotador: ${name} ${points} (${league})`,
    recapPending: 'Los partidos del lunes por la noche aún pueden cambiar esto.',
    awardsTitle: (week) => `Premios de la semana ${week}`,
    ptMargin: ' pts de diferencia',
    awardShareTitle: (label, league, week) => `${label} — ${league}, semana ${week}`,
    upsetsTitle: (week) => `Sorpresas de la semana ${week}`,
    won: 'ganaste',
    preGameChance: 'probabilidad de ganar antes del partido',
    upsetShareTitle: (league, week) => `Victoria sorpresa — ${league}, semana ${week}`,
  },
})
