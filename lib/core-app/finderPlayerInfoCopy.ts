import { coreUiCopy } from './coreUiCopy'
import { kickoffText } from './kickoffText'
import { designationText, finderCopy, reasonText } from './playerFinderCopy'
import { claimText, takenText } from './finderSearchCopy'
import { ageText } from './shellCopy'
import { slotLabel } from './depthChart'
import { projectionHeadline, type SeasonSummary } from './playerSeason'

/**
 * Player Finder's player-info cards in the reader's language (2026-10-05): the live game badge, the
 * injury timeline chip, "Next man up" (the depth chart), "Who'd start him", "This season" and "News"
 * — components/core-app/player-finder/{LiveGameBadge, InjuryTimelineChip, DepthChartBackups,
 * WhoStartsHim, PlayerSeasonCard, PlayerNews}.tsx.
 *
 * One EN and one ES table behind the same type, as playerFinderCopy.ts does for the screen. The EN is
 * each component's English byte for byte — the player-finder-* suites pin it — so English mode is
 * unchanged.
 *
 * Shared translators are reused, never copied: "Claim X in Y" and "Taken" are finderSearchCopy's
 * (`claimText`, `takenText`), the PROJ column is playerFinderCopy's, designations through `designationText` (singular — a
 * player is «Inactivo», not the column heading «Inactivos»), month-day dates and the news weekday
 * through `kickoffText`, relative ages through shellCopy's `ageText`, "Live" / "Final" / "Week" /
 * "Trade Center" through `coreUiCopy`, and an unknown reason through playerFinderCopy's `reasonText`.
 *
 * ⚠ WHAT STAYS AS THE FEED WROTE IT: news headlines (including the injury feed's per-player sentences
 * the news list merges in), player, team and league names, NFL club codes, the opponent column and
 * the platform names. Only the app's own words around them are translated.
 *
 * ⚠ THE LOADERS ARE NOT CHANGED. Their English is translated at render: whole sentences keyed
 * verbatim on what playerDepth.ts, playerCard.ts and whoStartsHimLoader.ts write (`infoReasonText`,
 * each key held to its source by __tests__/finder-player-info-spanish.test.tsx), the season headline
 * rebuilt from the summary's numbers, and the depth chart's "yours" detail from its closed vocabulary
 * (depthChart.ts `YOURS`). Anything unknown stays whole English, never half.
 *
 * PURE, client-safe.
 */

export type PlayerInfoCopy = {
  // ── LiveGameBadge ─────────────────────────────────────────────────────────
  live: string
  final: string
  week: (week: number) => string
  liveStarting: string
  liveBench: string
  liveFinal: string
  liveUpdated: (ago: string) => string
  liveNone: string
  // ── InjuryTimelineChip ────────────────────────────────────────────────────
  /** "↑ from Out" — the arrow is passed in. */
  tlFrom: (arrow: string, status: string) => string
  tlWas: (trend: 'up' | 'down' | null, status: string, date: string) => string
  tlReturnShort: (date: string) => string
  tlReturnSentence: (date: string) => string
  // ── DepthChartBackups ─────────────────────────────────────────────────────
  dcHeading: (team: string, slot: string) => string
  dcSlot: (slot: string) => string
  dcYours: string
  dcFree: string
  dcTaken: string
  dcTakenIn: (n: number) => string
  dcCantRead: string
  /** A backup's slot in one of YOUR leagues (depthChart.ts `YOURS`, or "rostered"). */
  dcDetail: (detail: string) => string
  dcClaim: (last: string, platform: string) => string
  dcDepthAria: (depth: number) => string
  dcThisPlayer: string
  dcWhoPlays: (him: string) => string
  dcHisNumber: (him: string, depth: number) => string
  dcAsOf: (date: string) => string
  // ── WhoStartsHim ──────────────────────────────────────────────────────────
  wsHeading: (last: string) => string
  /** The CoreDepthLock subject, in the same language as the lock (coreDepthLockCopy.ts). */
  wsLockWhat: (last: string) => string
  wsNoTeam: string
  wsWouldStart: (n: number, of: number) => string
  wsOver: (slot: string, name: string) => string
  wsEmptySlot: (slot: string) => string
  wsMore: (n: number) => string
  wsOpenTradeCenter: string
  wsFoot: string
  wsTeamName: (name: string) => string
  // ── PlayerSeasonCard ──────────────────────────────────────────────────────
  thisSeason: string
  thisSeasonOf: (season: number) => string
  scoringPpr: string
  scoringLeague: (leagueName: string) => string
  points: string
  perGame: string
  games: string
  best: string
  bestValue: (points: string, week: number) => string
  chartAria: (name: string, weeks: string[]) => string
  chartWeek: (week: number, actual: string | null, projected: string | null) => string
  scored: string
  projected: string
  headline: (summary: SeasonSummary) => string | null
  colWeek: string
  colOpp: string
  colProj: string
  colScored: string
  noStats: string
  // ── PlayerNews ────────────────────────────────────────────────────────────
  news: string
  /** The label for a NewsAPI-sourced item ("News"). */
  newsFeed: string
  /** newsWhen's output ("just now", "12 min ago", "3h ago", "Sun, 10/25"). */
  newsWhen: (when: string) => string
}

