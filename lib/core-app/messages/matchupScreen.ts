import { defineMessages } from '@/lib/i18n/messages'

/**
 * The matchup screen (components/core-app/screens/Matchup.tsx): the scoreboard and board reading
 * tips, the live-points basis line, the slot tally, the coverage notes, the Guilly explanation and the
 * head-to-head caveat. Every string is the one the component wrote before the move, byte for byte, in
 * both languages — a relocation, not a rewrite.
 */
export const matchupScreenMessages = defineMessages({
  en: {
    // BannerTip — `projEs` is the banner's own Spanish tag, `coreUiCopy('proj', 'es')`, quoted as it renders.
    bannerTipTitle: 'How to read this scoreboard',
    bannerTipScore: (_projEs: string): string =>
      'The big numbers are points scored, once any starter has played. Before that they are each lineup’s projected final — Sleeper’s projection, re-scored under this league’s settings — marked “proj”.',
    bannerTipAf: 'AF beneath it is AllFantasy’s own engine on the same lineup, for comparison.',
    bannerTipWinProbability: 'Win probability adds the points already scored to each remaining starter’s projection, with a spread measured from real weekly scores; an empty slot or a starter ruled out counts as zero. It treats players as independent — though a quarterback and his receiver score together — so it leans too sure, which is why confidence never reads HIGH while anyone is still to play. If a starter still to play has no projection, or a game’s state can’t be confirmed, no percentage is shown rather than a guess.',
    bannerTipChip: 'The chip below it is the gap between the two big numbers — “Projected” until a starter has played.',

    // BoardTip
    boardTipTitle: 'How to read this board',
    boardTipLive: 'PTS is each player’s points this week, as the platform scored them.',
    boardTipPre: 'Before kickoff each player shows two projections: SLPR is Sleeper’s, re-scored under this league’s settings; AF is AllFantasy’s own engine on the same settings.',
    boardTipRows: (live: boolean) =>
      `Each row pairs your starter with theirs, slot by slot, and is tinted on the side winning it${live ? '' : ' on Sleeper’s projection'}. No tint when one side has no number — there is nothing to compare.`,
    boardTipTally: 'The tally above counts those slots; “of N comparable” means some slots were missing a number on one side.',

    // LineupBoard
    livePoints: (source: string, playersScored: number) =>
      `Live points as ${source} scored them — ${playersScored} players on file.`,
    tallyLabel: (live: boolean, opponent: number, even: number) =>
      `${live ? 'slots winning' : 'slots projected to win'} · ${opponent} losing${even ? ` · ${even} even` : ''}`,
    tallyOf: (tallied: number) => `of ${tallied} comparable`,
    coverage: (yoursFrom: number, yoursOf: number, theirsFrom: number, theirsOf: number) =>
      `Built from ${yoursFrom} of your ${yoursOf} starters and ${theirsFrom} of their ${theirsOf}, so both totals read low — and by different amounts.`,

    // Matchup
    guillyBasis: 'In a Guilly league you play the whole field: the lowest score each week is eliminated, so there is no single opponent to face.',
    meetingsOnFile: (you: number, them: number, week: number) =>
      `meetings on file; last: ${you > them ? 'W' : you < them ? 'L' : 'T'} ${you.toFixed(1)}–${them.toFixed(1)} (wk ${week})`,
    builtWithout: (you: number, opponent: number) =>
      `built without ${you} of your starters and ${opponent} of theirs, so both totals read low`,
  },
  es: {
    bannerTipTitle: 'Cómo leer este marcador',
    bannerTipScore: (projEs) =>
      `Los números grandes son los puntos anotados en cuanto juega un titular. Antes de eso son el total final proyectado de cada alineación —la proyección de Sleeper recalculada con la configuración de esta liga—, marcado «${projEs}».`,
    bannerTipAf: 'AF debajo es el motor propio de AllFantasy con la misma alineación, para comparar.',
    bannerTipWinProbability: 'La probabilidad de victoria suma los puntos ya anotados y la proyección de cada titular pendiente, con una dispersión medida en puntuaciones semanales reales; una posición vacía o un titular descartado cuenta como cero. Trata a los jugadores como independientes, aunque un mariscal y su receptor anotan juntos, así que tiende a ser demasiado segura: por eso la confianza nunca es ALTA mientras quede alguien por jugar. Si a un titular pendiente le falta la proyección, o no se puede confirmar el estado de un partido, no se muestra un porcentaje en vez de adivinarlo.',
    bannerTipChip: 'La etiqueta de abajo es la diferencia entre los dos números grandes: «proyectada» hasta que juega un titular.',

    boardTipTitle: 'Cómo leer esta tabla',
    boardTipLive: 'PTS son los puntos de cada jugador esta semana, tal como los anotó la plataforma.',
    boardTipPre: 'Antes del inicio cada jugador muestra dos proyecciones: SLPR es la de Sleeper, recalculada con la configuración de esta liga; AF es el motor propio de AllFantasy con la misma configuración.',
    boardTipRows: (live) =>
      `Cada fila empareja tu titular con el suyo, posición por posición, y se tiñe del lado que la gana${live ? '' : ' según la proyección de Sleeper'}. Sin tinte cuando a un lado le falta el número: no se puede comparar.`,
    boardTipTally: 'El recuento de arriba cuenta esas posiciones; «de N comparables» significa que en algunas faltaba el número de un lado.',

    livePoints: (source, playersScored) =>
      `Puntos en vivo según ${source} — ${playersScored} jugadores registrados.`,
    tallyLabel: (live, opponent, even) =>
      `posiciones ${live ? 'ganando' : 'proyectadas a favor'} · ${opponent} en contra${even ? ` · ${even} igualadas` : ''}`,
    tallyOf: (tallied) => `de ${tallied} comparables`,
    coverage: (yoursFrom, yoursOf, theirsFrom, theirsOf) =>
      `Calculado con ${yoursFrom} de tus ${yoursOf} titulares y ${theirsFrom} de sus ${theirsOf}; ambos totales pueden ser bajos en distinta medida.`,

    guillyBasis: 'En una liga Guilly compites contra toda la liga: cada semana se elimina la puntuación más baja, así que no hay un único rival.',
    meetingsOnFile: (you, them, week) =>
      `enfrentamientos registrados; último: ${you.toFixed(1)}–${them.toFixed(1)} (sem. ${week})`,
    builtWithout: (you, opponent) =>
      `calculado sin ${you} de tus titulares y ${opponent} de los suyos; ambos totales pueden ser bajos`,
  },
})
