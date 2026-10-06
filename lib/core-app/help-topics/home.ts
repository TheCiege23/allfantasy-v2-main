import type { HelpTopic } from '../helpTopics'

/**
 * Terms on the /core home (Dashboard3A and its bands), Commissioner hub and overview, Format hubs,
 * Tools, Bracket. See ../helpTopics.ts; cite the code each claim rests on:
 *   gameDayRecord ............... lib/core-app/todayStrip.ts resolveRecord (claimed rosters only, ties skipped)
 *   bettingLine ................. todayStrip.ts ODDS_FRESH_MS 1h, ODDS_SHOW_MS 3h, spreadHome / totalPoints
 *   eliminationFormat ........... lib/core-app/weekBoard.ts isEliminationFormat (League.leagueType)
 *   sinceLastVisit .............. lib/core-app/sinceLastVisit.ts SESSION_GAP_MS 30m, MAX_WINDOW_MS 7d, tradesSince atLeast
 *   startersInDoubt ............. Dash3ATriage.tsx filter (tone 'bad' && startingIn > 0); dash34.ts isUnavailable →
 *                                 injuryStatus.ts isRuledOut; dash34.ts book sort (market rank, unranked last)
 *   participationTier ........... lib/decision-os/behavioral/manager-intelligence.ts computeParticipationTier,
 *                                 isInactive (MANAGER_INACTIVE_AFTER_DAYS 14); dashboard-intelligence.ts lookbackDays 90
 *   commissionerTiles ........... lib/core-app/commissionerHub.ts tiles (health 70/45, sync stale > 6h);
 *                                 commissioner/activity.ts ACTIVITY_STALE_AFTER_MS 2d, resolveMemberActivity;
 *                                 commissioner/healthScore.ts (low-confidence snapshot → not scored)
 *   faabBudgetsBar .............. lib/core-app/commissionerWaivers.ts FAAB_WARN_SHARE 0.5, FAAB_BAD_SHARE 0.2
 *   commissionerOverviewStats ... lib/core-app/commissionerOverview.ts stats (activity read for the shown cards only)
 *   activeManagers .............. commissionerOverview.ts `measured` tone (inactive·4 ≥ total → red)
 *   *HubMeter ................... lib/core-app/formatHubs.ts build{Zombie,Survivor,Guillotine,C2C,Efl}
 *   tokenCost ................... lib/core-app/toolsHub.ts costOf (isTokenPurchasableRule); ToolCard.leavesShell
 *   bracketBye .................. components/core-app/screens/BracketChallenge.tsx byeReason / SeedSlot reason;
 *                                 lib/brackets/sportShell.ts byeSeeds
 *
 *
 * The eight below were Dashboard3A's local `Help` (a CSS-hover `<span data-help>`), folded into the
 * shared InfoTip on 2026-10-03 and each re-checked against its loader. What changed, and why:
 *   readOnly .................... lib/league/write-authority.ts WRITE_BACK_CONNECTED_PLATFORMS (empty: imported
 *                                 = SHADOW, never propagated); lib/launch/launchTruth.ts externalWriteBack false.
 *                                 Was "never writes to your leagues" — untrue of a NATIVE league, so scoped to imports.
 *   yourWeekRoutine ............. lib/core-app/weeklyRoutine.ts routineDayFor (DEFAULT_TIME_ZONE America/New_York,
 *                                 Thu–Sat → lineups), buildWeeklyRoutine `done` rules; loadSeasonAdds (Sleeper only);
 *                                 startersInDoubt = the triage rule (tone 'bad' && startingIn > 0). Was "we saw it
 *                                 done": a lineup tick means no starter ruled out, and game day / recap never tick.
 *   outstandingIssues ........... lib/core-app/outstandingIssues.ts deriveOutstandingIssues (draft_upcoming, stale_sync;
 *                                 sort: dated first) + mergeDash34Issues (empty slot, starter out, live draft, Best Ball
 *                                 coverage; PREPENDED). Was "everything with a deadline … waiver runs, trade offers and
 *                                 votes": none of those three is detected (detectorsUnavailable), and stale rows have
 *                                 no deadline.
 *   homeCareer .................. lib/core-app/careerModel.ts buildCareerData (counted = finished seasons only; dedupe
 *                                 platform+season+name; seasonsPlayed = distinct seasons); level = getLevelFromXp of
 *                                 user_profiles.xp_total, lib/rank/careerXp.ts + rank-xp-constants.ts. Was "win rate,
 *                                 tenure, leagues" — those are PRESTIGE's inputs (careerPrestige), not XP's.
 *   homeRivalryRadar ............ lib/core-app/dash3aPanels.ts getRivalRecords (claimed team, isFinal weeks, all-zero
 *                                 pairing skipped, keyed on display name, sort losses then meetings, ties); Dashboard3A
 *                                 rivalRecord (W–L–T only with a tie, #2005).
 *   homeExposure ................ dash3aPanels.ts getCrossLeagueExposure (players + starters + reserve + taxi; one roster
 *                                 per league; `of` = rostersRead, foreign-id rosters included but emptied by
 *                                 rosterIdSpace.ts sleeperReadableRosters); ExposureImpact.tsx canExpand (count > 1).
 *                                 Was "four of four means every roster we could read" — M also counts rosters we
 *                                 cannot read.
 *   homeFollowing ............... lib/core-app/followingCard.ts getFollowingCard (status and next game NFL only;
 *                                 NEXT_GAME_DAYS 10; a stale or absent report is blank); PlayerCardSheet.tsx ☆.
 *   homeReceipts ................ lib/core-app/decisionReceipts.ts (isSleeper on every kind; MIN_WEEKS_FOR_RECEIPT 3,
 *                                 tooEarly/hasNoSignal; LINEUP_RECEIPT_WEEKS 3, computeWeeklyMaxPf); trade points are
 *                                 scored from stat lines with the league's settings (sleeperTradeGradeService.ts), not
 *                                 the platform's own totals. Was "all scored by your league's platform".
 *
 * ⚠ The Spanish quotes Dashboard3A's on-screen labels as the Spanish reader sees them. Dashboard3A was English-only
 * and these quoted "LVL" and "N of M" in English; since its cards became bilingual (2026-10-04,
 * lib/core-app/dashboard3aCopy.ts) they read «NIV» and «N de M». "W–L–T" is digits and dashes on the card in both
 * languages, so it is still quoted as written.
 *
 * The home's "League matchups" percentage reuses `matchupWinProbability` (rankings.ts): it is the
 * same `getMatchupData` forecast as the Matchup screen. Do not add a second topic for it.
 */
