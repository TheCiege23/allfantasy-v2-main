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

    // Scoreboard — the live line under each score.
    liveCount: (n: number) => `${n} live`,
    scoreProj: (proj: string, value: number) => `${proj} ${value.toFixed(1)}`,

    // Per-player state chips on a live board (a kickoff time is its own chip).
    chipLive: 'LIVE',
    chipFinal: 'FINAL',

    // Insight cards — each drawn only when the stored data answers it.
    insightsLabel: 'What this week turns on',
    swingLabel: 'Swing game',
    swingOnNow: 'on now',
    swingBody: (yours: string[], theirs: string[], inGame: number, remaining: number) => {
      const list = (names: string[]) =>
        names.length <= 3
          ? names.length === 1
            ? names[0]
            : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
          : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
      const who =
        yours.length && theirs.length
          ? `Your ${list(yours)} against their ${list(theirs)}.`
          : yours.length
            ? `Your ${list(yours)}, and nobody of theirs.`
            : `Their ${list(theirs)}, and nobody of yours.`
      return `${who} ${inGame} of ${remaining} starters still to play.`
    },
    lineupLabel: 'Lineup check',
    lineupTitle: (n: number, name: string | null, slot: string) =>
      n > 1 ? `${n} starters will score nothing` : name ? `${name} will score nothing` : `Your ${slot} slot is empty`,
    lineupItem: (name: string | null, slot: string, reason: 'empty' | 'bye' | 'out') =>
      name == null || reason === 'empty'
        ? `${slot} is empty`
        : `${name} (${reason === 'bye' ? 'bye' : 'out'}) is in your ${slot} slot`,
    lineupFix: (n: number): string =>
      n === 1 ? 'That is a certain zero until the lineup changes.' : 'Each one is a certain zero until the lineup changes.',
    toWinLabel: 'To win',
    toWinNeed: (needed: number) => `${needed.toFixed(1)} more points`,
    toWinAhead: 'Already past their projection',
    toWinBody: (needed: number, theirProjected: number, yourScore: number, left: number, leftProjected: number | null) => {
      const head =
        needed > 0
          ? `That passes their projected final of ${theirProjected.toFixed(1)}.`
          : `Your ${yourScore.toFixed(1)} already beats their projected final of ${theirProjected.toFixed(1)}.`
      const tail =
        left === 0
          ? ' Everyone of yours has kicked off.'
          : leftProjected != null
            ? left === 1
              ? ` Your one still to play projects for ${leftProjected.toFixed(1)}.`
              : ` Your ${left} still to play project for ${leftProjected.toFixed(1)}.`
            : ''
      return head + tail
    },
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

    liveCount: (n) => `${n} en vivo`,
    scoreProj: (proj, value) => `${proj} ${value.toFixed(1)}`,

    chipLive: 'EN VIVO',
    chipFinal: 'FINAL',

    insightsLabel: 'De qué depende esta semana',
    swingLabel: 'Partido clave',
    swingOnNow: 'en juego',
    swingBody: (yours, theirs, inGame, remaining) => {
      const list = (names: string[]) =>
        names.length <= 3
          ? names.length === 1
            ? names[0]
            : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
          : `${names.slice(0, 3).join(', ')} y ${names.length - 3} más`
      const who =
        yours.length && theirs.length
          ? `${yours.length === 1 ? 'Tu' : 'Tus'} ${list(yours)} contra ${theirs.length === 1 ? 'su' : 'sus'} ${list(theirs)}.`
          : yours.length
            ? `${yours.length === 1 ? 'Tu' : 'Tus'} ${list(yours)}, y ninguno de los suyos.`
            : `${theirs.length === 1 ? 'Su' : 'Sus'} ${list(theirs)}, y ninguno de los tuyos.`
      return `${who} ${inGame} de los ${remaining} titulares que faltan por jugar.`
    },
    lineupLabel: 'Revisa tu alineación',
    lineupTitle: (n, name, slot) =>
      n > 1 ? `${n} titulares no sumarán puntos` : name ? `${name} no sumará puntos` : `Tu posición ${slot} está vacía`,
    lineupItem: (name, slot, reason) =>
      name == null || reason === 'empty'
        ? `${slot} está vacía`
        : `${name} (${reason === 'bye' ? 'descanso' : 'fuera'}) está en tu posición ${slot}`,
    lineupFix: (n) =>
      n === 1 ? 'Es un cero seguro hasta que cambie la alineación.' : 'Cada uno es un cero seguro hasta que cambie la alineación.',
    toWinLabel: 'Para ganar',
    toWinNeed: (needed) => `${needed.toFixed(1)} puntos más`,
    toWinAhead: 'Ya superas su proyección',
    toWinBody: (needed, theirProjected, yourScore, left, leftProjected) => {
      const head =
        needed > 0
          ? `Con eso superas su total proyectado de ${theirProjected.toFixed(1)}.`
          : `Tus ${yourScore.toFixed(1)} ya superan su total proyectado de ${theirProjected.toFixed(1)}.`
      const tail =
        left === 0
          ? ' Todos los tuyos ya empezaron a jugar.'
          : leftProjected != null
            ? left === 1
              ? ` Tu titular pendiente proyecta ${leftProjected.toFixed(1)}.`
              : ` Tus ${left} pendientes proyectan ${leftProjected.toFixed(1)}.`
            : ''
      return head + tail
    },
  },
})