const EN: PlayerInfoCopy = {
  live: 'Live',
  final: 'Final',
  week: (w) => `Week ${w}`,
  liveStarting: 'starting',
  liveBench: 'on your bench',
  liveFinal: 'final',
  liveUpdated: (ago) => `updated ${ago}`,
  liveNone: 'No league score on file for him this week — points refresh live for Sleeper leagues.',
  tlFrom: (arrow, status) => `${arrow}from ${status}`,
  tlWas: (trend, status, date) =>
    `${trend === 'up' ? 'Improved from' : trend === 'down' ? 'Worse than' : 'Was'} ${status}, last reported ${date}.`,
  tlReturnShort: (date) => `ESPN est. return ${date}`,
  tlReturnSentence: (date) => `ESPN estimates a return on ${date}.`,
  dcHeading: (team, slot) => `Next man up · ${team} ${slot}`,
  dcSlot: slotLabel,
  dcYours: 'Yours',
  dcFree: 'Free',
  dcTaken: takenText('en'),
  dcTakenIn: (n) => ` in ${n} ${n === 1 ? 'league' : 'leagues'}:`,
  dcCantRead: "Can't read",
  dcDetail: (d) => d,
  dcClaim: (last, platform) => claimText(last, platform, 'en'),
  dcDepthAria: (d) => `Depth ${d}`,
  dcThisPlayer: 'this player',
  dcWhoPlays: (him) => `Who plays if ${him} misses time, in order. `,
  dcHisNumber: (him, d) => `${him} is number ${d} here. `,
  dcAsOf: (date) => `Depth chart as of ${date}; injury status is on the card above, not from this chart.`,
  wsHeading: (last) => `Who'd start ${last}`,
  wsLockWhat: (last) => `Which teams would start ${last}`,
  wsNoTeam: 'no team would start him over what they have',
  wsWouldStart: (n, of) => `would start for ${n} of ${of} ${of === 1 ? 'team' : 'teams'}`,
  wsOver: (slot, name) => `at ${slot}, over ${name}`,
  wsEmptySlot: (slot) => `at ${slot} — a slot they can’t fill`,
  wsMore: (n) => `+${n} more`,
  wsOpenTradeCenter: 'Open Trade Center',
  wsFoot:
    "Ranked by how much he'd add to each team's best lineup, using market value in that league's format as the measure. It's who has room for him — not who will say yes.",
  wsTeamName: (name) => name,
  thisSeason: 'This season',
  thisSeasonOf: (season) => `This season · ${season}`,
  scoringPpr: 'PPR',
  scoringLeague: (name) => `${name} scoring`,
  points: 'Points',
  perGame: 'Per game',
  games: 'Games',
  best: 'Best',
  bestValue: (pts, w) => `${pts} · wk ${w}`,
  chartAria: (name, weeks) => `${name}, week by week: ${weeks.join('; ')}`,
  chartWeek: (w, actual, projected) => `week ${w} scored ${actual ?? 'nothing on file'}${projected != null ? `, projected ${projected}` : ''}`,
  scored: 'scored',
  projected: 'projected',
  headline: projectionHeadline,
  colWeek: 'Wk',
  colOpp: 'Opp',
  colProj: finderCopy('en').colProj,
  colScored: 'Scored',
  noStats: 'no stats',
  news: 'News',
  newsFeed: 'News',
  newsWhen: (when) => when,
}

