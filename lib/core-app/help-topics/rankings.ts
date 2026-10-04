import type { HelpTopic } from '../helpTopics'

/**
 * Rankings, Standings and Live terms. Every number here is read from the code it describes — cite
 * it when you change it:
 *   managerScore weights, 14-game prior ......... lib/core-app/rankingsEngine.ts SCORE_WEIGHTS, WIN_RATE_PRIOR_GAMES
 *   confidence bands ............................ rankingsEngine.ts (games < 40 || seasons < 5 → low; < 15 → medium)
 *   letter grades ............................... lib/core-app/rankings.ts GRADE_SCALE
 *   Class / Division ............................ lib/class-rating/engine.ts CLASS_COUNT 25, DIVISION_COUNT 5; classView.ts rating − 2·rd
 *   AF Power blend .............................. lib/core-app/standingsModel.ts (≥4 weeks: 0.7 season + 0.3 last three)
 *   Season Outlook runs ......................... lib/core-app/seasonOutlook.ts ITERATIONS 10_000
 *   scoreboard WIN .............................. lib/core-app/leagueScoreboard.ts WEEKLY_SIGMA 26, clamped 0.03–0.97
 *   live NFL estimate ........................... lib/live/winProbability.ts (score and clock only)
 *   live impact ................................. lib/live/liveImpact.ts (summed per player AND league)
 *
 * ⚠ FOUR DIFFERENT "WIN" NUMBERS LIVE ON THESE SCREENS — the scoreboard's, the live game estimate,
 * ESPN's, and the matchup forecast. They are four topics on purpose; do not merge them.
 */
