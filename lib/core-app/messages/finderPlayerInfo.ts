import type { PlayerInfoCopy } from '../finderPlayerInfoCopy'
import { coreUiCopy } from '../coreUiCopy'
import { kickoffText } from '../kickoffText'
import { finderCopy } from '../playerFinderCopy'
import { claimText, takenText } from '../finderSearchCopy'
import { ageText } from '../shellCopy'
import { slotLabel } from '../depthChart'
import { projectionHeadline, type SeasonSummary } from '../playerSeason'
import { defineMessages } from '@/lib/i18n/messages'

/**
 * Player Finder's player-info cards (lib/core-app/finderPlayerInfoCopy.ts): the live game badge, the
 * injury timeline chip, "Next man up", "Who'd start him", "This season" and "News". Every string is
 * the one the module produced before the move, byte for byte, in both languages — a relocation, not a
 * rewrite. The `PlayerInfoCopy` type stays exported from finderPlayerInfoCopy.ts, which callers
 * already import. The loaders' reasons stay there: they are Spanish keyed on English, not en/es pairs.
 *
 * `headline` is the one value whose type allows "nothing to say" (`null`), which a catalog value
 * cannot return; here it returns '' for that case and `finderPlayerInfoCopy` turns '' back into `null`.
 */

/** depthChart.ts `YOURS` (and its "rostered" fallback) — the backup's slot in one of YOUR leagues. */
const DETAIL_ES: Record<string, string> = { starting: 'titular', bench: 'banca', IR: 'IR', taxi: 'taxi', rostered: 'en plantilla' }

export type PlayerInfoMessages = Omit<PlayerInfoCopy, 'headline'> & { headline: (summary: SeasonSummary) => string }

export const finderPlayerInfoMessages = defineMessages<PlayerInfoMessages>({
  en: {
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
    headline: (s): string => projectionHeadline(s) ?? '',
    colWeek: 'Wk',
    colOpp: 'Opp',
    colProj: finderCopy('en').colProj,
    colScored: 'Scored',
    noStats: 'no stats',
    news: 'News',
    newsFeed: 'News',
    newsWhen: (when) => when,
  },
  es: {
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
    headline: (s): string => {
      if (s.compared === 0) return ''
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
  },
})
