import { defineMessages } from '@/lib/i18n/messages'

/**
 * The league home screen (components/core-app/screens/LeagueHome.tsx): the paired-league band, the
 * future-week scoreboard note, the power board's movement and luck titles, the commissioner card's
 * inactive overflow, the Chimmy prefill, the read-only note and the all-leagues line.
 * Every string is the one the component wrote before the move, byte for byte, in both languages — a
 * relocation, not a rewrite.
 */
export const leagueHomeMessages = defineMessages({
  en: {
    // PairedBand
    pairedOfferTitle: (leagueName: string) => `Is ${leagueName} half of a bigger team?`,
    pairedHalfTitle: (franchiseName: string) => `${franchiseName} has only one half`,
    pairedHalfText: (viewingRole: string) =>
      `This league is filed as the ${viewingRole} side. Add the other half to see them as one team.`,
    pairedTotalPlayers: (totalPlayers: number) => `${totalPlayers} players across both`,
    pairedRosterCount: (playerCount: number | null) =>
      `${playerCount} ${playerCount === 1 ? 'player' : 'players'} on your roster`,

    // Scoreboard — a future week
    futureWeekNotPlayed: (week: number) => `Nothing in week ${week} has been played.`,
    futureWeekBasis: (basisWeek: number, selected: number) =>
      `, using week ${basisWeek} projections — the feed does not carry week ${selected} yet`,

    // Power board
    powerMoveTitle: (places: number, up: boolean) =>
      `${places} place${places === 1 ? '' : 's'} ${up ? 'up' : 'down'} since last week`,
    luckBetter: (wins: string) => `${wins} wins better than they have played`,
    luckWorse: (wins: string) => `${wins} wins worse than they have played`,

    // Commissioner card
    inactiveMore: (n: number) => ` and ${n} more`,

    // Chimmy
    askWeekPrefill: (week: number | string, leagueName: string) =>
      `Walk me through week ${week} in ${leagueName}: which matchups are closest, who is most likely to be upset, and what should I be watching in my own game?`,
    readOnlyNote: (platformLabel: string) => `Make changes in ${platformLabel} — AllFantasy only reads your league.`,

    // All leagues
    otherLeagueIssues: (n: number) =>
      `${n} more ${n === 1 ? 'issue lives' : 'issues live'} outside this league.`,
  },
  es: {
    pairedOfferTitle: (leagueName) => `¿${leagueName} forma parte de un equipo más grande?`,
    pairedHalfTitle: (franchiseName) => `${franchiseName} solo tiene una parte`,
    pairedHalfText: (viewingRole) =>
      `Esta liga está registrada como la parte ${viewingRole}. Añade la otra para verlas como un solo equipo.`,
    pairedTotalPlayers: (totalPlayers) => `${totalPlayers} jugadores entre ambas`,
    pairedRosterCount: (playerCount) =>
      `${playerCount} ${playerCount === 1 ? 'jugador' : 'jugadores'} en tu plantilla`,

    futureWeekNotPlayed: (week) => `Aún no se ha jugado nada de la semana ${week}.`,
    futureWeekBasis: (basisWeek, selected) =>
      `, con proyecciones de la semana ${basisWeek}; la fuente aún no tiene la semana ${selected}`,

    powerMoveTitle: (places, up) =>
      `${places} ${places === 1 ? 'puesto' : 'puestos'} ${up ? 'arriba' : 'abajo'} desde la semana pasada`,
    luckBetter: (wins) => `${wins} victorias más de lo esperado`,
    luckWorse: (wins) => `${wins} victorias menos de lo esperado`,

    inactiveMore: (n) => ` y ${n} más`,

    askWeekPrefill: (week, leagueName) =>
      `Explícame la semana ${week} en ${leagueName}: ¿qué enfrentamientos están más ajustados, dónde puede haber sorpresas y qué debo vigilar en mi partido?`,
    readOnlyNote: (platformLabel) => `Haz los cambios en ${platformLabel}; AllFantasy solo consulta tu liga.`,

    otherLeagueIssues: (n) =>
      `${n} ${n === 1 ? 'asunto pendiente está' : 'asuntos pendientes están'} fuera de esta liga.`,
  },
})
