import type { HelpTopic } from '../helpTopics'

/**
 * Terms on Career, League career, Career share, Devy, Scout, Player Finder. See ../helpTopics.ts; cite the code each claim rests on.
 *
 *   careerPrestige .............. lib/core-app/prestige.ts PRESTIGE_SPEC + computePrestige; inputs careerModel.ts (seasonsPlayed = distinct seasons)
 *   careerLegacy ................ lib/core-app/careerModel.ts LEGACY_SPEC, consistencyScore, dynastyScore, the legacy block in buildCareer
 *   careerXp .................... lib/rank/careerXp.ts + rank-xp-constants.ts; levels lib/rank/levels.ts RANK_LEVELS (25)
 *   careerFinals ................ lib/core-app/careerFinals.ts summarizeFinals
 *   leagueSeason ................ careerModel.ts leaguesPlayed (counted rows only; live rows go to activeLeagues)
 *   careerWireSync .............. careerWireModel.ts leagueWireStatus, buildPlatformHealth (worst league); CareerWire.tsx STATUS_TEXT
 *   careerPeersIndex ............ careerPeers.ts vsLeagues; rankingsEngine.ts SCORING_PRIOR_GAMES 14
 *   careerTradeGrade ............ leagueCareer.ts gradeTrades (÷ seasonsScanned); trade-intel/gradeScale.ts letterFor;
 *                                 sleeperTradeGradeService.ts seasonNets (credited only while held, resolved picks)
 *   tradeJourney ................ leagueCareer.ts trade story (running cumulativeNet, best/worst by net)
 *   wrappedRecap ................ app/api/league/wrapped/route.ts (standings, best trade by valueDifferential, outlook bands)
 *   devy / devyGrade ............ lib/devy-intel.ts DEVY_SIGNAL_WEIGHTS + computeDevyProjection; lib/core-app/devy.ts (ordered on draftProjectionScore)
 *   devyExposure ................ lib/core-app/devy.ts exposure + dash3aPanels.ts getCrossLeagueExposure
 *   devySlots / devyDraftBoard .. lib/core-app/devyLeagueTab.ts (DevyRights, DEVY_TAB_COPY, devyAdp board)
 *   devyTrend ................... lib/devy/devyTrend.ts devyTrendOf (always null today)
 *   scoutCardLegend ............. standingsModel.ts computeZones + powerBasis; scout.ts ScoutStanding; Scout.tsx Form
 *   competitiveEdge ............. lib/competitive-edge/scoutEdgeLoader.ts; Scout.tsx EdgeLine (not on your own card)
 *   scoutEliminationStanding .... lib/core-app/railMatchups.ts standingIn, mostHavePlayed; field excludes chopped teams
 *   leagueTableColumns .......... playerImpact.ts afPoints; afEngineCarry.ts; playerDepth.ts loadLeagueValueMap; marketValueService.ts playerValueForLeague
 *   leagueStripLegend ........... components/core-app/player-finder/LeagueStrip.tsx; lib/core-app/leagueStrip.ts
 *   faabBid ..................... lib/core-app/freeAgentBids.ts (faabBidFor, 60% cap, percentile_cont 0.5 / 0.75)
 *   nextGameMarket .............. PlayerNextGames.tsx marketLine; gameOddsReads.ts TeamMarketContext; matchupOutlook.ts thirds
 *   playerShares ................ lib/core-app/playerShares.ts; playerSharesRank.ts countShares
 */
