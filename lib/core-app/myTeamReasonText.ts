import { matchupReasonText } from './matchupReasonText'

/**
 * Spanish for everything My Team prints from the server (2026-10-03).
 *
 * The page's loaders (`myTeam.ts`, `dynastyOutlook.ts`, `scoringNotes.ts`) write their reasons and
 * notes in English, and the server render does not know the reader's language — so, like the
 * Matchup screen (`matchupReasonText`), My Team translates at render, in the client, where a
 * language switch takes effect at once.
 *
 * Only My Team's OWN sentences are here. Anything else it prints — the matchup card's forecast
 * refusals and `unpricedReason` — comes from modules the Matchup screen shares, and falls through to
 * `matchupReasonText`, so one sentence has one Spanish wherever it shows. An unknown string falls
 * back to the English original, never to a blank.
 *
 * `__tests__/my-team-reasons-spanish.test.tsx` reads the producers' source for every `reason:`
 * literal, so a new English reason without a line here fails the suite instead of shipping. PURE and
 * client-safe.
 */
const EXACT_ES: Record<string, string> = {
  'This starting slot was empty when checked. Confirm the current lineup, eligibility, locks, and AutoSubs on your platform.':
    'Esta plaza titular estaba vacía al revisarla. Confirma la alineación actual, la elegibilidad, los bloqueos y AutoSubs en tu plataforma.',
  'not requested for alert evaluation': 'no se solicitó para evaluar alertas',
  // lib/core-app/myTeam.ts
  'no lineup found to project': 'no se encontró una alineación que proyectar',
  'no schedule on file for this league yet': 'aún no hay calendario registrado para esta liga',
  'no roster found to grade': 'no se encontró una plantilla que calificar',
  'no live scoring ingested for imported leagues': 'no se importan puntos en vivo para las ligas importadas',
  'we cannot tell which team in this league is yours — claim it and the lineup appears here':
    'no podemos saber cuál es tu equipo en esta liga: reclámalo y la alineación aparecerá aquí',
  'Your current Sleeper lineup could not be verified. Open Sleeper to check your starters, then refresh.':
    'No se pudo verificar tu alineación actual de Sleeper. Abre Sleeper para revisar tus titulares y luego actualiza.',
  'no roster rows imported for your team in this league': 'no se importaron jugadores de tu equipo en esta liga',
  'We need prices for most of this league’s rosters to rank yours against them, and we don’t have them yet.':
    'Necesitamos valores para la mayoría de las plantillas de esta liga para comparar la tuya con ellas, y aún no los tenemos.',
  'no starters to project on this roster': 'no hay titulares que proyectar en esta plantilla',
  'no weekly projection feed has been ingested yet': 'aún no se ha importado el feed semanal de proyecciones',
  'no starting lineup recorded on this roster': 'no hay una alineación titular registrada en esta plantilla',
  'no bench players recorded on this roster': 'no hay suplentes registrados en esta plantilla',
  'nobody on injured reserve': 'nadie en la reserva de lesionados',
  'nobody on the taxi squad': 'nadie en el escuadrón taxi',
  'no upcoming game found for your starters, so there is no lock time to count down to':
    'no se encontró un próximo partido para tus titulares, así que no hay hora de cierre que contar',
  // lib/core-app/dynastyOutlook.ts
  'no ages on file for your starters': 'no hay edades registradas para tus titulares',
  'this league has no future-pick inventory yet': 'esta liga aún no tiene inventario de selecciones futuras',
  'we could not tell which roster in this league is yours': 'no pudimos saber cuál es tu plantilla en esta liga',
  'another team': 'otro equipo',
  'your team in this league has no provider id on file': 'tu equipo en esta liga no tiene identificador de proveedor registrado',
  'the league’s teams could not be read': 'no se pudieron leer los equipos de la liga',
  'the pick table could not be read': 'no se pudo leer la tabla de selecciones',
  'future picks are not synced for this platform yet': 'las selecciones futuras aún no se sincronizan para esta plataforma',
}

const PATTERNS_ES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^no week (\d+) matchup recorded for your team yet$/, (m) => `aún no hay enfrentamiento de la semana ${m[1]} registrado para tu equipo`],
  [/^no week (\d+) game found for any of your starters yet$/, (m) => `aún no se encontró partido de la semana ${m[1]} para ninguno de tus titulares`],
]

export function myTeamReasonText(reason: string | null | undefined, language: string): string {
  if (!reason) return ''
  if (language !== 'es') return reason
  const exact = EXACT_ES[reason]
  if (exact) return exact
  for (const [re, es] of PATTERNS_ES) {
    const m = reason.match(re)
    if (m) return es(m)
  }
  return matchupReasonText(reason, language)
}

/** The matchup card's name for the same function (#1990). */
export const myTeamCardReasonText = myTeamReasonText

/**
 * Spanish for `describeScoringDifferences` (lib/core-app/scoringNotes.ts) — the notes under the
 * roster saying how this league's scoring differs from generic PPR. Number-bearing, so by pattern.
 */
const NOTE_PATTERNS_ES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^Receptions are worth nothing here — this is standard scoring, not PPR\.$/, () => 'Las recepciones no valen nada aquí: es puntuación estándar, no PPR.'],
  [/^Receptions are worth ([\d.]+), not 1\.$/, (m) => `Las recepciones valen ${m[1]}, no 1.`],
  [/^Tight ends get an extra ([\d.]+) per catch on top\.$/, (m) => `Los tight ends reciben ${m[1]} extra por recepción.`],
  [/^Passing touchdowns are worth ([\d.]+), not 4\.$/, (m) => `Los touchdowns de pase valen ${m[1]}, no 4.`],
  [/^Interceptions cost ([\d.]+), not 2\.$/, (m) => `Las intercepciones restan ${m[1]}, no 2.`],
  [/^(\d+) yardage or milestone bonus applies that generic scoring ignores\.$/, (m) => `Se aplica ${m[1]} bonificación por yardas o hitos que la puntuación genérica ignora.`],
  [/^(\d+) yardage or milestone bonuses apply that generic scoring ignores\.$/, (m) => `Se aplican ${m[1]} bonificaciones por yardas o hitos que la puntuación genérica ignora.`],
  [/^This league scores individual defensive players, which the generic number does not count at all\.$/, () => 'Esta liga puntúa a jugadores defensivos individuales, algo que el número genérico no cuenta en absoluto.'],
]

export function scoringNoteText(note: string, language: string): string {
  if (language !== 'es') return note
  for (const [re, es] of NOTE_PATTERNS_ES) {
    const m = note.match(re)
    if (m) return es(m)
  }
  return note
}
