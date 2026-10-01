import { coreUiCopy } from './coreUiCopy'

/** Translate Draft HQ's data-derived notes without changing the loader's facts. */
export function draftHqUiCopy(english: string, language: string): string {
  if (language !== 'es') return english
  const exact = coreUiCopy(english, language)
  if (exact !== english) return exact

  const pickTrade = english.match(/^pick trades made on (.+) are not synced into this draft, so a pick shown here may have changed hands there$/)
  if (pickTrade) return `Los intercambios de selecciones hechos en ${pickTrade[1]} no se sincronizan con este draft. Una selección mostrada aquí podría haber cambiado de dueño allí.`

  const keeper = english.match(/^Sleeper flagged none of your (.+) draft picks as keepers$/)
  if (keeper) return `Sleeper no marcó ninguna de tus selecciones del draft ${keeper[1] === 'latest' ? 'más reciente' : keeper[1]} como jugador conservado.`

  const ungraded = english.match(/^the (\d+) season has not produced scoring yet, so there is nothing to grade a pick against$/)
  if (ungraded) return `La temporada ${ungraded[1]} aún no tiene puntos anotados, así que todavía no se pueden calificar las selecciones.`

  const leagueRules = english.match(/^Scored with this league's own rules for passing, rushing and receiving\. (\d+) of its scoring rules could not be translated — ESPN publishes them as numeric ids with no names, and the ones left are kicking and defensive scoring plays — so kickers and team defenses are understated here\.$/)
  if (leagueRules) return `Calificado con las reglas de esta liga para pases, carreras y recepciones. No se pudieron interpretar ${leagueRules[1]} reglas: ESPN las publica como identificadores numéricos sin nombre. Las reglas restantes son de patadas y defensa, por lo que esos jugadores quedan infravalorados aquí.`

  const approximate = english.match(/^Graded on standard (.+) scoring rather than this league's exact rules — (.+) records its scoring as numeric stat ids with no names attached, and only (\d+) core rules could be translated without guessing\.$/)
  if (approximate) return `Calificado con puntuación estándar ${approximate[1]} en lugar de las reglas exactas de la liga. ${approximate[2]} registra sus reglas con identificadores numéricos sin nombre; solo se pudieron interpretar ${approximate[3]} reglas principales sin adivinar.`

  if (english.startsWith('Value over round: each pick’s ')) {
    return english.includes('league-scored points')
      ? 'Valor sobre la ronda: puntos de cada selección según las reglas de la liga menos la mediana de la ronda. La calificación refleja el valor medio por selección; se puede comprobar con las cifras mostradas.'
      : 'Valor sobre la ronda: puntos anotados por cada selección menos la mediana de la ronda. La calificación refleja el valor medio por selección; se puede comprobar con las cifras mostradas.'
  }

  return english
}
