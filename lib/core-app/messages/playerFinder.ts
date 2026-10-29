import { defineMessages } from '@/lib/i18n/messages'
import { rankPhrase, type MatchupRead } from '@/lib/core-app/matchupOutlook'
import { moveText } from '@/lib/core-app/playerMovesCopy'
import type { PlayerMove } from '@/lib/core-app/playerMoves'
import { platformsPhraseText } from '@/lib/core-app/shellCopy'

/**
 * Player Finder (components/core-app/player-finder/: PlayerNextGames, GameDayBanner, PlayerVerdict,
 * RecommendedMoves, GameDayTriage, SwapCandidates). Every string is the one the card printed before
 * the move, byte for byte, in both languages — this is a relocation, not a rewrite. Keys are prefixed
 * by the component that renders them; `openIn` and `locked` are shared, identical in every card.
 * (Two footnotes were JSX with `&apos;`; it is the same rendered character, ', here.)
 */

const leaguesEn = (k: number) => `${k} ${k === 1 ? 'league' : 'leagues'}`
const leaguesEs = (k: number) => `${k} ${k === 1 ? 'liga' : 'ligas'}`

/** `rankPhrase` (matchupOutlook.ts) in Spanish — the screen-reader text beside the tile. */
function rankPhraseEs(r: MatchupRead, position: string): string {
  const nth = (n: number, word: string) => (n === 1 ? `la defensa más ${word}` : `${n}.ª defensa más ${word}`)
  if (r.tier === 'soft') return `${nth(r.rank, 'fácil')} contra ${position}`
  if (r.tier === 'tough') return `${nth(r.of - r.rank + 1, 'difícil')} contra ${position}`
  return `en la media contra ${position}`
}

/** Where a candidate sits now (playerImpact.ts `from`), in Spanish. */
const FROM_ES: Record<string, string> = { BENCH: 'BANCA', IR: 'IR', TAXI: 'TAXI' }