export const HOME_TOPICS = {
  gameDayRecord: {
    en: {
      title: 'Ahead and behind',
      body: 'How many of your matchups this week you lead and trail right now, from the scores we have stored. Only teams you’ve claimed count, and a tied matchup counts as neither.',
    },
    es: {
      title: 'Por delante y por detrás',
      body: 'Cuántos de tus enfrentamientos de esta semana vas ganando y perdiendo ahora mismo, según los marcadores que tenemos guardados. Solo cuentan los equipos que reclamaste, y un empate no cuenta para ninguno de los dos lados.',
    },
  },
  bettingLine: {
    en: {
      title: 'Betting lines',
      body: '“Favored by N” is the point spread and O/U is the total points line; Pick’em means neither team is favored. A line more than an hour old shows the time it was checked, and one more than three hours old isn’t shown.',
    },
    es: {
      title: 'Líneas de apuestas',
      body: '«Favorito por N» es el diferencial de puntos y «total del partido» es la línea de puntos totales; «parejo» significa que no hay favorito. Una línea de más de una hora muestra la hora en que se consultó, y una de más de tres horas no se muestra.',
    },
  },
  eliminationFormat: {
    en: {
      title: 'ELIM',
      body: 'ELIM marks a guillotine or survivor league — an elimination format, read from the format the league was set up with. In these leagues a week can cost more than a loss.',
    },
    es: {
      title: 'ELIM',
      body: 'ELIM marca una liga guillotina o survivor, un formato de eliminación, según el formato con el que se configuró la liga. En estas ligas una semana puede costar más que una derrota.',
    },
  },
  sinceLastVisit: {
    en: {
      title: 'Since your last visit',
      body: 'What changed since you last opened this page. Visits less than 30 minutes apart count as one, so reloading doesn’t reset it. It never covers more than 7 days — your first visit shows the last 7 — and “3+” means at least that many.',
    },
    es: {
      title: 'Desde tu última visita',
      body: 'Lo que cambió desde la última vez que abriste esta página. Las visitas con menos de 30 minutos de diferencia cuentan como una, así que recargar no la reinicia. Nunca abarca más de 7 días —tu primera visita muestra los últimos 7— y «3+» significa al menos esa cantidad.',
    },
  },
  startersInDoubt: {
    en: {
      title: 'Starters in doubt',
      body: 'Players in at least one of your starting lineups whose status rules them out: Out, IR or IL, PUP, NFI or a suspension. Questionable and Doubtful players aren’t listed. The most valuable come first; a player we hold no trade value for goes after every priced one.',
    },
    es: {
      title: 'Titulares en duda',
      body: 'Jugadores en al menos una de tus alineaciones titulares cuyo estado los descarta: Fuera, IR o IL, PUP, NFI o una suspensión. Los marcados como Dudoso o Poco probable no aparecen. Los más valiosos van primero; un jugador sin valor de cambio registrado va después de todos los que tienen precio.',
    },
  },
  participationTier: {
    en: {
      title: 'Activity tier',
      body: 'Elite, Active, Moderate, Passive or Inactive: how active you’ve been in this league over the last 90 days, from activity recorded in AllFantasy. It comes from an engagement score plus a few counts — Elite needs 3+ lineup saves and 2+ trade proposals or waiver claims, Active at least one lineup save. The warning sign shows after more than 14 days with nothing recorded.',
    },
    es: {
      title: 'Nivel de actividad',
      body: 'Élite, Activo, Moderado, Pasivo o Inactivo: qué tan activo has estado en esta liga en los últimos 90 días, según la actividad registrada en AllFantasy. Sale de una puntuación de participación más algunos conteos: Élite pide 3+ alineaciones guardadas y 2+ propuestas de cambio o reclamos, Activo al menos una alineación guardada. La señal de aviso aparece tras más de 14 días sin nada registrado.',
    },
  },
  commissionerTiles: {
    en: {
      title: 'League tiles',
      body: 'League health is green at 70 or more, amber from 45 and red below; it isn’t scored on thin data or for an imported league last synced over two days ago. Active managers counts those with a trade, waiver claim or roster move in the last 14 days. Claimed teams have an AllFantasy account linked. Sync reads Stale once the last import is over 6 hours old.',
    },
    es: {
      title: 'Indicadores de la liga',
      body: 'La salud de la liga es verde desde 70, ámbar desde 45 y roja por debajo; no se calcula con pocos datos ni en una liga importada sincronizada hace más de dos días. Managers activos cuenta a quienes hicieron un cambio, un reclamo o un movimiento de plantilla en los últimos 14 días. Los equipos reclamados tienen una cuenta de AllFantasy vinculada. Sync marca Stale cuando la última importación tiene más de 6 horas.',
    },
  },
  faabBudgetsBar: {
    en: {
      title: 'FAAB budgets',
      body: 'Each bar is the share of the season FAAB budget a team has left; spent is the budget minus what remains. Green means at least half is left, amber at least 20%, red less than that. Teams with the most left are listed first.',
    },
    es: {
      title: 'Presupuestos FAAB',
      body: 'Cada barra es la parte del presupuesto FAAB de la temporada que le queda a un equipo; lo gastado es el presupuesto menos lo que queda. Verde significa que queda al menos la mitad, ámbar al menos un 20 %, rojo menos que eso. Primero aparecen los equipos con más saldo.',
    },
  },
  commissionerOverviewStats: {
    en: {
      title: 'Across your leagues',
      body: '“Need a commissioner” counts every item in the queue below, across all the leagues you run. Managers inactive counts managers with no trade, waiver claim or roster move in 14 days, in the leagues shown as cards. A league needs a re-sync once its last import is more than two days old.',
    },
    es: {
      title: 'En todas tus ligas',
      body: '«Need a commissioner» cuenta cada elemento de la cola de abajo, en todas las ligas que diriges. Managers inactivos cuenta a quienes no hicieron ningún cambio, reclamo ni movimiento de plantilla en 14 días, en las ligas que se muestran como tarjetas. Una liga necesita resincronizarse cuando su última importación tiene más de dos días.',
    },
  },
  activeManagers: {
    en: {
      title: 'Active managers',
      body: 'How many of a league’s managers made a trade, waiver claim or roster move in the last 14 days. Green when nobody is inactive, red when a quarter or more are. It isn’t measured for a league that has never synced or was last synced more than two days ago.',
    },
    es: {
      title: 'Managers activos',
      body: 'Cuántos managers de una liga hicieron un cambio, un reclamo o un movimiento de plantilla en los últimos 14 días. Verde si no hay nadie inactivo, rojo si lo está una cuarta parte o más. No se mide en una liga que nunca se sincronizó o cuya última sincronización tiene más de dos días.',
    },
  },
  zombieHubMeter: {
    en: {
      title: 'Infection spread',
      body: 'The share of a league’s teams that are zombies. Green below a third, amber below two thirds, red above that. A league whose zombie teams aren’t set up yet shows no bar.',
    },
    es: {
      title: 'Propagación de la infección',
      body: 'La parte de los equipos de una liga que son zombis. Verde por debajo de un tercio, ámbar por debajo de dos tercios y rojo por encima. Una liga cuyos equipos zombi aún no están configurados no muestra barra.',
    },
  },
  survivorHubMeter: {
    en: {
      title: 'Still in the game',
      body: 'Players still active in the game, out of the league’s team count, from the league’s Survivor game state. Anyone on Exile Island is noted under the bar. No bar until the game has started.',
    },
    es: {
      title: 'Siguen en el juego',
      body: 'Jugadores que siguen activos en el juego, sobre el número de equipos de la liga, según el estado del juego Survivor de la liga. Quien esté en Exile Island se indica debajo de la barra. No hay barra hasta que empieza el juego.',
    },
  },
  guillotineHubMeter: {
    en: {
      title: 'Field remaining',
      body: 'Teams not yet chopped, out of the league’s size. “Final stretch” means two or fewer are left.',
    },
    es: {
      title: 'Equipos restantes',
      body: 'Equipos que aún no han sido eliminados, sobre el tamaño de la liga. «Final stretch» significa que quedan dos o menos.',
    },
  },
  c2cHubMeter: {
    en: {
      title: 'Sync freshness',
      body: 'How recently AllFantasy read this league: full right after a sync, empty at 72 hours. Amber after 24 hours, red after 72 hours or when the last sync failed.',
    },
    es: {
      title: 'Frescura de la sincronización',
      body: 'Hace cuánto AllFantasy leyó esta liga: llena justo después de sincronizar y vacía a las 72 horas. Ámbar tras 24 horas, roja tras 72 horas o si la última sincronización falló.',
    },
  },
  eflHubMeter: {
    en: {
      title: 'Your standing',
      body: 'Your current rank in the league, drawn so first place fills the bar. Green in about the top third, amber in the middle, red near the bottom.',
    },
    es: {
      title: 'Tu posición',
      body: 'Tu puesto actual en la liga, dibujado para que el primer lugar llene la barra. Verde aproximadamente en el tercio superior, ámbar en el medio y rojo cerca del fondo.',
    },
  },
  tokenCost: {
    en: {
      title: 'Token prices',
      body: 'A number on a card is how many tokens one run of that tool costs, shown before you open it. Only tools that sell a run for tokens show one. ↗ means the tool opens its full page.',
    },
    es: {
      title: 'Precios en tokens',
      body: 'Un número en una tarjeta indica cuántos tokens cuesta usar esa herramienta una vez, y se muestra antes de abrirla. Solo lo llevan las herramientas que venden un uso por tokens. ↗ significa que la herramienta abre su página completa.',
    },
  },
  bracketBye: {
    en: {
      title: 'Byes',
      body: 'Seeds in this column sit out the first round, so their opponent shows as “?” until that round is played — it is never filled in ahead of time. A “?” anywhere else means seeding isn’t published yet or that game’s winner isn’t decided.',
    },
    es: {
      title: 'Byes',
      body: 'Las cabezas de serie de esta columna no juegan la primera ronda, así que su rival aparece como «?» hasta que se juega esa ronda; nunca se completa por adelantado. Un «?» en cualquier otro lugar significa que la siembra aún no se publicó o que el ganador de ese partido no está decidido.',
    },
  },
  readOnly: {
    en: {
      title: 'Read-only',
      body: 'AllFantasy never writes to a league you imported. Nothing you do here reaches Sleeper, ESPN, Yahoo or any other platform: we read your rosters and tell you what to do, and every real change happens on the platform itself. Leagues hosted on AllFantasy are the exception — they live here.',
    },
    es: {
      title: 'Solo lectura',
      body: 'AllFantasy nunca escribe en una liga que importaste. Nada de lo que hagas aquí llega a Sleeper, ESPN, Yahoo ni a ninguna otra plataforma: leemos tus plantillas y te decimos qué hacer, y todo cambio real se hace en la propia plataforma. Las ligas alojadas en AllFantasy son la excepción: viven aquí.',
    },
  },
  yourWeekRoutine: {
    en: {
      title: 'Your week',
      body: 'A fantasy week in five steps, by the day in US Eastern: results Tuesday, waivers Wednesday, lineups Thursday to Saturday, game day Sunday and the recap Monday. A check mark is set only from data — results once your last played week is scored, waivers once you’ve made an add this week in a Sleeper league, lineups when none of your starters is ruled out. Game day and the recap never get one.',
    },
    es: {
      title: 'Tu semana',
      body: 'Una semana de fantasy en cinco pasos, según el día en la hora del Este de EE. UU.: resultados el martes, waivers el miércoles, alineaciones de jueves a sábado, día de partido el domingo y el resumen el lunes. La marca de verificación solo sale de los datos: resultados cuando tu última semana jugada tiene marcadores, waivers cuando hiciste una incorporación esta semana en una liga de Sleeper, y alineaciones cuando ninguno de tus titulares está descartado. El día de partido y el resumen nunca la llevan.',
    },
  },
  outstandingIssues: {
    en: {
      title: 'Outstanding issues',
      body: 'What needs you across your leagues: a draft coming up or already live, an empty starting slot, a starter ruled out, a Best Ball roster that can’t cover a position, and leagues whose data has gone stale. Problems already happening come first, then upcoming drafts by date, then stale leagues. Waiver claims, trade offers and votes aren’t checked here.',
    },
    es: {
      title: 'Asuntos pendientes',
      body: 'Lo que necesita tu atención en tus ligas: un draft que se acerca o que ya está en marcha, un puesto titular vacío, un titular descartado, una plantilla de Best Ball que no cubre una posición y las ligas cuyos datos están desactualizados. Primero van los problemas que ya están ocurriendo, luego los drafts próximos por fecha y al final las ligas desactualizadas. Aquí no se revisan reclamos, ofertas de intercambio ni votaciones.',
    },
  },
  homeCareer: {
    en: {
      title: 'Your career',
      body: 'Titles and seasons count the finished seasons of every league imported to your account, each league-season once even if it came in through more than one import; a season still being played isn’t counted yet. Your level comes from XP: 10 per win, 30 per playoff berth, 200 per title, 10 per distinct season, plus 2 per team above 10 in each league. Losses never take XP away.',
    },
    es: {
      title: 'Tu carrera',
      body: 'Los títulos y las temporadas cuentan las temporadas terminadas de todas las ligas importadas a tu cuenta, cada temporada de liga una sola vez aunque haya llegado por más de una importación; una temporada que aún se está jugando no cuenta todavía. Tu nivel («NIV») sale de la XP: 10 por victoria, 30 por clasificación a playoffs, 200 por título, 10 por cada temporada distinta, más 2 por cada equipo por encima de 10 en cada liga. Las derrotas nunca restan XP.',
    },
  },
  homeRivalryRadar: {
    en: {
      title: 'Rivalry Radar',
      body: 'Who actually beats you: your record against each manager over every finished, scored week stored for leagues where you’ve claimed a team, with the same display name in several leagues counted as one manager. Ranked by how often they’ve beaten you; the number of meetings only breaks a tie. A meeting that finished level is a tie, never a loss, and the record shows W–L–T only when there is one.',
    },
    es: {
      title: 'Radar de rivales',
      body: 'Quién te gana de verdad: tu récord contra cada manager en todas las semanas terminadas y con marcador que tenemos de las ligas donde reclamaste un equipo; el mismo nombre visible en varias ligas cuenta como un solo manager. Se ordena por cuántas veces te han ganado, y el número de enfrentamientos solo desempata. Un enfrentamiento que terminó igualado es un empate, nunca una derrota, y el récord se muestra como «W–L–T» solo cuando hay alguno.',
    },
  },
  homeExposure: {
    en: {
      title: 'Portfolio & exposure',
      body: 'The players on the most of your rosters — bench, reserve and taxi count as well as starters — read from the rosters imported for teams you’ve claimed. “N of M” counts one roster per league, and M includes leagues whose player ids we can’t match yet, where nobody is counted, so while one is connected no player reads M of M. Tap a player on two or more rosters to see what happens if he sits.',
    },
    es: {
      title: 'Cartera y exposición',
      body: 'Los jugadores que están en más de tus plantillas —el banquillo, la reserva y el taxi cuentan igual que los titulares—, leídos de las plantillas importadas de los equipos que reclamaste. «N de M» cuenta una plantilla por liga, y M incluye las ligas cuyos ids de jugador aún no podemos emparejar, donde no se cuenta a nadie; así que mientras haya una conectada ningún jugador llega a «M de M». Toca un jugador que esté en dos o más plantillas para ver qué pasa si no juega.',
    },
  },
  homeFollowing: {
    en: {
      title: 'Following',
      body: 'Players you follow, from the ☆ on any player card. Status is his latest reported designation — a blank means nothing is reported, not that he’s healthy — and next game is his next fixture on file in the coming 10 days. Both are shown for NFL players only.',
    },
    es: {
      title: 'Seguidos',
      body: 'Los jugadores que sigues, desde la ☆ de cualquier ficha de jugador. El estado es su última designación reportada —un espacio en blanco significa que no hay nada reportado, no que esté sano— y el próximo partido es el siguiente que tenemos registrado en los próximos 10 días. Ambos se muestran solo para jugadores de la NFL.',
    },
  },
  homeReceipts: {
    en: {
      title: 'Receipts',
      body: 'How your moves in Sleeper leagues turned out, in points under your league’s scoring. Trades: what you got minus what you gave, counted only while each player stayed on your roster. Waiver adds: what he scored on your roster after the add. Lineups: the best legal lineup you could have started minus what your starters scored, over the last three finished weeks. Start/sit calls from AutoCoach and Chimmy are checked against what both players scored. A trade or add under three weeks old waits until it has a result.',
    },
    es: {
      title: 'Resultados de tus decisiones',
      body: 'Cómo salieron tus movimientos en ligas de Sleeper, en puntos según la puntuación de tu liga. Intercambios: lo que recibiste menos lo que diste, contando solo mientras cada jugador siguió en tu plantilla. Incorporaciones de waivers: lo que anotó en tu plantilla después de incorporarlo. Alineaciones: la mejor alineación válida que podías poner menos lo que anotaron tus titulares, en las tres últimas semanas terminadas. Las recomendaciones de titular o banquillo de AutoCoach y Chimmy se comparan con lo que anotaron ambos jugadores. Un intercambio o una incorporación de menos de tres semanas espera hasta tener un resultado.',
    },
  },
} satisfies Record<string, HelpTopic>
