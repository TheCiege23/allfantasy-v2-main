import { coreUiCopy } from './coreUiCopy'
import { gradeMomentToSpanish } from '@/lib/decision-os/trade/gradeMoment'

/** Client display copy for the small set of data-derived trade grade sentences. */
export function tradeUiCopy(english: string, language: string): string {
  if (language !== 'es') return english
  const exact = coreUiCopy(english, language)
  if (exact !== english) return exact
  const received = (name: string) => name === 'Tú' ? 'tú recibiste' : `${name} recibió`
  const won = (name: string) => name === 'Tú' ? 'Saliste' : `${name} salió`
  const betterSide = (name: string) => name === 'Tú' ? 'Obtuviste' : `${name} obtuvo`

  const ahead = english.match(/^(.+) came out well ahead — (.+) got only ([\d,]+) in league value for ([\d,]+)\.$/)
  if (ahead) return `${won(ahead[1])} con mucha ventaja: ${received(ahead[2])} solo ${ahead[3]} por ${ahead[4]} en valor de liga.`
  const major = english.match(/^(.+) came out well ahead — ([\d,]+) in league value for ([\d,]+)\.$/)
  if (major) return `${won(major[1])} con mucha ventaja: ${received(major[1])} ${major[2]} por ${major[3]} en valor de liga.`
  const betterOther = english.match(/^(.+) got the better end — (.+) got ([\d,]+) in league value for ([\d,]+)\.$/)
  if (betterOther) return `${betterSide(betterOther[1])} el mejor lado: ${received(betterOther[2])} ${betterOther[3]} por ${betterOther[4]} en valor de liga.`
  const better = english.match(/^(.+) got the better end of it — ([\d,]+) in league value for ([\d,]+)\.$/)
  if (better) return `${betterSide(better[1])} el mejor lado: ${received(better[1])} ${better[2]} por ${better[3]} en valor de liga.`
  const even = english.match(/^A near-even deal on league value — (.+) got ([\d,]+) for ([\d,]+)\.$/)
  if (even) return `Intercambio casi equilibrado según el valor de la liga: ${received(even[1])} ${even[2]} por ${even[3]}.`
  const best = english.match(/^The most valuable asset was (.+), and (.+) got (?:him|it)\.$/)
  if (best) return `El activo más valioso fue ${best[1]} y lo recibió ${best[2]}.`
  const split = english.match(/^Quality and quantity pulled apart: the best single asset was (.+), and (.+) got (?:him|it) — the other side won on the rest of the deal\.$/)
  if (split) return `La calidad y la cantidad dieron resultados distintos: ${split[2]} recibió el activo más valioso, ${split[1]}, pero el otro lado ganó con el resto del intercambio.`
  // `tradeGradeBreakdown`: "Graded on this league's values <moment> (<chart basis>)." — the moment is a
  // `gradeMoment` phrase (today / at the time of the trade / from … after the trade / when first graded).
  const moment = english.match(/^Graded on this league's values (.+?) \(([^()]+)\)\.$/)
  const momentEs = moment ? gradeMomentToSpanish(moment[1]!) : null
  if (moment && momentEs) return `Calificado con los valores de esta liga ${momentEs} (${moment[2]}).`
  // A bare moment phrase, as the /core Trades row prints it after "in league value".
  return gradeMomentToSpanish(english) ?? english
}
