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

  const you = (name: string) => name === 'You' || name === 'Tú' || name === 'you'
  const got = (name: string) => (you(name) ? 'tú recibiste' : `${name} recibió`)

  // `oneGradeBreakdownParts` since 2026-11-11. The older sentences below stay for cached payloads.
  const wonT = english.match(/^(.+) won this trade( clearly)?, getting ([\d,]+) in this league’s values for ([\d,]+) \((\d+)% apart\)\.$/)
  if (wonT) return `${you(wonT[1]!) ? 'Ganaste' : `${wonT[1]} ganó`} este intercambio${wonT[2] ? ' con claridad' : ''}: ${you(wonT[1]!) ? 'recibiste' : 'recibió'} ${wonT[3]} en valores de esta liga por ${wonT[4]} (${wonT[5]}% de diferencia).`
  const evenT = english.match(/^This trade was about even in this league’s values: (.+) got ([\d,]+) and (.+) got ([\d,]+) \((\d+)% apart\)\.$/)
  if (evenT) return `Este intercambio quedó casi equilibrado en los valores de esta liga: ${got(evenT[1]!)} ${evenT[2]} y ${got(evenT[3]!)} ${evenT[4]} (${evenT[5]}% de diferencia).`
  const lettersT = english.match(/^So (?:you get|(.+) gets) an? ([A-F]) and (.+) an? ([A-F])\.$/)
  if (lettersT) return `Así que ${lettersT[1] ? `${lettersT[1]} saca` : 'tú sacas'} una ${lettersT[2]} y ${lettersT[3]} una ${lettersT[4]}.`
  const pieceLost = english.match(/^(.+) got the biggest piece, (.+) \(([\d,]+)\), but the other side got more value overall\.$/)
  if (pieceLost) return `${got(pieceLost[1]!)} la pieza más valiosa, ${pieceLost[2]} (${pieceLost[3]}), pero el otro lado recibió más valor en total.`
  const piece = english.match(/^The biggest piece was (.+) \(([\d,]+)\), and (.+) got (?:him|it)\.$/)
  if (piece) return `La pieza más valiosa fue ${piece[1]} (${piece[2]}) y ${you(piece[3]!) ? 'la recibiste tú' : `la recibió ${piece[3]}`}.`
  if (english === 'This league is Superflex (teams can start two QBs), so quarterbacks are worth more here than in a one-QB league.')
    return 'Esta liga es Superflex (los equipos pueden alinear dos QB), así que los mariscales valen más aquí que en una liga de un solo QB.'
  const tep = english.match(/^This league gives tight ends an extra ([\d.]+) points per catch, so tight ends are worth more here\.$/)
  if (tep) return `Esta liga da a los tight ends ${tep[1]} puntos extra por recepción, así que valen más aquí.`
  const moveT = english.match(/^In this league (.+) is worth ([\d,]+) instead of ([\d,]+): (.+)\.$/)
  if (moveT) return `En esta liga ${moveT[1]} vale ${moveT[2]} en lugar de ${moveT[3]}: ${moveT[4]}.`
  const spotT = english.match(/^(.+) got fewer players back, so (?:your|their) total includes ([\d,]+) for (?:an open roster spot|(\d+) open roster spots) to fill\.$/)
  if (spotT) return `${got(spotT[1]!)} menos jugadores, así que ${you(spotT[1]!) ? 'tu' : 'su'} total incluye ${spotT[2]} por ${spotT[3] ? `${spotT[3]} puestos libres` : 'un puesto libre'} en la plantilla.`
  const basisT = english.match(/^These grades use this league’s settings \((.+)\) and values (.+)\.$/)
  const basisMoment = basisT ? gradeMomentToSpanish(basisT[2]!) : null
  if (basisT && basisMoment) return `Estas notas usan la configuración de esta liga (${basisT[1]}) y los valores ${basisMoment}.`

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