export const RANKINGS_TOPICS = {
  communityBoardColumns: {
    en: {
      title: 'Board columns',
      body: 'Score is the AF manager score, 0–100. Win % blends in 14 games at .500, so a short record can’t outrank a long one. Titles and Playoffs compare what was won with what each league’s size and playoff cut made likely. Scoring is points per game against same-format teams, where 100 is average.',
    },
    es: {
      title: 'Columnas de la tabla',
      body: 'Score es la puntuación de manager AF, de 0 a 100. El % de victorias mezcla 14 partidos a .500, para que un récord corto no supere a uno largo. Títulos y Playoffs comparan lo ganado con lo que el tamaño de cada liga y su corte de playoffs hacían probable. Scoring son puntos por partido frente a equipos del mismo formato; 100 es el promedio.',
    },
  },
  afManagerScore: {
    en: {
      title: 'AF manager score',
      body: 'A 0–100 score from four parts: win rate 30%, scoring 20%, titles 25%, playoffs 25%. A part that can’t be measured is left out and the others are scaled up to fill its share.',
    },
    es: {
      title: 'Puntuación de manager AF',
      body: 'Una puntuación de 0 a 100 con cuatro partes: % de victorias 30%, anotación 20%, títulos 25%, playoffs 25%. Una parte que no se puede medir queda fuera y las demás se escalan para cubrir su peso.',
    },
  },
  scoreConfidence: {
    en: {
      title: 'Confidence',
      body: 'Low means fewer than 40 games or fewer than 5 league-seasons with results. Medium means fewer than 15 league-seasons. Anything more is high.',
    },
    es: {
      title: 'Confianza',
      body: 'Baja: menos de 40 partidos o menos de 5 temporadas de liga con resultados. Media: menos de 15 temporadas de liga. Más que eso es alta.',
    },
  },
  scoringIndex: {
    en: {
      title: 'PPG and Index',
      body: 'PPG is points per game. Index is that season’s PPG against the average AllFantasy team in the same format, × 100 — so 100 is average and 110 is 10% above it.',
    },
    es: {
      title: 'PPG e Índice',
      body: 'PPG son puntos por partido. El índice compara el PPG de esa temporada con el equipo promedio de AllFantasy del mismo formato, × 100: 100 es el promedio y 110 es un 10% por encima.',
    },
  },
  classRating: {
    en: {
      title: 'Class board',
      body: 'Ranked by rating minus twice its ± (its uncertainty), so a lucky few weeks can’t top it. Your Class, 1–25, comes from your percentile among established managers, and every five Classes make a Division.',
    },
    es: {
      title: 'Tabla de Clases',
      body: 'Se ordena por rating menos dos veces su ± (su incertidumbre), para que unas pocas semanas con suerte no lo encabecen. Tu Clase, de 1 a 25, sale de tu percentil entre managers establecidos, y cada cinco Clases forman una División.',
    },
  },
  storedPowerRanking: {
    en: {
      title: 'League power',
      body: 'Read from this league’s latest saved power ranking, which is saved whenever someone in the league runs Power rankings. Strengths and risks come from an AI refresh. Nothing here is recomputed when you open the page.',
    },
    es: {
      title: 'Poder de la liga',
      body: 'Se lee del último ranking de poder guardado de esta liga, que se guarda cada vez que alguien de la liga ejecuta Power rankings. Fortalezas y riesgos vienen de una actualización con IA. Nada se recalcula al abrir la página.',
    },
  },
  letterGrade: {
    en: {
      title: 'Letter grade',
      body: 'The letter comes from the AF manager score: A+ is 93 or more, A 85, A− 78, B+ 70, B 62, C 50, and D anything below.',
    },
    es: {
      title: 'Calificación con letra',
      body: 'La letra sale de la puntuación de manager AF: A+ es 93 o más, A 85, A− 78, B+ 70, B 62, C 50 y D cualquier valor por debajo.',
    },
  },
  afPowerScore: {
    en: {
      title: 'AF Power',
      body: 'How often you’d have won if you played every team every week (all-play), as a 0–100 score. From week 4 it is weighted 70% season and 30% your last three weeks. It is not the /core/rankings ladder.',
    },
    es: {
      title: 'AF Power',
      body: 'Con qué frecuencia habrías ganado si jugaras contra todos los equipos cada semana (all-play), en una escala de 0 a 100. Desde la semana 4 pesa un 70% la temporada y un 30% tus últimas tres semanas. No es la escalera de /core/rankings.',
    },
  },
  playoffOdds: {
    en: {
      title: 'Playoff odds',
      body: '“Win N / lose N more” is certain from this table’s own arithmetic. The percentages come from Season Outlook simulating the rest of the season, up to 10,000 times.',
    },
    es: {
      title: 'Probabilidad de playoffs',
      body: '“Gana N / pierde N más” es seguro según la propia aritmética de esta tabla. Los porcentajes vienen de Season Outlook, que simula el resto de la temporada hasta 10.000 veces.',
    },
  },
  standingsColumns: {
    en: {
      title: 'Table columns',
      body: 'GB is games behind the last playoff spot (+ means ahead). Magic # C is more wins that guarantee a spot; E is more losses that end the chase — both hold whatever every other game does. Playoff % comes from Season Outlook’s simulation.',
    },
    es: {
      title: 'Columnas de la tabla',
      body: 'GB son partidos detrás del último puesto de playoffs (+ indica ventaja). Número mágico C son victorias más que garantizan un puesto; E son derrotas más que terminan la pelea, pase lo que pase en los demás partidos. El % de playoffs viene de la simulación de Season Outlook.',
    },
  },
  allPlayLuck: {
    en: {
      title: 'Power view',
      body: 'xW is expected wins: each week you earn the share of the league you outscored. Luck is your real wins minus xW. Lineup % is points scored as a share of your best possible lineup, and Bench/wk is the points left on the bench each week.',
    },
    es: {
      title: 'Vista de poder',
      body: 'xW son victorias esperadas: cada semana sumas la parte de la liga a la que superaste. Suerte son tus victorias reales menos xW. Lineup % son los puntos anotados como parte de tu mejor alineación posible, y Bench/sem son los puntos que quedaron en la banca cada semana.',
    },
  },
  scoreboardWinChance: {
    en: {
      title: 'WIN and MARGIN',
      body: 'WIN is a pre-game chance from the two projected totals, assuming each lineup’s score varies by about 26 points, capped between 3% and 97%. It shows only before anything is scored, and only when both lineups are fully projected. MARGIN is the points gap. On your own game the percentage is the Matchup screen’s forecast instead.',
    },
    es: {
      title: 'WIN y MARGIN',
      body: 'WIN es una probabilidad previa al partido a partir de los dos totales proyectados, suponiendo que el puntaje de cada alineación varía unos 26 puntos, limitada entre 3% y 97%. Solo aparece antes de que se anote nada y cuando ambas alineaciones están proyectadas por completo. MARGIN es la diferencia de puntos. En tu propio partido, el porcentaje es el pronóstico de la pantalla de Matchup.',
    },
  },
  liveImpactTotal: {
    en: {
      title: 'Your live impact',
      body: 'Live fantasy points from your starters in games being played now. A player on three of your teams counts three times — once per league — because he is affecting three of your matchups.',
    },
    es: {
      title: 'Tu impacto en vivo',
      body: 'Puntos de fantasía en vivo de tus titulares en los partidos que se juegan ahora. Un jugador en tres de tus equipos cuenta tres veces, una por liga, porque afecta a tres de tus enfrentamientos.',
    },
  },
  biggestMover: {
    en: {
      title: 'Biggest mover',
      body: 'The most recent play by one of your starters in a live game — the latest moment, not necessarily the biggest scorer.',
    },
    es: {
      title: 'Mayor movimiento',
      body: 'La jugada más reciente de uno de tus titulares en un partido en vivo: el último momento, no necesariamente el que más anotó.',
    },
  },
  liveGameWinEstimate: {
    en: {
      title: 'Win prob · est',
      body: 'For NFL games in progress, AllFantasy’s own estimate from the score and the time left only. It ignores possession, down and distance, timeouts and field position, so it is least reliable late in close games.',
    },
    es: {
      title: 'Prob. de ganar · est.',
      body: 'En partidos de la NFL en curso, una estimación propia de AllFantasy basada solo en el marcador y el tiempo restante. No tiene en cuenta la posesión, el down, los tiempos muertos ni la posición en el campo, así que es menos fiable al final de partidos cerrados.',
    },
  },
  matchupWinProbability: {
    en: {
      title: 'Chance to win',
      body: 'The same forecast as your Matchup screen: points already scored plus your remaining starters’ projections. It is left out when any starter can’t be projected, because a missing projection would count as a certain zero.',
    },
    es: {
      title: 'Probabilidad de ganar',
      body: 'El mismo pronóstico que tu pantalla de Matchup: los puntos ya anotados más las proyecciones de tus titulares que faltan. Se omite si algún titular no tiene proyección, porque una proyección ausente contaría como un cero seguro.',
    },
  },
  espnWinProbability: {
    en: {
      title: 'ESPN win %',
      body: 'ESPN’s own win probability after the latest play. It is not the “Win prob · est” on the Live Scores card, which is AllFantasy’s estimate.',
    },
    es: {
      title: '% de victoria de ESPN',
      body: 'La probabilidad de victoria de ESPN tras la última jugada. No es la “Prob. de ganar · est.” de la tarjeta de Live Scores, que es la estimación de AllFantasy.',
    },
  },
  baseballBoxColumns: {
    en: {
      title: 'Box score',
      body: 'Batting: AB at-bats, R runs, H hits, RBI runs batted in, HR home runs, BB walks, K strikeouts, AVG batting average. Pitching: IP innings pitched, ER earned runs, PC pitch count, ERA earned-run average.',
    },
    es: {
      title: 'Box score',
      body: 'Bateo: AB turnos al bate, R carreras, H hits, RBI carreras impulsadas, HR jonrones, BB bases por bolas, K ponches, AVG promedio de bateo. Pitcheo: IP entradas lanzadas, ER carreras limpias, PC lanzamientos, ERA efectividad.',
    },
  },
  shotChartCount: {
    en: {
      title: 'Shot chart',
      body: 'Counts only the shots drawn here. Heaves from past half court are left off the chart, so it can differ from the box score.',
    },
    es: {
      title: 'Mapa de tiros',
      body: 'Cuenta solo los tiros dibujados aquí. Los lanzamientos desde más allá de media cancha no se dibujan, así que puede no coincidir con el box score.',
    },
  },
  hockeyShotsOnGoal: {
    en: {
      title: 'Shots on goal',
      body: 'SOG counts goals plus saved shots. Missed shots are drawn hollow and are not counted.',
    },
    es: {
      title: 'Tiros a puerta',
      body: 'SOG cuenta los goles más los tiros atajados. Los tiros desviados se dibujan huecos y no se cuentan.',
    },
  },
  hockeyStrength: {
    en: {
      title: 'PP and SH',
      body: 'PP marks a goal scored on a power play and SH one scored short-handed. Even-strength goals have no tag.',
    },
    es: {
      title: 'PP y SH',
      body: 'PP marca un gol en power play y SH uno en inferioridad numérica. Los goles con igualdad numérica no llevan etiqueta.',
    },
  },
} satisfies Record<string, HelpTopic>
