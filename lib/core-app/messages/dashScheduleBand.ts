import { kickoffText } from '@/lib/core-app/kickoffText'
import { defineMessages } from '@/lib/i18n/messages'

/**
 * Schedule band (components/core-app/screens/DashScheduleBandView.tsx). Every string is the one the
 * band printed before the move, byte for byte, in both languages — this is a relocation, not a rewrite.
 * The kickoff arrives as `kickoffDayLabel`'s pinned English ("Oct 4"); Spanish words it through
 * `kickoffText`, exactly as the view did inline.
 */
export const dashScheduleBandMessages = defineMessages({
  en: {
    week: (week: number) => `Week ${week}`,
    thisWeek: 'This week',
    whoYouPlayThisWeek: 'Who you play this week',
    whoYouPlay: 'who you play',
    oneMatchup: '1 matchup',
    matchups: (total: number) => `${total} matchups`,
    nextKickoff: (kickoff: string) => `next kickoff ${kickoff}`,
    more: (overflow: number) => `+${overflow} more`,
    noSchedule: (withoutSchedule: number) =>
      `no schedule yet for your other ${withoutSchedule} ${withoutSchedule === 1 ? 'league' : 'leagues'}`,
    openYourWeek: 'Open your week',
  },
  es: {
    week: (week) => `Semana ${week}`,
    thisWeek: 'Esta semana',
    whoYouPlayThisWeek: 'Contra quién juegas esta semana',
    whoYouPlay: 'contra quién juegas',
    oneMatchup: '1 enfrentamiento',
    matchups: (total) => `${total} enfrentamientos`,
    nextKickoff: (kickoff) => `próximo inicio ${kickoffText(kickoff, 'es')}`,
    more: (overflow) => `+${overflow} más`,
    noSchedule: (withoutSchedule) =>
      withoutSchedule === 1 ? 'aún sin calendario para tu otra liga' : `aún sin calendario para tus otras ${withoutSchedule} ligas`,
    openYourWeek: 'Abrir tu semana',
  },
})