export const CAREER_TOPICS = {
  careerPrestige: {
    en: {
      title: 'GM prestige',
      body: 'A 0–100 score from five capped parts: championships 30% (full at 10), win rate 20% (a .500 record earns half), seasons played 20% (full at 20), completed league-seasons 15% (full at 15) and playoff berths 15% (full at 30). A part at its cap shows MAXED, so one huge number can’t carry the score.',
    },
    es: {
      title: 'Prestigio de GM',
      body: 'Una puntuación de 0 a 100 con cinco partes con tope: campeonatos 30% (completo con 10), % de victorias 20% (un récord de .500 da la mitad), temporadas jugadas 20% (completo con 20), temporadas de liga terminadas 15% (completo con 15) y clasificaciones a playoffs 15% (completo con 30). Una parte en su tope aparece como MAXED, así que un solo número enorme no puede cargar la puntuación.',
    },
  },
  careerLegacy: {
    en: {
      title: 'Legacy score',
      body: 'Four parts, each scored 0–100: Championship (titles, full at 10), Playoff (berths per completed league-season), Consistency (how steady your win rate is from season to season; needs two seasons) and Dynasty (titles and playoff runs per league-season, against what each league’s size makes likely). Their weights of 28, 20, 18 and 12 are re-scaled to 100% across the parts that can be scored, so a part that can’t be measured doesn’t drag the total down.',
    },
    es: {
      title: 'Puntuación de legado',
      body: 'Cuatro partes, cada una de 0 a 100: Campeonato (títulos, completo con 10), Playoffs (clasificaciones por temporada de liga terminada), Consistencia (qué tan estable es tu % de victorias de una temporada a otra; necesita dos temporadas) y Dinastía (títulos y llegadas a playoffs por temporada de liga, frente a lo que el tamaño de cada liga hace probable). Sus pesos de 28, 20, 18 y 12 se reescalan al 100% entre las partes que se pueden puntuar, así que una parte que no se puede medir no hunde el total.',
    },
  },
  careerXp: {
    en: {
      title: 'XP and AF rank',
      body: 'XP comes from your league history: 10 per win, 30 per playoff berth, 200 per title, 10 per distinct season, plus 2 per team above 10 in each league. Losses never take XP away. Your level, 1 to 25, is set by how much XP you have.',
    },
    es: {
      title: 'XP y rango AF',
      body: 'La XP sale de tu historial de ligas: 10 por victoria, 30 por clasificación a playoffs, 200 por título, 10 por cada temporada distinta, más 2 por cada equipo por encima de 10 en cada liga. Las derrotas nunca restan XP. Tu nivel, del 1 al 25, depende de cuánta XP tienes.',
    },
  },
  careerFinals: {
    en: {
      title: 'Finals',
      body: 'Title games you played: championships won plus finals lost. A lost final can only be read from a stored Sleeper playoff bracket — other platforms store just the champion — so a final lost in a season without one isn’t counted. With no bracket at all, Finals shows as not recorded.',
    },
    es: {
      title: 'Finales',
      body: 'Partidos por el título que jugaste: campeonatos ganados más finales perdidas. Una final perdida solo se puede leer de un cuadro de playoffs de Sleeper guardado —las demás plataformas solo guardan al campeón—, así que una final perdida en una temporada sin cuadro no se cuenta. Sin ningún cuadro, Finales aparece como no registrado.',
    },
  },
  leagueSeason: {
    en: {
      title: 'League-season',
      body: 'One league played for one season, so a dynasty league that has run six years counts as six. Only finished league-seasons count toward your career totals; a league still being played stays out until it ends.',
    },
    es: {
      title: 'Temporada de liga',
      body: 'Una liga jugada durante una temporada, así que una liga dinastía que lleva seis años cuenta como seis. Solo las temporadas de liga terminadas cuentan para los totales de tu carrera; una liga que todavía se está jugando queda fuera hasta que termine.',
    },
  },
  careerWireSync: {
    en: {
      title: 'Platform sync',
      body: 'Each platform’s dot shows when AllFantasy last read your leagues there — our read time, not when the platform last changed anything. Delayed or needs attention means that read is older than expected for this point in the season, or the last attempt failed; a platform shows its worst league. Leagues run on AllFantasy are live and need no sync.',
    },
    es: {
      title: 'Sincronización por plataforma',
      body: 'El punto de cada plataforma indica cuándo AllFantasy leyó por última vez tus ligas allí: es nuestra hora de lectura, no cuándo la plataforma cambió algo. Retrasado o requiere atención significa que esa lectura es más antigua de lo esperado para este momento de la temporada, o que el último intento falló; cada plataforma muestra su peor liga. Las ligas que se juegan en AllFantasy están en vivo y no necesitan sincronizarse.',
    },
  },
  careerPeersIndex: {
    en: {
      title: 'You vs your leagues',
      body: 'League expectation is what an average manager in the same leagues would have: a .500 win rate, one title in N for an N-team league, and playoff berths at each league’s own cut. Points per game compares you with every team in those league-seasons. Scoring index is your points per game against the average AllFantasy team in the same format, blended with 14 games at 100 — so 100 is average.',
    },
    es: {
      title: 'Tú frente a tus ligas',
      body: 'Lo esperado en la liga es lo que tendría un manager promedio en esas mismas ligas: un % de victorias de .500, un título de cada N en una liga de N equipos y clasificaciones a playoffs según el corte de cada liga. Los puntos por partido te comparan con todos los equipos de esas temporadas de liga. El índice de anotación compara tus puntos por partido con el equipo promedio de AllFantasy del mismo formato, mezclado con 14 partidos a 100, así que 100 es el promedio.',
    },
  },
  careerTradeGrade: {
    en: {
      title: 'Career trade grade',
      body: 'Fantasy points your trades in this league actually produced: what you received scored while it stayed on your roster, minus what you sent scored on its new team, including picks once they are drafted. That net is averaged over the seasons graded — A is +100 or more a season, B +40, C between −40 and +40, D down to −100, F below. It is points scored, not trade-chart value.',
    },
    es: {
      title: 'Nota de traspasos de carrera',
      body: 'Puntos de fantasy que tus traspasos en esta liga produjeron de verdad: lo que recibiste anotó mientras siguió en tu plantilla, menos lo que enviaste anotó en su nuevo equipo, incluidas las selecciones una vez elegidas. Ese neto se promedia entre las temporadas evaluadas: A es +100 o más por temporada, B +40, C entre −40 y +40, D hasta −100, F por debajo. Son puntos anotados, no valor de una tabla de traspasos.',
    },
  },
  tradeJourney: {
    en: {
      title: 'Trading journey',
      body: 'Each step adds one of your trades in this league, in date order, to a running total of fantasy points: what you got scored while on your roster, minus what you gave up scored on its new team. Best and toughest trade are your highest and lowest single results.',
    },
    es: {
      title: 'Trayectoria de traspasos',
      body: 'Cada paso suma uno de tus traspasos en esta liga, por orden de fecha, a un total acumulado de puntos de fantasy: lo que recibiste anotó mientras estuvo en tu plantilla, menos lo que cediste anotó en su nuevo equipo. El mejor y el más duro son tus resultados individuales más alto y más bajo.',
    },
  },
  wrappedRecap: {
    en: {
      title: 'Season recap',
      body: 'Built from this league’s stored history for its current season. Record and rank come from the stored standings. In the manager edition, Trades and Drafted are yours alone for that season (the commissioner edition counts the whole league, each completed trade once): each completed trade you were part of counts once, and Drafted is the picks your team made, keepers included. The best measured trade is the one in your saved trade history rated most in your favor. The outlook reads your rank: top quarter is a contender, top 60% is in the mix, and below that it is a retool in dynasty or a reset otherwise.',
    },
    es: {
      title: 'Resumen de la temporada',
      body: 'Se construye con el historial guardado de esta liga para su temporada actual. El récord y la posición salen de la clasificación guardada. En la edición de mánager, «Trades» y «Drafted» son solo tuyos en esa temporada (la edición de comisionado cuenta toda la liga, cada traspaso completado una vez): cada traspaso completado en el que participaste cuenta una vez, y «Drafted» son las selecciones que hizo tu equipo, keepers incluidos. El mejor traspaso medido es el de tu historial guardado que más te favorece. La perspectiva lee tu posición: el primer cuarto es candidato, el 60% superior está en la pelea, y por debajo toca reconstruir en dinastía o reiniciar en los demás formatos.',
    },
  },
  devy: {
    en: {
      title: 'Devy',
      body: 'Devy players are college football prospects whose rights a devy league lets you hold before they reach the NFL. This screen ranks the scored prospects, shows which ones are on your rosters across your leagues, and lists college football news.',
    },
    es: {
      title: 'Devy',
      body: 'Los jugadores devy son prospectos del fútbol americano universitario cuyos derechos una liga devy te deja tener antes de que lleguen a la NFL. Esta pantalla clasifica a los prospectos con puntuación, muestra cuáles están en tus plantillas en todas tus ligas y reúne noticias del fútbol universitario.',
    },
  },
  devyGrade: {
    en: {
      title: 'Devy grade',
      body: 'A 0–100 draft-projection score from college data. Production and recruiting weigh most, then projected draft round, breakout age, athletic profile, PPA, wEPA and team context; only the signals a player actually has are weighted, and he needs a recruiting rating or college production to be scored at all. A recorded transfer lowers it, and a dash means not scored.',
    },
    es: {
      title: 'Nota devy',
      body: 'Una puntuación de proyección de draft de 0 a 100 hecha con datos universitarios. La producción y el reclutamiento pesan más, luego la ronda de draft proyectada, la edad de explosión, el perfil atlético, PPA, wEPA y el contexto del equipo; solo se ponderan las señales que el jugador tiene de verdad, y necesita una calificación de reclutamiento o producción universitaria para tener nota. Un traspaso registrado la baja, y un guion significa sin nota.',
    },
  },
  devyExposure: {
    en: {
      title: 'Cross-league exposure',
      body: 'How many of your leagues have this prospect on your own roster — bench, reserve and taxi included — out of the rosters we could read. Exposure is that share as a percentage. Prospects are matched to the devy list by name.',
    },
    es: {
      title: 'Exposición entre ligas',
      body: 'En cuántas de tus ligas está este prospecto en tu propia plantilla —banca, reserva y taxi incluidos— de las plantillas que pudimos leer. La exposición es esa proporción en porcentaje. Los prospectos se emparejan con la lista devy por nombre.',
    },
  },
  devySlots: {
    en: {
      title: 'Devy slots',
      body: 'The number of devy spots this league gives each team. A slot fills when you hold a prospect’s rights here, which is recorded when you draft him in an AllFantasy devy draft. Rosters imported from another platform don’t carry devy rights, so their slots show empty.',
    },
    es: {
      title: 'Puestos devy',
      body: 'El número de puestos devy que esta liga da a cada equipo. Un puesto se llena cuando tienes los derechos de un prospecto aquí, algo que se registra cuando lo eliges en un draft devy de AllFantasy. Las plantillas importadas de otra plataforma no traen derechos devy, así que sus puestos aparecen vacíos.',
    },
  },
  devyDraftBoard: {
    en: {
      title: 'Devy draft board',
      body: 'When this league has a devy draft with its order set, the board shows its picks: made, on the clock or upcoming. Otherwise it lists the best prospects no team here holds, by Fantrax devy ADP (average draft position, PPR) — lowest first.',
    },
    es: {
      title: 'Tablero del draft devy',
      body: 'Cuando esta liga tiene un draft devy con el orden fijado, el tablero muestra sus selecciones: hechas, en el reloj o por venir. Si no, enumera los mejores prospectos que ningún equipo de aquí tiene, según el ADP devy de Fantrax (posición media de draft, PPR), de menor a mayor.',
    },
  },
  devyTrend: {
    en: {
      title: 'Trend',
      body: 'No prospect’s trend is measured yet, so every row shows a dot rather than an arrow. A trend needs the same measure recorded at two different times, and nothing stores that today.',
    },
    es: {
      title: 'Tendencia',
      body: 'Todavía no se mide la tendencia de ningún prospecto, así que cada fila muestra un punto en lugar de una flecha. Una tendencia necesita la misma medida registrada en dos momentos distintos, y hoy nada la guarda.',
    },
  },
  scoutCardLegend: {
    en: {
      title: 'Manager cards',
      body: 'Seed is the league table’s order; Power is the team’s rank by AF Power — all-play winning percentage, with the last three weeks weighted 30% once four weeks are scored. On the bubble means within one win of the last playoff spot and near it in the table; Eliminated means even winning out can’t reach the playoffs. Games back counts record only, so a team level with the cut can sit either side of it. The letters are the last five head-to-head results.',
    },
    es: {
      title: 'Tarjetas de managers',
      body: '«Posición» es el orden de la tabla de la liga; «Poder» es la posición del equipo según AF Power: el % de victorias all-play, con las últimas tres semanas pesando un 30% cuando ya hay cuatro semanas puntuadas. «En el límite» significa a una victoria o menos del último puesto de playoffs y cerca de él en la tabla; «Eliminado» significa que ni ganándolo todo puede llegar a playoffs. Los partidos de diferencia cuentan solo el récord, así que un equipo empatado con el corte puede quedar a cualquier lado. Las letras son los últimos cinco resultados cara a cara.',
    },
  },
  competitiveEdge: {
    en: {
      title: 'Competitive Edge',
      body: 'Each rival’s card counts their completed trades and the waiver claims they won this season, plus FAAB left where the league uses it. These are counts you can check — no label and no prediction — and they are read for Sleeper leagues only. Your own card doesn’t show them.',
    },
    es: {
      title: 'Competitive Edge',
      body: 'La tarjeta de cada rival cuenta sus traspasos completados y las reclamaciones de waivers que ganó esta temporada, más el FAAB que le queda si la liga lo usa. Son recuentos que puedes comprobar —sin etiquetas ni predicciones— y solo se leen en ligas de Sleeper. Tu propia tarjeta no los muestra.',
    },
  },
  scoutEliminationStanding: {
    en: {
      title: 'Elimination standing',
      body: 'Your rank by this week’s points among the teams still alive; “over the cut” is how far you are above the lowest score. Until more than half the teams have points, the rank uses projections instead — the provider’s projection re-scored with this league’s rules, not AllFantasy’s own engine. If any team has no projection, it ranks on points.',
    },
    es: {
      title: 'Posición de eliminación',
      body: 'Tu posición según los puntos de esta semana entre los equipos que siguen vivos; «por encima del corte» es cuánto estás por encima de la puntuación más baja. Hasta que más de la mitad de los equipos tenga puntos, la posición usa proyecciones: la proyección del proveedor recalculada con las reglas de esta liga, no el motor propio de AllFantasy. Si algún equipo no tiene proyección, se ordena por puntos.',
    },
  },
  leagueTableColumns: {
    en: {
      title: 'League table columns',
      body: 'Slot is where he sits on the roster in that league. On your own teams, Proj is the provider’s projected stats scored with that league’s rules, and AF is AllFantasy’s own projection carried into the same scoring — shown only where Proj is. Value is his trade-market value for that league’s format; * means the league’s scoring moved it.',
    },
    es: {
      title: 'Columnas de la tabla de ligas',
      body: 'Slot es dónde está en la plantilla de esa liga. En tus propios equipos, Proj son las estadísticas proyectadas del proveedor puntuadas con las reglas de esa liga, y AF es la proyección propia de AllFantasy llevada a la misma puntuación; solo aparece donde hay Proj. Value es su valor de mercado de traspasos para el formato de esa liga; * significa que la puntuación de la liga lo movió.',
    },
  },
  leagueStripLegend: {
    en: {
      title: 'League chips',
      body: 'One chip per league you play: START, BENCH, IR or TAXI where he is yours, the other team’s name where someone else has him, FA where nobody does, and ? where we can’t read that league’s rosters. Tap a chip to open his card for that league.',
    },
    es: {
      title: 'Fichas de liga',
      body: 'Una ficha por cada liga en la que juegas: START, BENCH, IR o TAXI cuando es tuyo, el nombre del otro equipo cuando lo tiene otro, FA cuando no lo tiene nadie y ? cuando no podemos leer las plantillas de esa liga. Toca una ficha para abrir su tarjeta en esa liga.',
    },
  },
  faabBid: {
    en: {
      title: 'Suggested bid',
      body: 'The bid is his market value in that league’s format measured against its FAAB budget, capped at 60% of the budget — the same number Waiver Intel uses. Median and p75 are that league’s past winning bids: half were at or below the median, three in four at or below p75. They are shown to compare against, not used in the bid.',
    },
    es: {
      title: 'Puja sugerida',
      body: 'La puja es su valor de mercado en el formato de esa liga medido frente a su presupuesto de FAAB, con un tope del 60% del presupuesto: el mismo número que usa Waiver Intel. La mediana y el p75 son las pujas ganadoras pasadas de esa liga: la mitad fue igual o menor que la mediana, y tres de cada cuatro igual o menor que el p75. Se muestran para comparar, no entran en la puja.',
    },
  },
  nextGameMarket: {
    en: {
      title: 'Next game',
      body: 'The betting line is about his team, not him: the points his team is implied to score, the spread, its chance to win with the bookmaker’s margin removed, and the game total. Each upcoming week’s tile ranks that defense by PPR points allowed per game to his position this season — the most generous third reads Soft, the stingiest third Tough, the rest Mid.',
    },
    es: {
      title: 'Próximo partido',
      body: 'La línea de apuestas habla de su equipo, no de él: los puntos que se espera que anote su equipo, el spread, su probabilidad de ganar sin el margen de la casa y el total del partido. La ficha de cada semana próxima clasifica a esa defensa por puntos PPR permitidos por partido a su posición esta temporada: el tercio más generoso aparece como Soft, el tercio más tacaño como Tough y el resto como Mid.',
    },
  },
  playerShares: {
    en: {
      title: 'Your shares',
      body: 'The players on the most of your rosters, most-held first. “N of M” counts the rosters we could read, and “starting” is how many of those have him in the lineup. Leagues on a platform whose player ids we can’t match yet are counted as unreadable, never guessed.',
    },
    es: {
      title: 'Tus acciones',
      body: 'Los jugadores que están en más de tus plantillas, de más a menos. “N de M” cuenta las plantillas que pudimos leer, y “starting” es en cuántas de ellas está en la alineación. Las ligas de una plataforma cuyos ids de jugador aún no podemos emparejar se cuentan como ilegibles, nunca se adivinan.',
    },
  },
} satisfies Record<string, HelpTopic>
