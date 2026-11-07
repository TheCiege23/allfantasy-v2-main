import { defineMessages } from '@/lib/i18n/messages'

/**
 * Live Scores sentences that carry numbers or names (lib/core-app/liveScoresCopy.ts, rendered by
 * components/core-app/screens/LiveScores.tsx and the game view). liveScoresCopy.ts keeps its exported
 * functions and their signatures; each now reads its sentence from here. Its exact-match `ES` table
 * stays there and hands its entry to `exact`; the label localisers (`playAge`, `projection`,
 * `starterStageDetail`) are handed the English label and return it unchanged in English.
 * Every string is the one the function wrote before the move, byte for byte, in both languages —
 * a relocation, not a rewrite.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** Base names inside the Spanish diamond label; only `runnersOn`'s Spanish sentence reads it. */
const BASE_ES: Record<string, string> = { first: 'primera', second: 'segunda', third: 'tercera' }

/** The starter-stage counts `starterStageDetail` in lib/live/liveImpact was built from. */
type StageImpact = { livePlayers: number; liveGames: number; upcomingPlayers?: number; finishedPlayers?: number }

export const liveScoresMessages = defineMessages({
  en: {
    /** " · updated 12s ago" */
    updatedAgo: (age: string) => ` · updated ${age} ago`,
    slateCountAria: (n: number) => `${n} ${plural(n, 'game', 'games')} in slate`,
    top25HiddenNote: (n: number) => `Top 25 and teams you follow · ${n} other ${plural(n, 'game', 'games')} hidden.`,
    top25EmptyBody: (n: number) => `${n} ${plural(n, 'game', 'games')} between unranked teams ${plural(n, 'is', 'are')} hidden.`,
    noScoreboardMatch: (query: string) => `No scoreboard match for “${query}”.`,
    missingScores: (n: number) => `${n} player scores unavailable; totals are partial.`,
    startersPlayingNow: (n: number, leagueScoped: boolean) =>
      `${plural(n, 'starter', 'starters')} playing now${leagueScoped ? ' in this league' : ''}`,
    noneOnField: (detail: string) => `None on the field right now · ${detail}`,
    weekLabel: (sport: string, week: number) => `${sport} · Week ${week}`,
    highlightTitle: (away: string, home: string) => `${away} at ${home} highlights`,
    teamBall: (abbrev: string) => `${abbrev} ball`,
    /** `bases` is never empty here; the empty diamond is the exact-match "Bases empty". */
    runnersOn: (bases: readonly string[]) => `Runner${bases.length > 1 ? 's' : ''} on ${bases.join(' and ')}`,
    countSuffix: (balls: number, strikes: number, outs: number) =>
      `, ${balls}-${strikes} count, ${outs} ${plural(outs, 'out', 'outs')}`,
    timeoutsLeft: (abbrev: string, left: number) => `${abbrev} ${left} timeouts left`,
    teamLeaders: (abbrev: string) => `${abbrev} leaders`,
    finalCount: (n: number) => `Final · ${n} ${plural(n, 'game', 'games')}`,
    starterCount: (n: number) => `${n} ${plural(n, 'starter', 'starters')}`,
    topPrefix: ' · top ',
    yourStartersHead: (players: number, leagues: number) =>
      `Your starters · ${players} ${plural(players, 'player', 'players')} · ${leagues} ${plural(leagues, 'league', 'leagues')}`,
    showAllStarters: (n: number) => `Show all ${n} starters`,
    leagueCount: (n: number) => `${n} ${plural(n, 'league', 'leagues')}`,
    projectionTitle: (leagueName: string | null) =>
      `Projection for this week${leagueName ? ` in ${leagueName}` : ''}, under each league’s own scoring`,
    pointsIn: (leagueName: string) => `Points in ${leagueName}`,
    /** n ≠ 1; one decision is the exact-match "Lineup decision closing". */
    lineupDecisionsClosing: (n: number) => `${n} lineup decisions closing`,
    kicksOffIn: (countdown: string) => `kicks off in ${countdown}`,
    // lockExposure's pieces
    lockBenched: (n: number) => `${n} benched`,
    lockStarting: (n: number) => `${n} starting`,
    lockLeagues: (n: number) => `${n} leagues`,
    // LiveNowStrip (the "now" strip and the games strip, design board LiveScores)
    nowCounts: (live: number, final: number, upcoming: number) => `${live} live · ${final} final · ${upcoming} upcoming`,
    nowStarters: (n: number) => `${n} of your ${plural(n, 'starters is', 'starters are')} playing`,
    slateGamesHead: (sport: string) => `${sport} games`,
    chipYours: (n: number) => `${n} ${plural(n, 'starter', 'starters')}`,
    chipYoursNames: (names: string) => `Your starters in this game: ${names}`,
    winChance: (pct: number) => `${pct}% to win`,
    // The standing strip (LiveMatchupStrip): your place against the field when there is no opponent.
    // English is byte-for-byte what the strip printed before it was translated.
    standingAria: 'Your standing',
    standingRank: (rank: number): string => {
      const teens = rank % 100
      if (teens >= 11 && teens <= 13) return `${rank}th`
      const unit = rank % 10
      return `${rank}${unit === 1 ? 'st' : unit === 2 ? 'nd' : unit === 3 ? 'rd' : 'th'}`
    },
    standingOf: (outOf: number) => `of ${outOf}`,
    standingAtBottom: (elimination: boolean): string => (elimination ? 'On the block' : 'Last place'),
    standingOverCut: (points: string, elimination: boolean) => `+${points} over ${elimination ? 'the cut' : 'last place'}`,
    standingInCut: (elimination: boolean): string => (elimination ? 'You are in the cut position' : 'Bottom of the league this week'),
    standingPlacesClear: (n: number, elimination: boolean) =>
      `${n} ${plural(n, 'place', 'places')} clear of ${elimination ? 'the cut' : 'last place'}`,
    standingCutLine: (line: string) => ` · cut line ${line}`,
    standingBasis: (basis: 'points' | 'projected' | 'best_ball', provisional: boolean): string =>
      basis === 'best_ball'
        ? provisional ? ' · ranked on projected best-ball finals until the last game is final' : ' · ranked on final best-ball points'
        : basis === 'projected' ? ' · ranked on projection until most of the field has played' : ' · ranked on points',
    standingSeeField: 'See the field',
    // liveScoresCopy's exact-match table entry, and the label localisers
    exact: (english: string, _translation: string | undefined): string => english,
    starterStageDetail: (english: string, _impact: StageImpact): string => english,
    playAge: (label: string): string => label,
    projection: (label: string): string => label,
  },
  es: {
    updatedAgo: (age) => ` · actualizado hace ${age}`,
    slateCountAria: (n) => `${n} ${plural(n, 'partido', 'partidos')} en la jornada`,
    top25HiddenNote: (n) => `Top 25 y equipos que sigues · ${n} ${plural(n, 'partido más oculto', 'partidos más ocultos')}.`,
    top25EmptyBody: (n) =>
      `${n} ${plural(n, 'partido entre equipos sin ranking está oculto', 'partidos entre equipos sin ranking están ocultos')}.`,
    noScoreboardMatch: (query) => `Ningún resultado en el marcador para “${query}”.`,
    missingScores: (n) =>
      `${n} ${plural(n, 'puntuación de jugador no disponible', 'puntuaciones de jugadores no disponibles')}; los totales son parciales.`,
    startersPlayingNow: (n, leagueScoped) =>
      `${plural(n, 'titular jugando', 'titulares jugando')} ahora${leagueScoped ? ' en esta liga' : ''}`,
    noneOnField: (detail) => `Ninguno en el campo ahora mismo · ${detail}`,
    weekLabel: (sport, week) => `${sport} · Semana ${week}`,
    highlightTitle: (away, home) => `Resumen: ${away} en ${home}`,
    teamBall: (abbrev) => `Balón de ${abbrev}`,
    runnersOn: (bases) => `${plural(bases.length, 'Corredor', 'Corredores')} en ${bases.map((b) => BASE_ES[b] ?? b).join(' y ')}`,
    countSuffix: (balls, strikes, outs) => `, cuenta ${balls}-${strikes}, ${outs} ${plural(outs, 'out', 'outs')}`,
    timeoutsLeft: (abbrev, left) => `${abbrev}: ${left} ${plural(left, 'tiempo muerto restante', 'tiempos muertos restantes')}`,
    teamLeaders: (abbrev) => `Líderes de ${abbrev}`,
    finalCount: (n) => `Final · ${n} ${plural(n, 'partido', 'partidos')}`,
    starterCount: (n) => `${n} ${plural(n, 'titular', 'titulares')}`,
    topPrefix: ' · mejor ',
    yourStartersHead: (players, leagues) =>
      `Tus titulares · ${players} ${plural(players, 'jugador', 'jugadores')} · ${leagues} ${plural(leagues, 'liga', 'ligas')}`,
    showAllStarters: (n) => `Mostrar los ${n} titulares`,
    leagueCount: (n) => `${n} ${plural(n, 'liga', 'ligas')}`,
    projectionTitle: (leagueName) =>
      `Proyección de esta semana${leagueName ? ` en ${leagueName}` : ''}, según la puntuación de cada liga`,
    pointsIn: (leagueName) => `Puntos en ${leagueName}`,
    lineupDecisionsClosing: (n) => `Se cierran ${n} decisiones de alineación`,
    kicksOffIn: (countdown) => `empieza en ${countdown}`,
    lockBenched: (n) => `${n} en la banca`,
    lockStarting: (n) => `${n} ${plural(n, 'titular', 'titulares')}`,
    lockLeagues: (n) => `${n} ligas`,
    nowCounts: (live, final, upcoming) => `${live} en vivo · ${final} ${plural(final, 'finalizado', 'finalizados')} · ${upcoming} por jugar`,
    nowStarters: (n) => `${n} ${plural(n, 'titular tuyo está jugando', 'titulares tuyos están jugando')}`,
    slateGamesHead: (sport) => `Partidos de ${sport}`,
    chipYours: (n) => `${n} ${plural(n, 'titular', 'titulares')}`,
    chipYoursNames: (names) => `Tus titulares en este partido: ${names}`,
    winChance: (pct) => `${pct}% de ganar`,
    standingAria: 'Tu posición',
    standingRank: (rank) => `${rank}.º`,
    standingOf: (outOf) => `de ${outOf}`,
    standingAtBottom: (elimination) => (elimination ? 'En zona de corte' : 'Último lugar'),
    standingOverCut: (points, elimination) => `+${points} sobre ${elimination ? 'el corte' : 'el último lugar'}`,
    standingInCut: (elimination) => (elimination ? 'Estás en la posición de corte' : 'Último de la liga esta semana'),
    standingPlacesClear: (n, elimination) =>
      `${n} ${plural(n, 'puesto', 'puestos')} por encima ${elimination ? 'del corte' : 'del último lugar'}`,
    standingCutLine: (line) => ` · línea de corte ${line}`,
    standingBasis: (basis, provisional) =>
      basis === 'best_ball'
        ? provisional ? ' · según los finales proyectados de best ball hasta que termine el último partido' : ' · según los puntos finales de best ball'
        : basis === 'projected' ? ' · según la proyección hasta que juegue la mayoría' : ' · según los puntos',
    standingSeeField: 'Ver la clasificación',
    exact: (english, translation) => translation ?? english,
    starterStageDetail: (_english, impact) => {
      const parts: string[] = []
      if (impact.livePlayers > 0) parts.push(`en ${impact.liveGames} ${plural(impact.liveGames, 'partido', 'partidos')}`)
      if (impact.upcomingPlayers) parts.push(`${impact.upcomingPlayers} por jugar`)
      if (impact.finishedPlayers) parts.push(`${impact.finishedPlayers} ${plural(impact.finishedPlayers, 'terminado', 'terminados')}`)
      return parts.join(' · ')
    },
    playAge: (label) => {
      if (label === 'just now') return 'justo ahora'
      const min = /^(\d+) min ago$/.exec(label)
      if (min) return `hace ${min[1]} min`
      const hr = /^(\d+) hr ago$/.exec(label)
      if (hr) return `hace ${hr[1]} h`
      return label
    },
    projection: (label) => {
      if (label === 'out') return 'fuera'
      if (label.startsWith('proj ')) return `proy. ${label.slice(5)}`
      return label
    },
  },
})