export const playerFinderMessages = defineMessages({
  en: {
    // Shared
    openIn: (link: { label: string; platformLabel: string }) => link.label,
    locked: 'locked',

    // PlayerNextGames
    marketImplied: (total: number) => `his team implied for ${total.toFixed(1)} pts`,
    marketFavored: (spread: number) => `favored by ${spread}`,
    marketUnderdog: (spread: number) => `underdog by ${spread}`,
    marketPickEm: 'a pick’em',
    marketWin: (pct: number) => `${pct}% to win`,
    marketGameTotal: (total: number) => `game total ${total}`,
    marketStale: ' · line may be out of date',
    tileSoft: 'Soft',
    tileTough: 'Tough',
    tileMid: 'Mid',
    nextTitle: 'Next game',
    nextTbd: 'TBD',
    nextUpcomingWeeks: 'Upcoming weeks',
    nextWk: 'Wk',
    nextBye: 'BYE',
    nextMuTitle: (r: MatchupRead, position: string, leagueAverage: number) =>
      `${r.opponent} allows ${r.allowedPerGame.toFixed(1)} PPR a game to ${position}s over ${r.games} games (league average ${leagueAverage.toFixed(1)})`,
    nextMuSr: (r: MatchupRead, position: string) => rankPhrase(r, position),
    nextMuFoot: (position: string, of: number) =>
      `Matchup ranks: PPR points each defense has allowed to ${position}s per game this season, among ${of} defenses — Soft #1 allows the most, Tough #1 the least.`,
    nextMuEarly: (minGames: number) => ` An early read — some defenses have played only ${minGames} ${minGames === 1 ? 'game' : 'games'}.`,

    // GameDayBanner
    bannerByeLede: 'On bye this week',
    bannerNoGameLede: 'No game on the schedule for him this week',
    bannerByeStarting: (lede: string, last: string, n: number) =>
      `${lede} — ${last} is in your starting lineup in ${leaguesEn(n)}; bench him before those lineups lock.`,
    bannerByeBench: (lede: string, benched: number) => `${lede} — on your bench in ${leaguesEn(benched)}; nothing to move.`,
    bannerByeElsewhere: (lede: string, elsewhere: number) =>
      `${lede} — not on any of your rosters; someone else has him in ${leaguesEn(elsewhere)}.`,
    bannerByeNone: (lede: string) => `${lede} — not on any roster we read.`,
    bannerLockedStarting: (last: string, n: number) =>
      `His game has kicked off — ${last} is locked in your lineup in ${leaguesEn(n)}; nothing can move now.`,
    bannerLockedNone: 'His game has kicked off — nothing of his can move now.',
    bannerStarting: (n: number, last: string) => `Starting in ${n} of your ${n === 1 ? 'league' : 'leagues'} — move ${last} before kickoff.`,
    bannerBench: (benched: number) => `On your bench in ${leaguesEn(benched)} — nothing to move before kickoff.`,
    bannerElsewhere: (elsewhere: number) => `Not on any of your rosters — someone else has him in ${leaguesEn(elsewhere)}.`,
    bannerNone: 'Not on any roster we read.',
    bannerGameDay: 'Game day',
    bannerPreseason: ' · preseason',
    /** `screenText` is the screen through coreUiCopy; English prints the screen as the link names it. */
    bannerOpenExternal: (link: { screen: string; platformLabel: string; label: string }, _screenText: string) =>
      link.screen === 'Lineup' ? `Open lineup in ${link.platformLabel}` : `${link.label} · ${link.screen}`,
    bannerOpen: 'Open',
    bannerNoLineupLink: 'no lineup link on file',

    // PlayerVerdict
    verdictLeagueFix: (move: PlayerMove, delta: string | null) =>
      `${move.title}${delta != null ? ` — ${delta} under this league's scoring` : ''}.`,
    verdictLeagueStarts: 'He starts here. Nothing to do.',
    verdictLeagueBenchRight: "He is on your bench here, and that is the right call under this league's scoring.",
    verdictLeagueBenchWorth: (points: string) => `He is on your bench here — worth ${points} under this league's scoring.`,
    verdictLeagueBench: 'He is on your bench here.',
    verdictMisplaced: (fixes: number, n: number, delta: string | null) =>
      `He is misplaced in ${fixes} of ${n} ${n === 1 ? 'league' : 'leagues'}. ${fixes === 1 ? 'One fix' : `${fixes} fixes`}${
        delta != null ? ` for ${delta}` : ''
      }.`,
    verdictAllStarting: (starting: number) => `He is in your lineup in all ${starting} ${starting === 1 ? 'league' : 'leagues'} you roster him.`,
    verdictBenchRight: (benched: number, n: number) =>
      `He is on your bench in ${benched} of ${n} ${n === 1 ? 'league' : 'leagues'}, and that is the right call under each league's scoring.`,
    verdictBenchWorth: (benched: number, n: number, points: string, leagueName: string) =>
      `He is on your bench in ${benched} of ${n} ${n === 1 ? 'league' : 'leagues'} — worth ${points} in ${leagueName}.`,
    verdictBench: (benched: number, n: number) => `He is on your bench in ${benched} of ${n} ${n === 1 ? 'league' : 'leagues'}.`,
    verdictAria: 'Chimmy verdict',
    verdictAsk: 'Ask Chimmy',
    verdictScopeLeague: 'Verdict · this league',
    verdictScopeAll: (n: number) => `Verdict · ${n} ${n === 1 ? 'league' : 'leagues'}`,
    verdictReadOnly: (platforms: string) =>
      `AllFantasy is read-only. Every change happens on ${platforms} — we show you which league and which screen.`,
    verdictPrompt: (playerName: string) => `What should I do with ${playerName} this week?`,
    verdictAskAbout: 'Ask Chimmy about',

    // RecommendedMoves
    movesTitle: 'Recommended moves',
    movesSub: 'You make them on the platform — we tell you exactly where',
    movesNothing: 'Nothing to do — he is where he should be in every league you have him.',
    movesLeagueScoring: 'under this league’s own scoring',
    movesStandardScoring: 'standard scoring',
    movesReadOnly:
      "Lineup and IR moves are priced under each league's own scoring; claims are standard scoring. AllFantasy only reads your leagues — the change happens on the platform.",

    // GameDayTriage
    triageTitle: 'Game day · your flagged starters',
    triageWeek: (week: number) => `week ${week}`,
    triageThisWeek: 'this week',
    triageRead: (read: number, count: number) => `${read} of ${count} ${count === 1 ? 'lineup' : 'lineups'} read`,
    triageBestBall: (n: number) => ` · ${n} best ball skipped`,
    triageUnsupported: (n: number) => ` · ${n} on a platform we can't read yet`,
    triageNotRead: (n: number) =>
      `${n} ${n === 1 ? 'league was' : 'leagues were'} not read — more than this list checks at once. Search a player to see every league he is in.`,
    triageClear: (weekLabel: string) => `No flagged starters across your lineups ${weekLabel}. Search any player above.`,
    triageInactive: (clock: string, minutes: number) => `declared inactive at ${clock} · ${minutes} min before kickoff`,
    triageStartingIn: (count: number) => ` · starting in ${count} ${count === 1 ? 'league' : 'leagues'}`,
    triageBenchBeforeLock: 'bench him before your leagues lock',
    triageNoKickoff: 'no kickoff to count down to',
    triageFoot:
      'Flagged means the injury feed reads Questionable, Doubtful or Out, or his club is not playing this week — a bye when the slate has the shape of one, otherwise a gap in the schedule we hold. Best-ball leagues are left out: the platform picks those lineups itself. Locks are his own kickoff; a league that locks every lineup at the first game locks earlier. A ✓ means you opened that lineup here — we cannot see the change you make on the platform until its roster refreshes.',

    // SwapCandidates
    swapsTitle: 'Swap candidates on your bench',
    swapsFrom: (from: string) => from,
    swapsFoot: "Points are under each league's own scoring, so the same player can be worth more in one than another. Green beats the player you searched.",
    swapsLocked: (n: number) => ` ${n} ${n === 1 ? 'is' : 'are'} locked — their games have kicked off, so they cannot come in now.`,
  },
  es: {
    // Shared
    openIn: (link) => `Abrir en ${link.platformLabel}`,
    locked: 'bloqueado',

    // PlayerNextGames
    marketImplied: (total) => `su equipo con ${total.toFixed(1)} pts implícitos`,
    marketFavored: (spread) => `favorito por ${spread}`,
    marketUnderdog: (spread) => `no favorito por ${spread}`,
    marketPickEm: 'parejo',
    marketWin: (pct) => `${pct}% de ganar`,
    marketGameTotal: (total) => `total del partido ${total}`,
    marketStale: ' · la línea puede estar desactualizada',
    tileSoft: 'Fácil',
    tileTough: 'Difícil',
    tileMid: 'Media',
    nextTitle: 'Próximo partido',
    nextTbd: 'Por definir',
    nextUpcomingWeeks: 'Próximas semanas',
    nextWk: 'Sem.',
    nextBye: 'DESCANSO',
    nextMuTitle: (r, position, leagueAverage) =>
      `${r.opponent} permite ${r.allowedPerGame.toFixed(1)} PPR por partido a los ${position} en ${r.games} partidos (promedio de la liga ${leagueAverage.toFixed(1)})`,
    nextMuSr: (r, position) => rankPhraseEs(r, position),
    nextMuFoot: (position, of) =>
      `Rango del enfrentamiento: puntos PPR por partido que cada defensa ha permitido a los ${position} esta temporada, entre ${of} defensas. Fácil #1 permite más, Difícil #1 permite menos.`,
    nextMuEarly: (minGames) => ` Una lectura temprana: algunas defensas solo han jugado ${minGames} ${minGames === 1 ? 'partido' : 'partidos'}.`,

    // GameDayBanner
    bannerByeLede: 'Descansa esta semana',
    bannerNoGameLede: 'No tiene partido en el calendario esta semana',
    bannerByeStarting: (lede, last, n) =>
      `${lede}: ${last} está en tu alineación titular en ${leaguesEs(n)}; siéntalo antes de que esas alineaciones se bloqueen.`,
    bannerByeBench: (lede, benched) => `${lede}: está en tu banca en ${leaguesEs(benched)}; no hay nada que mover.`,
    bannerByeElsewhere: (lede, elsewhere) => `${lede}: no está en ninguno de tus equipos; otro mánager lo tiene en ${leaguesEs(elsewhere)}.`,
    bannerByeNone: (lede) => `${lede}: no está en ningún equipo que leamos.`,
    bannerLockedStarting: (last, n) =>
      `Su partido ya empezó: ${last} está bloqueado en tu alineación en ${leaguesEs(n)}; ya no se puede mover nada.`,
    bannerLockedNone: 'Su partido ya empezó: ya no se puede mover nada suyo.',
    bannerStarting: (n, last) => `Titular en ${n} de tus ligas: mueve a ${last} antes del inicio.`,
    bannerBench: (benched) => `En tu banca en ${leaguesEs(benched)}: no hay nada que mover antes del inicio.`,
    bannerElsewhere: (elsewhere) => `No está en ninguno de tus equipos: otro mánager lo tiene en ${leaguesEs(elsewhere)}.`,
    bannerNone: 'No está en ningún equipo que leamos.',
    bannerGameDay: 'Día de partido',
    bannerPreseason: ' · pretemporada',
    bannerOpenExternal: (link, screenText) =>
      link.screen === 'Lineup' ? `Abrir la alineación en ${link.platformLabel}` : `Abrir en ${link.platformLabel} · ${screenText}`,
    bannerOpen: 'Abrir',
    bannerNoLineupLink: 'sin enlace a la alineación registrado',

    // PlayerVerdict
    verdictLeagueFix: (move, delta) => `${moveText(move, 'es').title}${delta != null ? `: ${delta} con la puntuación de esta liga` : ''}.`,
    verdictLeagueStarts: 'Aquí es titular. Nada que hacer.',
    verdictLeagueBenchRight: 'Aquí está en tu banca, y es lo correcto con la puntuación de esta liga.',
    verdictLeagueBenchWorth: (points) => `Aquí está en tu banca: vale ${points} con la puntuación de esta liga.`,
    verdictLeagueBench: 'Aquí está en tu banca.',
    verdictMisplaced: (fixes, n, delta) =>
      `Está mal ubicado en ${fixes} de ${n} ${n === 1 ? 'liga' : 'ligas'}. ${fixes === 1 ? 'Una corrección' : `${fixes} correcciones`}${delta != null ? ` por ${delta}` : ''}.`,
    verdictAllStarting: (starting) => `Está en tu alineación en ${starting === 1 ? 'la única liga' : `las ${starting} ligas`} donde lo tienes.`,
    verdictBenchRight: (benched, n) =>
      `Está en tu banca en ${benched} de ${n} ${n === 1 ? 'liga' : 'ligas'}, y es lo correcto con la puntuación de cada liga.`,
    verdictBenchWorth: (benched, n, points, leagueName) =>
      `Está en tu banca en ${benched} de ${n} ${n === 1 ? 'liga' : 'ligas'}: vale ${points} en ${leagueName}.`,
    verdictBench: (benched, n) => `Está en tu banca en ${benched} de ${n} ${n === 1 ? 'liga' : 'ligas'}.`,
    verdictAria: 'Veredicto de Chimmy',
    verdictAsk: 'Preguntar a Chimmy',
    verdictScopeLeague: 'Veredicto · esta liga',
    verdictScopeAll: (n) => `Veredicto · ${n} ${n === 1 ? 'liga' : 'ligas'}`,
    verdictReadOnly: (platforms) =>
      `AllFantasy es de solo lectura. Cada cambio se hace en ${platformsPhraseText(platforms, 'es')}: te mostramos qué liga y qué pantalla.`,
    verdictPrompt: (playerName) => `¿Qué debería hacer con ${playerName} esta semana?`,
    verdictAskAbout: 'Preguntar a Chimmy sobre',

    // RecommendedMoves
    movesTitle: 'Movimientos recomendados',
    movesSub: 'Los haces en la plataforma; nosotros te decimos exactamente dónde',
    movesNothing: 'Nada que hacer: está donde debe estar en todas las ligas donde lo tienes.',
    movesLeagueScoring: 'con la puntuación propia de esta liga',
    movesStandardScoring: 'puntuación estándar',
    movesReadOnly:
      'Los movimientos de alineación y de IR se calculan con la puntuación propia de cada liga; los reclamos, con la puntuación estándar. AllFantasy solo lee tus ligas: el cambio se hace en la plataforma.',

    // GameDayTriage
    triageTitle: 'Día de partido · tus titulares señalados',
    triageWeek: (week) => `semana ${week}`,
    triageThisWeek: 'esta semana',
    triageRead: (read, count) => `${read} de ${count} ${count === 1 ? 'alineación leída' : 'alineaciones leídas'}`,
    triageBestBall: (n) => ` · ${n} best ball ${n === 1 ? 'omitida' : 'omitidas'}`,
    triageUnsupported: (n) => ` · ${n} en una plataforma que todavía no podemos leer`,
    triageNotRead: (n) =>
      `${n} ${n === 1 ? 'liga no se leyó' : 'ligas no se leyeron'}: son más de las que esta lista revisa a la vez. Busca un jugador para ver todas las ligas en las que está.`,
    triageClear: (weekLabel) => `No hay titulares señalados en tus alineaciones (${weekLabel}). Busca cualquier jugador arriba.`,
    triageInactive: (clock, minutes) => `declarado inactivo a las ${clock} · ${minutes} min antes del inicio`,
    triageStartingIn: (count) => ` · titular en ${count} ${count === 1 ? 'liga' : 'ligas'}`,
    triageBenchBeforeLock: 'siéntalo antes de que tus ligas se bloqueen',
    triageNoKickoff: 'sin hora de inicio para la cuenta regresiva',
    triageFoot:
      'Señalado significa que el reporte de lesiones dice Dudoso, Poco probable o Fuera, o que su equipo no juega esta semana: un descanso cuando la jornada tiene esa forma, y si no, un hueco en el calendario que tenemos. Las ligas best ball quedan fuera: la plataforma arma esas alineaciones sola. Cada bloqueo es el inicio de su propio partido; una liga que bloquea todas las alineaciones en el primer partido se bloquea antes. Un ✓ significa que abriste esa alineación aquí: no vemos el cambio que hagas en la plataforma hasta que se actualice su plantel.',

    // SwapCandidates
    swapsTitle: 'Candidatos para el cambio en tu banca',
    swapsFrom: (from) => FROM_ES[from] ?? from,
    swapsFoot:
      'Los puntos usan la puntuación de cada liga, así que el mismo jugador puede valer más en una que en otra. En verde, quien supera al jugador que buscaste.',
    swapsLocked: (n) =>
      ` ${n} ${n === 1 ? 'está bloqueado: su partido ya empezó, así que no puede entrar ahora.' : 'están bloqueados: sus partidos ya empezaron, así que no pueden entrar ahora.'}`,
  },
})
