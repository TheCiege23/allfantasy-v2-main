/**
 * Season Outlook's server-built sentences in the reader's language (2026-10-05).
 *
 * The league screen's drivers, moves, roster flags, assumptions and what-if result lines are written
 * in English by `seasonOutlookFocus.ts`, `seasonOutlook.ts`, `outlookScenario.ts` and `outlookCopy.ts`,
 * and no /core loader reads the language. A live Spanish sweep found the whole league screen English,
 * so these are translated at render — the same approach `seasonOutlookSentence` already takes for the
 * cross-league page's loader text.
 *
 * Each pattern is ANCHORED WHOLE: a changed template falls back to English, never to half a
 * translation. Names (players, teams, NFL clubs) are captured and passed through untouched.
 *
 * PURE and client-safe: no I/O, no `server-only`.
 */

import { coreUiCopy } from './coreUiCopy'

/** "3rd" → "3.º" — `ordinal` in outlookCopy writes the English suffix. */
export function ordinalEs(n: number): string {
  return `${n}.º`
}

const FIXED: Record<string, string> = {
  // Driver labels (seasonOutlookFocus)
  'Your scoring': 'Tu puntuación',
  'Remaining schedule': 'Calendario restante',
  'Record against points': 'Récord frente a puntos',
  Injuries: 'Lesiones',
  'Bye weeks': 'Semanas de descanso',
  'Your remaining opponents, against a league-average team.': 'Tus rivales restantes, frente a un equipo promedio de la liga.',
  'Your bye weeks against everyone else’s.': 'Tus semanas de descanso frente a las de los demás.',
  // Notes and injury-feed notes
  'Your roster could not be matched in this league, so roster-based drivers and moves are not shown.':
    'No se pudo emparejar tu plantilla en esta liga, así que no se muestran los factores ni los movimientos basados en ella.',
  'The injury feed could not be read, so no player is marked hurt — that is unknown, not healthy.':
    'No se pudo leer el parte de lesiones, así que ningún jugador aparece lesionado: eso es desconocido, no sano.',
  'The injury feed is behind, so injury marks may be missing.': 'El parte de lesiones va con retraso, así que pueden faltar marcas de lesión.',
  // Assumptions (seasonOutlook)
  'The last regular-season week is not stated, so every paired unplayed week counts as regular season.':
    'No se indica la última semana de la temporada regular, así que toda semana emparejada sin jugar cuenta como temporada regular.',
  'Divisions and head-to-head tiebreaks are not modelled: seeding is wins plus half a win per final tie, then points for.':
    'No se modelan divisiones ni desempates cara a cara: la posición se decide por victorias, más media victoria por empate, y luego por puntos a favor.',
  'Weekly scores are independent draws: bye weeks, injuries and trades only enter through the scenario tools.':
    'Las puntuaciones semanales son sorteos independientes: los descansos, las lesiones y los intercambios solo entran mediante las herramientas de escenarios.',
  'Wins, then points for.': 'Victorias y luego puntos a favor.',
  // Refusals and what-if problems (seasonOutlookFocus, outlookScenario)
  'Roster changes cannot be priced here: this league stores no starting lineup slots.':
    'Aquí no se pueden valorar cambios de plantilla: esta liga no guarda puestos de alineación titular.',
  'Your roster is not matched in this league, so roster changes cannot be priced.':
    'Tu plantilla no está emparejada en esta liga, así que no se pueden valorar cambios de plantilla.',
  'That trade partner is not in this league’s rosters.': 'Ese socio de intercambio no está en las plantillas de esta liga.',
  'A player in that trade is no longer on the roster we read.': 'Un jugador de ese intercambio ya no está en la plantilla que leímos.',
  'That free agent is not in the list we priced.': 'Ese agente libre no está en la lista que valoramos.',
  'One of those players is no longer on your roster.': 'Uno de esos jugadores ya no está en tu plantilla.',
  // describeTeamOutlook (outlookCopy) — third person, about another manager
  'Too few completed weeks to model': 'Muy pocas semanas completas para modelar',
  'Clinched — playing for seeding': 'Clasificado: juega por la posición',
  'In the field': 'Clasificado',
  'Eliminated — cannot reach the field': 'Eliminado: no puede clasificar',
  'Schedule complete in the model — verify final standings': 'Calendario completo en el modelo: verifica la clasificación final',
  'Very likely in — not mathematically clinched': 'Muy probablemente dentro, sin clasificar matemáticamente',
  'Long shot — probability is not elimination': 'Opción remota: una probabilidad baja no es una eliminación',
  'Must win out and get help': 'Debe ganarlo todo y recibir ayuda',
}

const plural = (n: string, one: string, many: string) => (n === '1' ? one : many)

const PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  // ── Drivers ──
  [/^Week (\d+)(?: vs (.+))?$/, (m) => `Semana ${m[1]}${m[2] ? ` vs ${m[2]}` : ''}`],
  [
    /^([\d.]+) points a week (above|below) the league average, over (\d+) weeks on file\.$/,
    (m) => `${m[1]} puntos por semana ${m[2] === 'above' ? 'por encima' : 'por debajo'} del promedio de la liga, en ${m[3]} semanas registradas.`,
  ],
  [
    /^(\d+)(?:st|nd|rd|th) hardest of (\d+): opponents average ([\d.]+) against a league average of ([\d.]+)\.$/,
    (m) => `${m[1]}.º calendario más difícil de ${m[2]}: los rivales promedian ${m[3]} frente a un promedio de la liga de ${m[4]}.`,
  ],
  [
    /^([\d.]+) wins? (more|fewer) than your weekly scores would have earned against the whole league \(([\d.]+) expected\)\.$/,
    (m) =>
      `${m[1]} ${m[1] === '1' ? 'victoria' : 'victorias'} ${m[2] === 'more' ? 'más' : 'menos'} de las que tus puntuaciones semanales habrían logrado contra toda la liga (${m[3]} esperadas).`,
  ],
  [/^Win and you are at (\d+)%; lose and you are at (\d+)%\.$/, (m) => `Si ganas, quedas en ${m[1]}%; si pierdes, en ${m[2]}%.`],
  [
    /^(.+) (is|are) ruled out — ([\d.]+) lineup points in week (\d+), if only for that week\.$/,
    (m) =>
      `${m[1]} ${m[2] === 'is' ? 'está descartado' : 'están descartados'}: ${m[3]} puntos de alineación en la semana ${m[4]}, aunque solo sea esa semana.`,
  ],
  [
    /^Measured against every team's byes\. Your worst is week (\d+): (.+) off, ([\d.]+) lineup points\.$/,
    (m) => `Medido frente a los descansos de todos los equipos. Tu peor semana es la ${m[1]}: sin ${m[2]}, ${m[3]} puntos de alineación.`,
  ],
  // ── Moves ──
  [/^Set your best lineup for week (\d+)$/, (m) => `Pon tu mejor alineación para la semana ${m[1]}`],
  [/^Start (.+) over (.+)\.$/, (m) => `Alinea a ${m[1]} en lugar de ${m[2].replace(/ \(out\)/g, ' (fuera)')}.`],
  [
    /^(.*) — ([\d.]+) projected in week (\S+)\. Worth about ([\d.]+) lineup points a week to you\.$/,
    (m) => `${m[1]} — ${m[2]} proyectados en la semana ${m[3]}. Te vale unos ${m[4]} puntos de alineación por semana.`,
  ],
  // ── Notes ──
  [
    /^The projection feed is on week (\d+), which is not one of this league's remaining weeks, so no lineup move is suggested\.$/,
    (m) => `La fuente de proyecciones está en la semana ${m[1]}, que no es una de las semanas restantes de esta liga, así que no se sugiere ningún cambio de alineación.`,
  ],
  [
    /^(\d+) factors? moved your odds by less than ([\d.]+) point and (?:is|are) not listed\.$/,
    (m) =>
      `${m[1]} ${plural(m[1], 'factor movió', 'factores movieron')} tus probabilidades menos de ${m[2]} punto y no ${plural(m[1], 'aparece', 'aparecen')}.`,
  ],
  // ── Roster flags ──
  [
    /^(\d+) starters? (?:is|are) ruled out and still in your lineup\.$/,
    (m) => `${m[1]} ${plural(m[1], 'titular está descartado y sigue', 'titulares están descartados y siguen')} en tu alineación.`,
  ],
  [/^No healthy backup at (.+)\.$/, (m) => `Sin suplente sano en ${m[1]}.`],
  [/^(Week \d+(?:, Week \d+)*): two or more starters on bye\.$/, (m) => `${m[1].replace(/Week /g, 'Semana ')}: dos o más titulares en descanso.`],
  [/^(\d+) starters are at an age where production usually falls\.$/, (m) => `${m[1]} titulares están en una edad en la que el rendimiento suele bajar.`],
  [/^(.+) is (\d+)% of your projected lineup\.$/, (m) => `${m[1]} es el ${m[2]}% de tu alineación proyectada.`],
  [/^(\d+) starters play for (.+)\.$/, (m) => `${m[1]} titulares juegan para ${m[2]}.`],
  // ── Assumptions ──
  [
    /^(\d+) teams? (?:has|have) fewer than (\d+) completed weeks, so (?:its|their) games are left unplayed in every run\.$/,
    (m) =>
      `${m[1]} ${plural(m[1], 'equipo tiene', 'equipos tienen')} menos de ${m[2]} semanas completas, así que sus partidos quedan sin jugar en todas las simulaciones.`,
  ],
  [
    /^(\d+) team names? (?:is|are) not synced\.$/,
    (m) => `${m[1]} ${plural(m[1], 'nombre de equipo no está sincronizado', 'nombres de equipo no están sincronizados')}.`,
  ],
  [/^The league does not state its playoff field, so (\d+) is assumed\.$/, (m) => `La liga no indica cuántos equipos van a playoffs, así que se asumen ${m[1]}.`],
  [
    /^First-round byes are not stated; a standard (\d+)-team bracket \((\d+) byes\) is assumed\.$/,
    (m) => `La liga no indica los descansos de primera ronda; se asume un cuadro estándar de ${m[1]} equipos (${m[2]} descansos).`,
  ],
  // ── Refusal with a pricing detail; the detail goes through the shared dictionary ──
  [/^Roster changes cannot be priced here: (.+)\.$/, (m) => `Aquí no se pueden valorar cambios de plantilla: ${coreUiCopy(m[1], 'es')}.`],
  // ── What-if result lines and problems (outlookScenario) ──
  [
    /^The trade includes (.+), who has no projection this week, so it was not priced\.$/,
    (m) => `El intercambio incluye a ${m[1]}, sin proyección esta semana, así que no se valoró.`,
  ],
  [
    /^Trade with (.+): send (.+), get (.+)\.$/,
    (m) => `Intercambio con ${m[1]}: envías ${m[2] === 'nothing' ? 'nada' : m[2]}, recibes ${m[3] === 'nothing' ? 'nada' : m[3]}.`,
  ],
  [/^(.+) has no projection this week, so the add was not priced\.$/, (m) => `${m[1]} no tiene proyección esta semana, así que la incorporación no se valoró.`],
  [/^(.+) has no projection this week, so the swap was not priced\.$/, (m) => `${m[1]} no tiene proyección esta semana, así que el cambio no se valoró.`],
  [/^(.+) is no longer on your roster\.$/, (m) => `${m[1]} ya no está en tu plantilla.`],
  [/^(.+) is not on your roster\.$/, (m) => `${m[1]} no está en tu plantilla.`],
  [/^(.+) out for the rest of the season\.$/, (m) => `${m[1]} fuera el resto de la temporada.`],
  [/^(.+) out for (\d+) weeks?\.$/, (m) => `${m[1]} fuera ${m[2]} ${plural(m[2], 'semana', 'semanas')}.`],
  [
    /^Week (\d+): start (.+) over (.+) \(([+−-]?[\d.]+) pts\)\.$/,
    (m) => `Semana ${m[1]}: alinea a ${m[2]} en lugar de ${m[3]} (${m[4]} pts).`,
  ],
  [/^Week (\d+): (.+) beat (.+)\.$/, (m) => `Semana ${m[1]}: ${m[2]} vence a ${m[3]}.`],
  // Move title and what-if line share a shape; the line carries a full stop.
  [/^Add (.+?), drop (.+?)(\.?)$/, (m) => `Añade a ${m[1]} y suelta a ${m[2]}${m[3]}`],
  [/^Add (.+?)(\.?)$/, (m) => `Añade a ${m[1]}${m[2]}`],
  // ── describeTeamOutlook ──
  [/^In barring a collapse over the last (\d+)$/, (m) => `Dentro salvo un derrumbe en los últimos ${m[1]}`],
  [/^Win (\d+) of the last (\d+)$/, (m) => `Gana ${m[1]} de los últimos ${m[2]}`],
  [/^Needs (\d+) of (\d+), and some help$/, (m) => `Necesita ${m[1]} de ${m[2]} y algo de ayuda`],
  [/^Alive, barely — outside the top (\d+)$/, (m) => `Vivo por poco: fuera de los ${m[1]} primeros`],
]

