import type { StandingsBoard } from './standingsModel'
import { MIN_WEEKS_TO_PROJECT } from './standingsModel'

/** Spanish text for explanations derived from the board's structured facts. */
export function standingsBoardCopy(board: StandingsBoard, language: string) {
  if (language !== 'es') {
    return {
      record: board.recordBasis,
      order: board.orderBasis,
      history: board.historyBasis,
      projection: board.projectionWithheld ?? board.projectionBasis,
      power: board.powerBasis,
    }
  }

  const platform = board.rules.platformLabel
  const median = board.medianGames ? ', incluido el partido semanal contra la mediana' : ''
  const record = !board.hasHeadToHead
    ? 'Esta liga no tiene enfrentamientos directos registrados; por eso no hay récords y la tabla se ordena por puntos a favor.'
    : board.platformCheck === 'platform-used'
      ? `Los récords son los publicados por ${platform}. Incluyen partidos que no aparecen en nuestros resultados sincronizados, así que el historial semanal puede diferir.`
      : board.platformCheck === 'matches'
        ? `Los récords incluyen todos los resultados sincronizados${median} y coinciden con la tabla de ${platform}.`
        : board.platformCheck === 'platform-behind'
          ? `Los récords llegan hasta la semana ${board.throughWeek}${median}, la última confirmada por ${platform}.`
          : `Los récords incluyen todos los resultados sincronizados${median}. ${platform} no ha publicado récords para verificarlos.`

  const order = board.platformOrder
    ? `El orden es la clasificación publicada por ${platform}.`
    : board.hasHeadToHead
      ? `El orden sigue el porcentaje de victorias, luego los puntos a favor y después el enfrentamiento directo${board.rules.tiebreakerSource === 'platform' ? `, según las reglas de ${platform}` : `; esta última regla se supone porque ${platform} no publica su desempate`}.`
      : 'El orden sigue los puntos a favor.'

  const history = `Las posiciones semanales se reconstruyen con los resultados sincronizados y las mismas reglas de la tabla${board.platformCheck === 'platform-used' ? `, que contabiliza menos partidos que ${platform}` : ''}.`
  const projection = board.projectionWithheld
    ? !board.hasHeadToHead
      ? 'Las proyecciones de récord requieren enfrentamientos directos, y esta liga no tiene ninguno registrado.'
      : board.weeks.length < MIN_WEEKS_TO_PROJECT
        ? `Las proyecciones comienzan cuando terminan ${MIN_WEEKS_TO_PROJECT} semanas; hasta ahora hay ${board.weeks.length}.`
        : board.gamesRemaining === 0
          ? 'La temporada regular terminó; no quedan partidos que proyectar.'
          : `Ningún equipo tiene ${MIN_WEEKS_TO_PROJECT} semanas con puntos para crear una proyección.`
    : 'Los récords proyectados suman la probabilidad de ganar cada partido restante al récord actual y redondean a partidos completos. Son estimaciones, no resultados ni probabilidades de playoffs.'

  return {
    record,
    order,
    history,
    projection,
    power: 'Rendimiento AF es nuestro análisis, no la tabla oficial: porcentaje de victorias contra todos los equipos, cada semana. Tras cuatro semanas, las tres más recientes pesan un 30 %. Los empates se resuelven por puntos a favor.',
  }
}
