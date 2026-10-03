import type { HelpTopic } from '../helpTopics'

/**
 * Terms on War Room and Draft (DraftBoard, DraftHq, DraftCompetitiveEdge, DraftHqBoard, WarRoomWeek, ConnectedFranchiseWarRoom, PickALeague). See ../helpTopics.ts; cite the code each claim rests on.
 *
 *   The AF sentence in draftBoardOrder / draftedPlayers / recordedDraftBoard ... lib/core-app/draftAfProjections.ts
 *                            (af = latestProjectionWeek's engine number via afEngineForLeague; rosterIdSpaceOf(platform)
 *                            !== 'sleeper' → none: Sleeper + native only). One tip per section, so it is merged in.
 *   draftBoardOrder ........ lib/core-app/draftHq.ts getSlotInRoundForOverall (snake / linear / third-round reversal),
 *                            resolvePickOwner; the board keeps a traded pick in its original column
 *   onTheClock ............. lib/core-app/draftBoard.ts clock (endsAt null while paused, pausedRemainingSeconds; no
 *                            stored timer → no countdown)
 *   draftFormat / draftSlot / pickOwnership ... lib/core-app/draftHq.ts computePickInventory (held + acquiredFrom,
 *                            tradedAway); pickSlots unavailable unless snake or linear; yourSlot = slotOrder entry
 *   draftCardStats / draftHqScope ... lib/core-app/draftHqAll.ts (latestDraftsByLeague; PHASE_RANK live, upcoming,
 *                            unknown, done) and components/core-app/boards/DraftHqBoard.tsx
 *   The texts of these last six were first written for a separate Radix "?" (ContextHelp, bd310f591) and are kept
 *   here, checked against the code above, so /core has one explainer control. Two of its claims were dropped as
 *   unverified or describing plans ("incomplete trade coverage", "archive selection is planned"), and its Best
 *   available / Your queue tips with them: both sections are always unavailable and already say why.
 *   draftGrades ............ lib/draft-intel/gradeDraftPicks.ts letterFor (≥25 A, ≥10 B, >−10 C, >−25 D), median per
 *                            round, picks with no points left out, trend ±3 per pick; draftHq.ts TeamDraftGrade
 *   draftLottery ........... lib/core-app/draftHq.ts loadLottery (dynasty, second season on, weighted_lottery);
 *                            WeightedDraftLotteryEngine.previewLotteryOdds (no draw); standingsForLottery.computeWeight
 *   keepers ................ lib/core-app/draftHq.ts keeperSelections (declared, roundCost) / loadImportedKeepers
 *                            (Sleeper is_keeper on your latest imported draft)
 *   competitiveEdgeDraft ... lib/competitive-edge/draftEdge.ts DRAFT_FLOOR 2, EARLY_ROUNDS 3, ownerSleeperId per season
 *   warRoomWeekMargins ..... components/core-app/screens/WarRoomWeek.tsx marginOf + sort; railMatchups.ts source
 *   eliminationCutLine ..... lib/core-app/railMatchups.ts standingIn (mostHavePlayed, afProjected ?? projected),
 *                            choppedBefore + the live field filter
 *   connectedFranchise ..... lib/core-app/leaguePairing.ts (stale > 24h or no sync time; Fantrax = stored snapshot);
 *                            move counts = getLeagueActivity counts (deduped events, newest ≤ 60 rows, countWindow)
 *   needsYouFirst .......... lib/core-app/outstandingIssues.ts deriveOutstandingIssues (stale_sync, draft_upcoming;
 *                            ≤ 24h → 'bad', "Draft today")
 *
 * ⚠ WarRoomWeek, ConnectedFranchiseWarRoom and PickALeague are English-only screens, so the Spanish text quotes
 * their on-screen labels ("Last import", "at the cut", "Refresh recommended") in English, as the reader sees them.
 */