/**
 * A Season Outlook sentence in the reader's language. English passes through untouched, and so does
 * any sentence no pattern recognises — never half-translated.
 */
export function outlookText(english: string, language: string): string {
  if (language !== 'es') return english
  const fixed = FIXED[english]
  if (fixed) return fixed
  for (const [re, build] of PATTERNS) {
    const m = english.match(re)
    if (m) return build(m)
  }
  return english
}

/** Loader explanations carry live counts, so exact dictionary entries cannot cover them. */
export function seasonOutlookSentence(english: string, language: string): string {
  if (language !== 'es') return english
  const fixed: Record<string, string> = {
    'No matchups have been synced for this league.': 'No se han sincronizado enfrentamientos de esta liga.',
    'We cannot identify your team in this league, so nothing here is about you.': 'No podemos identificar tu equipo en esta liga, así que esta explicación no se refiere a ti.',
    'Settled — you are in.': 'Decidido: estás dentro.',
    'Eliminated — no remaining result gets you into the field.': 'Eliminado: ningún resultado pendiente te clasifica.',
    'Settled — the regular season is over and you are out.': 'Decidido: la temporada regular terminó y estás fuera.',
    'The regular season is over; the seeding is already what it is.': 'La temporada regular terminó; las posiciones ya están definidas.',
    'Out in every simulated run.': 'Fuera en todas las simulaciones.',
    'In the field in about 1 run in 100.': 'Clasificas en aproximadamente 1 de cada 100 simulaciones.',
  }
  if (fixed[english]) return fixed[english]
  let m = english.match(/^([\d,–]+) simulations per league, played over each league's own remaining schedule/)
  if (m) return `${m[1]} simulaciones por liga con su calendario restante, plazas de playoffs y descansos. La puntuación semanal se ajusta con las semanas completas de cada equipo según las reglas de su liga. El récord y la posición corresponden a esta temporada. Los rangos muestran la incertidumbre del pronóstico.${english.includes('Some leagues ran fewer than') ? ' Algunas ligas tuvieron menos simulaciones para acelerar la carga; se completarán en una visita posterior.' : ''}`
  m = english.match(/^Only (\d+) of (\d+) teams have three or more completed weeks on file/)
  if (m) return `Solo ${m[1]} de ${m[2]} equipos tienen tres o más semanas completas registradas; no basta para simular.`
  m = english.match(/^The rest of the schedule is not on file — (.+) has sent only the weeks already played \(through week (\d+)\)/)
  if (m) return `Falta el calendario restante: ${m[1]} solo proporcionó las semanas ya jugadas hasta la ${m[2]}. No podemos saber si la temporada terminó.`
  m = english.match(/^On the bubble at (\d+)% with (\d+) to play/)
  if (m) return `En la burbuja con ${m[1]}% y ${m[2]} partidos pendientes. Aquí una decisión de alineación puede importar más.`
  m = english.match(/^(\d+)% to win it\. Playing for seeding now/)
  if (m) return `${m[1]}% de ganar el campeonato. Ahora juegas por una mejor posición.`
  m = english.match(/^(\d+)% to make the field\. Needs help/)
  if (m) return `${m[1]}% de clasificar. Necesitas ayuda además de victorias.`
  m = english.match(/^Clinched\. The last (\d+) are about seeding\.$/)
  if (m) return `Clasificado. Los ${m[1]} partidos restantes definirán tu posición.`
  m = english.match(/^In all but a rounding error\. The last (\d+) are about seeding\.$/)
  if (m) return `Casi asegurado. Los ${m[1]} partidos restantes definirán tu posición.`
  m = english.match(/^You already have (\d+) wins, which gets you in (nine times in ten|more often than not)\.$/)
  if (m) return `Ya tienes ${m[1]} victorias; eso te clasifica ${m[2] === 'nine times in ten' ? 'en nueve de cada diez simulaciones' : 'más de la mitad de las veces'}.`
  m = english.match(/^Get to (\d+) wins — (\d+) of your last (\d+) — and you are in (nine times in ten|more often than not)\.( You will likely need help too\.)?$/)
  if (m) return `Llega a ${m[1]} victorias: necesitas ${m[2]} de los últimos ${m[3]} partidos. Así clasificas ${m[4] === 'nine times in ten' ? 'en nueve de cada diez simulaciones' : 'más de la mitad de las veces'}.${m[5] ? ' Probablemente también necesites ayuda.' : ''}`
  m = english.match(/^No win total gets you in reliably — winning out still needs help from outside the top (\d+)\.$/)
  if (m) return `Ningún total de victorias garantiza clasificar: incluso ganando todo, necesitas ayuda de equipos fuera de los ${m[1]} primeros.`
  m = english.match(/^Win (this one|once in (\d+)) and you are almost certainly in\.$/)
  if (m) return `${m[2] ? `Gana uno de los ${m[2]} restantes` : 'Gana este partido'} y casi seguro clasificarás.`
  m = english.match(/^Win (\d+) of the last (\d+) and you are in more often than not\.$/)
  if (m) return `Gana ${m[1]} de los últimos ${m[2]} partidos y clasificarás más de la mitad de las veces.`
  m = english.match(/^You need (this one|most of the last (\d+)), and help — currently outside the top (\d+)\.$/)
  if (m) return `Necesitas ${m[2] ? `ganar la mayoría de los últimos ${m[2]}` : 'ganar este partido'} y ayuda; ahora estás fuera de los ${m[3]} primeros.`
  return coreUiCopy(english, language)
}