/** depthChart.ts `YOURS` (and its "rostered" fallback) — the backup's slot in one of YOUR leagues. */
const DETAIL_ES: Record<string, string> = { starting: 'titular', bench: 'banca', IR: 'IR', taxi: 'taxi', rostered: 'en plantilla' }

const ES: PlayerInfoCopy = {
  live: coreUiCopy('Live', 'es'),
  final: coreUiCopy('Final', 'es'),
  week: (w) => `${coreUiCopy('Week', 'es')} ${w}`,
  liveStarting: 'titular',
  liveBench: 'en tu banca',
  liveFinal: 'final',
  liveUpdated: (ago) => `actualizado ${ageText(ago, 'es')}`,
  liveNone: 'No hay puntos de liga registrados para él esta semana: los puntos se actualizan en vivo en las ligas de Sleeper.',
  tlFrom: (arrow, status) => `${arrow}desde ${status}`,
  tlWas: (trend, status, date) =>
    `${trend === 'up' ? 'Mejoró respecto a' : trend === 'down' ? 'Peor que' : 'Figuraba como'} ${status}, reportado por última vez el ${date}.`,
  tlReturnShort: (date) => `regreso est. ESPN ${date}`,
  tlReturnSentence: (date) => `ESPN estima su regreso para el ${date}.`,
  dcHeading: (team, slot) => `El relevo · ${team} ${slot}`,
  dcSlot: (slot) => {
    const wr = /^WR([123])$/.exec(slot)
    return wr ? `WR puesto ${wr[1]}` : slot
  },
  dcYours: 'Tuyo',
  dcFree: 'Libre',
  dcTaken: takenText('es'),
  dcTakenIn: (n) => ` en ${n} ${n === 1 ? 'liga' : 'ligas'}:`,
  dcCantRead: 'No se puede leer',
  dcDetail: (d) => DETAIL_ES[d] ?? d,
  dcClaim: (last, platform) => claimText(last, platform, 'es'),
  dcDepthAria: (d) => `Número ${d} en la rotación`,
  dcThisPlayer: 'este jugador',
  dcWhoPlays: (him) => `Quién juega si ${him} se pierde partidos, en orden. `,
  dcHisNumber: (him, d) => `${him} es el número ${d} aquí. `,
  dcAsOf: (date) => `Rotación al ${date}; el estado de lesión está en la ficha de arriba, no sale de esta tabla.`,
  wsHeading: (last) => `Quién pondría de titular a ${last}`,
  wsLockWhat: (last) => `Qué equipos pondrían de titular a ${last}`,
  wsNoTeam: 'ningún equipo lo pondría de titular por delante de lo que tiene',
  wsWouldStart: (n, of) => `sería titular en ${n} de ${of} ${of === 1 ? 'equipo' : 'equipos'}`,
  wsOver: (slot, name) => `en ${slot}, en lugar de ${name}`,
  wsEmptySlot: (slot) => `en ${slot}: un puesto que no pueden cubrir`,
  wsMore: (n) => `+${n} más`,
  wsOpenTradeCenter: `Abrir ${coreUiCopy('Trade Center', 'es')}`,
  wsFoot:
    'Ordenado por cuánto sumaría a la mejor alineación de cada equipo, con el valor de mercado en el formato de esa liga como medida. Es quién tiene sitio para él, no quién va a aceptar.',
  // whoStartsHimLoader.ts names a roster with no team on file "Another team".
  wsTeamName: (name) => (name === 'Another team' ? 'Otro equipo' : name),
  thisSeason: 'Esta temporada',
  thisSeasonOf: (season) => `Esta temporada · ${season}`,
  scoringPpr: 'PPR',
  scoringLeague: (name) => `Puntuación de ${name}`,
  points: coreUiCopy('Points', 'es'),
  perGame: 'Por partido',
  games: 'Partidos',
  best: 'Mejor',
  bestValue: (pts, w) => `${pts} · sem. ${w}`,
  chartAria: (name, weeks) => `${name}, semana a semana: ${weeks.join('; ')}`,
  chartWeek: (w, actual, projected) =>
    `semana ${w}: ${actual != null ? `anotó ${actual}` : 'nada registrado'}${projected != null ? `, proyectado ${projected}` : ''}`,
  scored: 'anotado',
  projected: coreUiCopy('projected', 'es'),
  headline: (s) => {
    if (s.compared === 0) return null
    const weeks = s.compared === 1 ? 'semana' : 'semanas'
    const miss = s.meanMiss != null ? ` · con un desvío medio de ${s.meanMiss.toFixed(1)} por semana` : ''
    return `Igualó o superó su proyección en ${s.beat} de ${s.compared} ${weeks}${miss}`
  },
  colWeek: coreUiCopy('Wk', 'es'),
  colOpp: 'Rival',
  colProj: finderCopy('es').colProj,
  colScored: 'Anotó',
  noStats: 'sin estadísticas',
  news: 'Noticias',
  newsFeed: 'Noticias',
  // "Sun, 10/25" → kickoffText's "Sun 10/25" form → "dom 25/10"; the ages through ageText.
  newsWhen: (when) => kickoffText(ageText(when, 'es').replace(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), /, '$1 '), 'es'),
}

