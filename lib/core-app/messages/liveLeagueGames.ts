import { defineMessages } from '@/lib/i18n/messages'

/** Live scores' "around the league" rows (components/core-app/live/LiveLeagueGames.tsx). */
export const liveLeagueGamesMessages = defineMessages({
  en: {
    title: (week: number) => `Around the league · Week ${week}`,
    aria: 'The other games in this league this week',
    allProjected: 'No game this week has been scored yet, so every number here is a projection.',
    live: 'Live',
    final: 'Final',
    upcoming: 'Upcoming',
    proj: 'proj',
    openMatchups: 'Full league scoreboard',
  },
  es: {
    title: (week: number) => `En la liga · Semana ${week}`,
    aria: 'Los demás partidos de esta liga esta semana',
    allProjected: 'Todavía no se ha puntuado ningún partido de esta semana, así que todas las cifras son proyecciones.',
    live: 'En vivo',
    final: 'Final',
    upcoming: 'Próximo',
    proj: 'proy',
    openMatchups: 'Marcador completo de la liga',
  },
})