export const DRAFT_TOPICS = {
  draftBoardOrder: {
    en: {
      title: 'The board',
      body: 'Columns stay in the original draft order, and pick numbers follow this draft’s snake, linear or third-round-reversal order. A traded pick stays in its original column and names the team that made it. AF is AllFantasy’s own projection for the player, scored with your league’s rules — for the current week, not what he was worth when he was picked — and appears only in Sleeper leagues and leagues hosted on AllFantasy.',
    },
    es: {
      title: 'El tablero',
      body: 'Las columnas mantienen el orden original del draft, y los números de pick siguen el orden de este draft: serpiente, lineal o con inversión en la tercera ronda. Un pick traspasado se queda en su columna original e indica el equipo que lo hizo. AF es la proyección propia de AllFantasy para el jugador, calculada con las reglas de tu liga —la de la semana actual, no lo que valía cuando lo eligieron— y solo aparece en ligas de Sleeper y en ligas alojadas en AllFantasy.',
    },
  },
  onTheClock: {
    en: {
      title: 'On the clock',
      body: 'The team whose pick is up, worked out from the draft order and the recorded pick trades. The countdown is the time left on the current pick, read from the draft’s stored timer — never a default pick length. A paused draft shows the time it had left, without counting down.',
    },
    es: {
      title: 'En el reloj',
      body: 'El equipo al que le toca elegir, según el orden del draft y los traspasos de picks registrados. La cuenta atrás es el tiempo que queda para el pick actual, leído del temporizador guardado del draft, nunca una duración por defecto. Un draft en pausa muestra el tiempo que le quedaba, sin descontar.',
    },
  },
  draftFormat: {
    en: {
      title: 'Draft format',
      body: 'Snake reverses the pick order every round; linear keeps the same order every round; third-round reversal runs round three in the same direction as round two. Auction drafts pick by bidding, so they have no fixed pick slots and the list of your picks is not shown.',
    },
    es: {
      title: 'Formato del draft',
      body: 'En serpiente el orden se invierte cada ronda; en lineal se repite el mismo orden; con inversión en la tercera ronda, la ronda tres va en la misma dirección que la dos. En subasta se elige pujando, así que no hay picks fijos y no se muestra la lista de tus picks.',
    },
  },
  draftSlot: {
    en: {
      title: 'Your slot',
      body: 'Your original position in the draft order. Trading picks changes who owns a selection, never this original slot.',
    },
    es: {
      title: 'Tu posición',
      body: 'Tu posición original en el orden del draft. Traspasar picks cambia quién es dueño de una selección, nunca esta posición original.',
    },
  },
  pickOwnership: {
    en: {
      title: 'Your picks',
      body: 'The picks you hold in this draft, worked out from your original slot and the recorded pick trades; a pick you acquired names the team it came from. Picks you traded away stay listed with the team that holds them now. Shown for snake and linear drafts only.',
    },
    es: {
      title: 'Tus picks',
      body: 'Los picks que tienes en este draft, calculados a partir de tu posición original y los traspasos de picks registrados; un pick que adquiriste indica de qué equipo vino. Los picks que traspasaste siguen en la lista con el equipo que los tiene ahora. Solo se muestra en drafts en serpiente y lineales.',
    },
  },
  draftedPlayers: {
    en: {
      title: 'What you drafted',
      body: 'The selections recorded for your team in this draft. A later trade can change today’s roster without changing this record. AF is AllFantasy’s own projection for the player, scored with your league’s rules — for the current week, not what he was worth when he was picked — and appears only in Sleeper leagues and leagues hosted on AllFantasy.',
    },
    es: {
      title: 'Lo que elegiste',
      body: 'Las selecciones registradas para tu equipo en este draft. Un traspaso posterior puede cambiar tu plantilla actual sin cambiar este registro. AF es la proyección propia de AllFantasy para el jugador, calculada con las reglas de tu liga —la de la semana actual, no lo que valía cuando lo eligieron— y solo aparece en ligas de Sleeper y en ligas alojadas en AllFantasy.',
    },
  },
  recordedDraftBoard: {
    en: {
      title: 'Draft board',
      body: 'Every recorded selection in this draft, round by round. AF is AllFantasy’s own projection for the player, scored with your league’s rules — for the current week, not what he was worth when he was picked — and appears only in Sleeper leagues and leagues hosted on AllFantasy.',
    },
    es: {
      title: 'Tablero del draft',
      body: 'Todas las selecciones registradas en este draft, ronda por ronda. AF es la proyección propia de AllFantasy para el jugador, calculada con las reglas de tu liga —la de la semana actual, no lo que valía cuando lo eligieron— y solo aparece en ligas de Sleeper y en ligas alojadas en AllFantasy.',
    },
  },
  draftCardStats: {
    en: {
      title: 'Draft card',
      body: 'Your slot is your original position in the order. Picks made counts every team’s recorded selections. The round and who is on the clock follow the stored next-pick position and the recorded pick trades. Queued here counts the targets saved in AllFantasy, which may differ from your host platform’s queue. A paused draft has no running countdown.',
    },
    es: {
      title: 'Tarjeta del draft',
      body: 'Tu posición es tu lugar original en el orden. Los picks hechos cuentan las selecciones registradas de todos los equipos. La ronda y quién está en el reloj siguen la posición del siguiente pick guardada y los traspasos de picks registrados. En cola aquí cuenta los objetivos guardados en AllFantasy, que pueden no coincidir con la cola de tu plataforma. Un draft en pausa no tiene cuenta atrás.',
    },
  },
  draftHqScope: {
    en: {
      title: 'Latest draft per league',
      body: 'The newest stored draft for each league — the same one its link opens. Live drafts come first, then upcoming ones, then finished ones.',
    },
    es: {
      title: 'Último draft por liga',
      body: 'El draft guardado más reciente de cada liga, el mismo que abre su enlace. Primero los drafts en vivo, luego los próximos y después los terminados.',
    },
  },
  draftGrades: {
    en: {
      title: 'Draft grades',
      body: 'Each pick scores its points minus the median of every pick in the same round. A team’s letter is its average per graded pick: A is +25 or more, B +10 or more, C above −10, D above −25, F below that. Picks with no points are left out. An arrow means the grade moved by more than 3 points per pick between draft-year points and points scored since; in redraft the two are the same. It is a results grade, not a draft-day forecast.',
    },
    es: {
      title: 'Calificaciones del draft',
      body: 'Cada selección vale sus puntos menos la mediana de todas las selecciones de la misma ronda. La letra de un equipo es su promedio por selección calificada: A desde +25, B desde +10, C por encima de −10, D por encima de −25 y F por debajo. Las selecciones sin puntos quedan fuera. Una flecha indica que la nota cambió más de 3 puntos por selección entre los puntos del año del draft y los anotados desde entonces; en redraft son los mismos. Es una nota de resultados, no un pronóstico del día del draft.',
    },
  },
  draftLottery: {
    en: {
      title: 'Weighted lottery',
      body: 'Shown only for a dynasty league past its first season whose draft order is set by a weighted lottery. The odds are a preview from the league’s lottery settings and current standings — nothing is drawn here. With the default settings, a worse record means better odds.',
    },
    es: {
      title: 'Sorteo ponderado',
      body: 'Solo aparece en una liga dynasty que ya pasó su primera temporada y cuyo orden de draft se decide con un sorteo ponderado. Las probabilidades son una vista previa según la configuración del sorteo y la clasificación actual: aquí no se sortea nada. Con la configuración por defecto, un peor récord da mejores probabilidades.',
    },
  },
  keepers: {
    en: {
      title: 'Keepers',
      body: 'Players a team holds on to instead of putting them back into the draft. “Rd N” is the round of the pick each one uses up. For a draft run on AllFantasy these are the keepers you declared; otherwise they are the picks Sleeper flagged as keepers in your last draft.',
    },
    es: {
      title: 'Jugadores conservados',
      body: 'Jugadores que un equipo conserva en lugar de devolverlos al draft. «Rda. N» es la ronda de la selección que consume cada uno. En un draft de AllFantasy son los que declaraste; si no, son las selecciones que Sleeper marcó como conservadas en tu último draft.',
    },
  },
  competitiveEdgeDraft: {
    en: {
      title: 'How the others draft',
      body: 'Counted from this league’s past Sleeper drafts, with each pick credited to whoever owned that team that season. A manager’s patterns show only once they have picked in at least 2 drafts; before that you see just their pick count. “Early” means rounds 1–3.',
    },
    es: {
      title: 'Cómo eligen los demás',
      body: 'Se cuenta a partir de los drafts de Sleeper anteriores de esta liga, y cada selección se asigna a quien tenía ese equipo esa temporada. Los patrones de un mánager solo aparecen cuando ha elegido en al menos 2 drafts; antes solo ves cuántas selecciones hizo. «Temprano» significa las rondas 1 a 3.',
    },
  },
  warRoomWeekMargins: {
    en: {
      title: 'Ahead and behind',
      body: 'The matchup you are losing by the most comes first. The margin is the score once games are played; before that it is AllFantasy’s lineup projection, or the projection feed scored with your league’s rules when AF has none. So “ahead in X, behind in Y” can include games that have not started. “Last import” means the score comes from imported history, not the live feed.',
    },
    es: {
      title: 'Por delante y por detrás',
      body: 'Primero aparece el enfrentamiento que pierdes por más. El margen es el marcador cuando ya se jugó; antes, es la proyección de alineación de AllFantasy, o la del proveedor de proyecciones con las reglas de tu liga si AF no tiene una. Por eso «ahead in X, behind in Y» puede incluir partidos que no han empezado. «Last import» significa que el marcador viene del historial importado, no de los datos en vivo.',
    },
  },
  eliminationCutLine: {
    en: {
      title: 'The cut line',
      body: 'An elimination week has no opponent: you are ranked against every team still alive, and the lowest score is the cut. “Over the cut” is your total minus that lowest one; if you are the lowest or tied for it, it reads “at the cut”. Until more than half the teams have points, the rank uses pre-game projections from the projection feed, not AllFantasy’s engine, and says “(projected)”. Teams chopped in earlier weeks are left out.',
    },
    es: {
      title: 'La línea de corte',
      body: 'Una semana de eliminación no tiene rival: se te clasifica contra todos los equipos que siguen vivos y la puntuación más baja es el corte. «Over the cut» es tu total menos ese más bajo; si tienes el más bajo o empatas en él, dice «at the cut». Hasta que más de la mitad de los equipos tenga puntos, la posición usa las proyecciones previas del proveedor, no el motor de AllFantasy, y lo indica con «(projected)». Los equipos eliminados en semanas anteriores quedan fuera.',
    },
  },
  connectedFranchise: {
    en: {
      title: 'Connected franchise',
      body: 'Links leagues you play as one team — for example a pro league and a college league — so their rosters and drafts sit on one screen. “Refresh recommended” means a league has not synced in the last 24 hours, or has no sync time on file. A Fantrax league is a stored snapshot: re-import it to refresh. “Recent league moves” counts every manager’s trades, waivers and adds from each league’s newest transactions on file, one per trade — not a season total; a “+” means older moves were not counted.',
    },
    es: {
      title: 'Franquicia conectada',
      body: 'Une ligas que juegas como un solo equipo, por ejemplo una liga profesional y una universitaria, para ver sus plantillas y drafts en una sola pantalla. «Refresh recommended» significa que una liga no se ha sincronizado en las últimas 24 horas o no tiene hora de sincronización registrada. Una liga de Fantrax es una copia guardada: vuelve a importarla para actualizarla. «Recent league moves» cuenta los intercambios, waivers y altas de todos los mánagers a partir de las transacciones más recientes de cada liga, una por intercambio; no es el total de la temporada, y un «+» indica que hay movimientos anteriores sin contar.',
    },
  },
  needsYouFirst: {
    en: {
      title: 'Needs you first',
      body: 'This list checks two things only: leagues whose synced data has gone stale, and drafts with a date still to come. A draft within 24 hours shows as “Draft today” and is marked urgent. Lineup, injury and trade problems are not checked here.',
    },
    es: {
      title: 'Necesita tu atención',
      body: 'Esta lista solo revisa dos cosas: ligas cuyos datos sincronizados están desactualizados y drafts con fecha que aún no han llegado. Un draft en las próximas 24 horas aparece como «Draft today» y se marca como urgente. Aquí no se revisan problemas de alineación, lesiones ni intercambios.',
    },
  },
} satisfies Record<string, HelpTopic>