export function finderPlayerInfoCopy(language: string): PlayerInfoCopy {
  return language === 'es' ? ES : EN
}

/** A designation ("Out", "Questionable") as one player's chip reads it — `designationText`, singular. */
export function infoDesignationText(status: string, language: string): string {
  return designationText(status, language)
}

/** "Oct 5" — the en-US month-day these cards format — in the reader's language ("5 oct"). */
export function infoDateText(monthDay: string, language: string): string {
  return kickoffText(monthDay, language)
}

/**
 * The loaders' reasons and notes these cards print, verbatim. Every key is a sentence a loader
 * writes today; a test holds each one to its source file.
 */
const REASON_ES: Record<string, string> = {
  // lib/core-app/playerDepth.ts — the season card
  'No weekly projections or stat lines on file for this player.': 'No hay proyecciones semanales ni estadísticas registradas para este jugador.',
  // lib/core-app/playerDepth.ts and playerCard.ts `loadNews` — the news list
  'News could not be read.': 'No se pudieron leer las noticias.',
  'No recent item mentions this player.': 'Ninguna noticia reciente menciona a este jugador.',
  // lib/core-app/whoStartsHimLoader.ts — why a league is not ranked
  'this league could not be read just now': 'no se pudo leer esta liga en este momento',
  'other teams’ rosters in this league use the platform’s own player ids, so we can’t read them yet':
    'las plantillas de los otros equipos de esta liga usan los ids de jugador propios de la plataforma, así que todavía no podemos leerlas',
  'we couldn’t find your team in this league': 'no encontramos tu equipo en esta liga',
  'no other teams are on file': 'no hay otros equipos registrados',
  'this league’s lineup is not on file': 'la alineación de esta liga no está registrada',
  'he has no market value in this league’s format': 'no tiene valor de mercado en el formato de esta liga',
  'too few players on the other rosters have a market value to compare':
    'muy pocos jugadores de las otras plantillas tienen valor de mercado para comparar',
}

const REASON_PATTERNS_ES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  // whoStartsHimLoader.ts — a lineup with slots the engine does not model
  [/^lineup slot (\S+) isn’t modelled$/, (m) => `el puesto de alineación ${m[1]} no está modelado`],
  [/^lineup slots (.+) aren’t modelled$/, (m) => `los puestos de alineación ${m[1]} no están modelados`],
]

/** Every loader sentence `infoReasonText` translates whole — exported so a test can hold each to its source. */
export const INFO_REASON_KEYS: readonly string[] = Object.keys(REASON_ES)

/** A loader's reason or note in the reader's language; an unknown one goes to `reasonText`, then stays English. */
export function infoReasonText(reason: string, language: string): string {
  if (language !== 'es') return reason
  const exact = REASON_ES[reason]
  if (exact != null) return exact
  for (const [pattern, build] of REASON_PATTERNS_ES) {
    const m = reason.match(pattern)
    if (m) return build(m)
  }
  return reasonText(reason, language)
}
