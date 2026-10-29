import { defineMessages } from '@/lib/i18n/messages'

/**
 * Daily streak strip and today's glance (components/core-app/home/DailyStreakCardView.tsx). Every
 * string is the one the strip printed before the move, byte for byte, in both languages — this is a
 * relocation, not a rewrite.
 */
const WEEKDAY_EN = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const WEEKDAY_ES = ['D', 'L', 'M', 'X', 'J', 'V', 'S']

export const dailyStreakMessages = defineMessages({
  en: {
    /** One-letter weekday label, 0 = Sunday. */
    weekday: (i: number): string => WEEKDAY_EN[i],
    startStreak: 'Start a streak',
    dayOneStarted: 'Day 1 — streak started',
    dayN: (n: number) => `Day ${n}!`,
    streakOf: (n: number) => `${n}-day streak`,
    milestone: (n: number) => `🏅 ${n}-day milestone!`,
    checkInToday: 'Check in today to keep it alive',
    comeBackDaily: 'Open AllFantasy each day to build it',
    toNextBadge: (left: number, at: number) => `${left} day${left === 1 ? '' : 's'} to your ${at}-day badge`,
    legend: 'Legend status',
    dailyStreak: 'Daily streak',
    last7Days: 'Last 7 days',
    checkedIn: ', checked in',
    best: 'Best',
    lineupsSet: 'Lineups set',
    lineupsToFix: (n: number) => `${n} lineup${n === 1 ? '' : 's'} to fix`,
    noInjuries: 'No injury flags',
    injuryFlags: (n: number) => `${n} injury flag${n === 1 ? '' : 's'}`,
    noTrades: 'No new trades',
    newTrades: (n: number) => `${n} new trade${n === 1 ? '' : 's'}`,
    todayAtAGlance: 'Today at a glance',
  },
  es: {
    weekday: (i) => WEEKDAY_ES[i],
    startStreak: 'Empieza una racha',
    dayOneStarted: 'Día 1: racha iniciada',
    dayN: (n) => `¡Día ${n}!`,
    streakOf: (n) => `Racha de ${n} día${n === 1 ? '' : 's'}`,
    milestone: (n) => `🏅 ¡Logro de ${n} días!`,
    checkInToday: 'Entra hoy para no perderla',
    comeBackDaily: 'Vuelve cada día para sumar días',
    toNextBadge: (left, at) => `${left} día${left === 1 ? '' : 's'} para el logro de ${at}`,
    legend: 'Leyenda absoluta',
    dailyStreak: 'Racha diaria',
    last7Days: 'Últimos 7 días',
    checkedIn: ', registrado',
    best: 'Mejor',
    lineupsSet: 'Alineaciones listas',
    lineupsToFix: (n) => `${n} alineación${n === 1 ? '' : 'es'} por revisar`,
    noInjuries: 'Sin alertas de lesión',
    injuryFlags: (n) => `${n} alerta${n === 1 ? '' : 's'} de lesión`,
    noTrades: 'Sin intercambios hoy',
    newTrades: (n) => `${n} intercambio${n === 1 ? '' : 's'} nuevo${n === 1 ? '' : 's'}`,
    todayAtAGlance: 'Hoy de un vistazo',
  },
})
