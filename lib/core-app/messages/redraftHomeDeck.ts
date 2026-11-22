import { defineMessages } from '@/lib/i18n/messages'

/**
 * The redraft "season race" deck on /core's league Home (components/core-app/screens/RedraftHomeDeck.tsx):
 * the score bug, the playoff race and last week's recap. These were English-only literals in the
 * component; the English is unchanged here, byte for byte, so the e2e harness and its tests read the same.
 */
export const redraftHomeDeckMessages = defineMessages({
  en: {
    deckLabel: 'Season race',
    redraft: 'Redraft',
    regularSeason: 'Regular season · week',
    regularSeasonOf: (of: number) => ` of ${of}`,
    weekFinal: (week: number) => `Week ${week} · Final`,
    weekScored: (week: number) => `Week ${week} · Scored so far`,
    weekUpNext: (week: number) => `Week ${week} · Up next`,
    projected: 'Projected',
    winOdds: 'Win odds',
    versus: 'vs',
    you: 'You',
    openMatchup: 'Open matchup →',
    playoffRace: 'Playoff race',
    topMakeIt: (spots: number) => `Top ${spots} make it`,
    playoffLine: 'Playoff line',
    fullStandings: 'Full standings →',
    recapTitle: 'Last week’s recap',
    recapWeek: (week: number) => `Week ${week} · final`,
    topScore: 'Top score',
    closestGame: 'Closest game',
    biggestWin: 'Biggest win',
    byMargin: (margin: string) => `by ${margin}`,
    over: (winner: string, loser: string) => `${winner} over ${loser}`,
  },
  es: {
    deckLabel: 'Carrera de la temporada',
    redraft: 'Redraft',
    regularSeason: 'Temporada regular · semana',
    regularSeasonOf: (of) => ` de ${of}`,
    weekFinal: (week) => `Semana ${week} · Final`,
    weekScored: (week) => `Semana ${week} · Puntos hasta ahora`,
    weekUpNext: (week) => `Semana ${week} · Próxima`,
    projected: 'Proyectado',
    winOdds: 'Probabilidad de ganar',
    versus: 'vs',
    you: 'Tú',
    openMatchup: 'Abrir enfrentamiento →',
    playoffRace: 'Carrera por los playoffs',
    topMakeIt: (spots) => `Los ${spots} primeros clasifican`,
    playoffLine: 'Línea de playoffs',
    fullStandings: 'Clasificación completa →',
    recapTitle: 'Resumen de la semana pasada',
    recapWeek: (week) => `Semana ${week} · final`,
    topScore: 'Puntuación más alta',
    closestGame: 'Partido más ajustado',
    biggestWin: 'Mayor victoria',
    byMargin: (margin) => `por ${margin}`,
    over: (winner, loser) => `${winner} sobre ${loser}`,
  },
})
