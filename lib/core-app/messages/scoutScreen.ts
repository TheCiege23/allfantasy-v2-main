import { defineMessages } from '@/lib/i18n/messages'
import type { Zone } from '@/lib/core-app/standingsModel'

/**
 * Scout, the first room of the War Room (components/core-app/screens/Scout.tsx): the manager cards,
 * the opponent and elimination banners, the format note, the standings basis and the Competitive
 * Edge lines.
 * Every string is the one the component wrote before the move, byte for byte, in both languages — a
 * relocation, not a rewrite.
 */

/** Where a team stands in an elimination week — Scout's own `ElimStatus`. */
type ElimStatus = 'safe' | 'bubble' | 'eliminated'

export const scoutScreenMessages = defineMessages({
  en: {
    // EdgeLine
    edgeNoTrades: 'no completed trades',
    edgeTrades: (n: number, last: string | null) => `${n} ${n === 1 ? 'trade' : 'trades'}${last ? ` · last ${last}` : ''}`,
    edgeWaiverClaims: (n: number) => `${n} waiver ${n === 1 ? 'claim' : 'claims'} won`,
    edgeFaabLeft: (left: string) => `$${left} FAAB left`,

    // EdgeBasis
    edgeBasisTrades: (span: string | null, read: string | null, stale: boolean) =>
      `completed trades${span ? ` across ${span}` : ''}, read ${read ?? 'recently'}${stale ? ' (may be out of date)' : ''}`,
    edgeBasisTradesLabel: 'trades',
    edgeBasisWaivers: (season: number, stale: boolean) =>
      `waiver claims won in ${season}${stale ? ' (may be out of date)' : ''} — Sleeper records only winning claims`,
    edgeBasisWaiversLabel: 'waivers',

    // Zone and elimination labels
    zoneLabel: (zone: Zone): string =>
      ({
        bye: 'Bye spot',
        playoff: 'Playoff spot',
        bubble: 'On the bubble',
        out: 'Outside the playoffs',
        eliminated: 'Eliminated',
      })[zone],
    elimLabel: (status: ElimStatus): string => ({ safe: 'Safe', bubble: 'On the bubble', eliminated: 'Eliminated' })[status],

    // Games back
    gamesBack: (gb: number): string => {
      const games = (n: number) => `${n} ${n === 1 ? 'game' : 'games'}`
      if (gb > 0) return `${games(gb)} back of a playoff spot`
      if (gb < 0) return `${games(-gb)} clear of the cut`
      return 'tied on record with the last playoff spot'
    },

    // Form
    formAria: (n: number, results: string) => `Last ${n}: ${results}`,

    // Facts
    factSeed: 'Seed',
    factRecord: 'Record',
    factPointsFor: 'Points for',
    factPower: 'Power',

    // ManagerCard
    ownerUnnamed: 'Manager not named',
    tagOut: (week: number | null) => (week != null ? `OUT · WEEK ${week}` : 'OUT'),
    tagThisWeek: 'THIS WEEK',
    tagYou: 'YOU',
    notOnStandings: 'Not on the standings table yet.',
    picksNone: 'No future picks held',
    picksHeld: (count: number, early: number) => `${count} future ${count === 1 ? 'pick' : 'picks'} · ${early} in rounds 1–2`,
    buildTrade: 'Build a trade',

    // OpponentBanner
    thisWeek: 'This week',
    weekSuffix: (week: number) => ` · week ${week}`,
    youFallback: 'You',
    notOnTableYet: 'not on the table yet',
    h2hBefore: 'You are ',
    h2hAfter: ' against them this season.',
    h2hNone: 'You have not played them yet this season.',
    projectedLink: 'Projected score & win odds',

    // EliminationBanner
    eliminationLeague: 'Elimination league',
    chopped: (week: number | null) =>
      `You were chopped${week != null ? ` in week ${week}` : ''}. The cards below are the managers still alive.`,
    eliminationWeek: 'Elimination week',
    youAre: 'You are',
    of: 'of',
    atCutLine: ' — at the cut line.',
    overCut: (overCut: number) => ` — ${overCut.toFixed(1)} over the cut.`,
    projectedNote: ' Projected: most teams have not played yet.',
    cutUnreadable: 'The cut line is not readable yet this week.',
    everyTeamVsCut: 'Every team against the cut',

    // FormatNote
    bestBallNote:
      'Best ball: the platform starts your highest scorers each week, so there is no lineup to set and no game plan for this league.',
    dynastyPicksMissing: 'Dynasty: future picks could not be read for this league.',
    dynastyPicksLabel: 'Dynasty picks',

    // Scout
    blurb: 'Where every manager in this league stands, and how they have played lately.',
    blurbWeek: (week: number, seasonYear: number) => ` Week ${week} of ${seasonYear}.`,
    everyLeaguePlan: "Every league's game plan",
    standingsThroughWeek: 'Standings through week',
    seasonFinal: ' — final',
    noStandingsYet: 'No standings yet',
    edgeLockWhat: 'Every manager’s trade and waiver record',
    // The "Sep 21, 2025" day format's locale
    dayLocale: 'en-US',
  },
  es: {
    // EdgeLine
    edgeNoTrades: 'ningún intercambio completado',
    edgeTrades: (n, last) => `${n} ${n === 1 ? 'intercambio' : 'intercambios'}${last ? ` · el último ${last}` : ''}`,
    edgeWaiverClaims: (n) => `${n} ${n === 1 ? 'reclamo ganado' : 'reclamos ganados'}`,
    edgeFaabLeft: (left) => `le quedan $${left} de FAAB`,

    // EdgeBasis
    edgeBasisTrades: (span, read, stale) =>
      `intercambios completados${span ? ` en ${span}` : ''}, leídos ${read ?? 'hace poco'}${stale ? ' (puede estar desactualizado)' : ''}`,
    edgeBasisTradesLabel: 'intercambios',
    edgeBasisWaivers: (season, stale) =>
      `reclamos ganados en ${season}${stale ? ' (puede estar desactualizado)' : ''}: Sleeper solo registra los reclamos ganados`,
    edgeBasisWaiversLabel: 'agentes libres',

    // Zone and elimination labels
    zoneLabel: (zone) =>
      ({
        bye: 'Puesto con descanso',
        playoff: 'Puesto de playoffs',
        bubble: 'En el límite',
        out: 'Fuera de los playoffs',
        eliminated: 'Eliminado',
      })[zone],
    elimLabel: (status) => ({ safe: 'A salvo', bubble: 'En el límite', eliminated: 'Eliminado' })[status],

    // Games back
    gamesBack: (gb) => {
      const juegos = (n: number) => `${n} ${n === 1 ? 'juego' : 'juegos'}`
      if (gb > 0) return `a ${juegos(gb)} de un puesto de playoffs`
      if (gb < 0) return `${juegos(-gb)} por encima del corte`
      return 'empatado en récord con el último puesto de playoffs'
    },

    // Form
    formAria: (n, results) => `Últimos ${n}: ${results}`,

    // Facts
    factSeed: 'Posición',
    factRecord: 'Récord',
    factPointsFor: 'Puntos a favor',
    factPower: 'Poder',

    // ManagerCard
    ownerUnnamed: 'Mánager sin nombre',
    tagOut: (week) => (week != null ? `FUERA · SEMANA ${week}` : 'FUERA'),
    tagThisWeek: 'ESTA SEMANA',
    tagYou: 'TÚ',
    notOnStandings: 'Todavía no aparece en la clasificación.',
    picksNone: 'Sin selecciones futuras',
    picksHeld: (count, early) =>
      `${count} ${count === 1 ? 'selección futura' : 'selecciones futuras'} · ${early} en rondas 1–2`,
    buildTrade: 'Armar un intercambio',

    // OpponentBanner
    thisWeek: 'Esta semana',
    weekSuffix: (week) => ` · semana ${week}`,
    youFallback: 'Tú',
    notOnTableYet: 'todavía no en la tabla',
    h2hBefore: 'Vas ',
    h2hAfter: ' contra ellos esta temporada.',
    h2hNone: 'Todavía no te enfrentaste a ellos esta temporada.',
    projectedLink: 'Puntuación proyectada y probabilidad de ganar',

    // EliminationBanner
    eliminationLeague: 'Liga de eliminación',
    chopped: (week) =>
      `Te eliminaron${week != null ? ` en la semana ${week}` : ''}. Las tarjetas de abajo son los mánagers que siguen vivos.`,
    eliminationWeek: 'Semana de eliminación',
    youAre: 'Vas',
    of: 'de',
    atCutLine: ': en la línea de corte.',
    overCut: (overCut) => `: ${overCut.toFixed(1)} por encima del corte.`,
    projectedNote: ' Proyectado: la mayoría de los equipos todavía no jugó.',
    cutUnreadable: 'Todavía no se puede leer la línea de corte esta semana.',
    everyTeamVsCut: 'Todos los equipos frente al corte',

    // FormatNote
    bestBallNote:
      'Best ball: la plataforma alinea a tus máximos anotadores cada semana, así que no hay alineación que armar ni plan de juego para esta liga.',
    dynastyPicksMissing: 'Dinastía: no se pudieron leer las selecciones futuras de esta liga.',
    dynastyPicksLabel: 'Selecciones de dinastía',

    // Scout
    blurb: 'Dónde está cada mánager de esta liga y cómo viene jugando.',
    blurbWeek: (week, seasonYear) => ` Semana ${week} de ${seasonYear}.`,
    everyLeaguePlan: 'El plan de juego de cada liga',
    standingsThroughWeek: 'Clasificación hasta la semana',
    seasonFinal: ' (final)',
    noStandingsYet: 'Todavía no hay clasificación',
    edgeLockWhat: 'El historial de intercambios y reclamos de cada mánager',
    dayLocale: 'es-US',
  },
})
