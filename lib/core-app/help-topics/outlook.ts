import type { HelpTopic } from '../helpTopics'

/**
 * Terms on Portfolio, Season Outlook, Your Week, Rivalry Radar, Game Plan. See ../helpTopics.ts; cite the code each claim rests on.
 *
 *   competitiveStatus ........ lib/core-app/portfolioClassify.ts competitiveStatus, thirdOf, MIN_GAMES_FOR_STANDING 2
 *   portfolioActions ......... lib/core-app/portfolioView.ts rankActions, KEY_PLAYER_VALUE 1500, KEY_FALL 0.15
 *   ppr ...................... lib/decision-os/trade/scoringContextFromWorld.ts scoringFormatFromRec (0.25 / 0.75)
 *   diversification .......... portfolioView.ts diversification (NFL, 2+ lineups, a bye needs 2+ starters)
 *   playerValueBook .......... portfolioView.ts exposureRows; lib/core-app/valueBook.ts CROSS_LEAGUE_BOOK
 *   riskLevels ............... portfolioView.ts injuryLevel / byeLevel / fragileLevel / stackLevel, cellFor
 *   outlookTiles ............. lib/core-app/seasonOutlook.ts `summary` (50 / 99 / 25–75 / 50)
 *   swingGame ................ seasonOutlook.ts swing branch; lib/core-app/seasonOutlookFocus.ts BRANCH_ITERATIONS 2_000
 *   clinchHelp ............... seasonOutlook.ts helpIfLose (MIN_SAMPLE 200, MIN_LIFT 4, top two)
 *   outlookPlayoffOdds ....... seasonOutlook.ts ITERATIONS 10_000, OutlookTeam.range; lib/core-app/outlookCopy.ts band
 *   strengthOfSchedule ....... lib/core-app/outlookSim.ts scheduleStrength
 *   winsMilestones ........... outlookSim.ts readMilestones, MIN_RUNS_FOR_A_RECORD 40
 *   playoffPts ............... seasonOutlookFocus.ts moves (MIN_WEEKLY_GAIN 1, at most two waiver adds)
 *   whatDecidesIt ............ outlookCopy.ts describeTeamOutlook
 *   rivalrySeries ............ lib/core-app/weekBoard.ts getRivalryRadar tiering; league board `rivalry`
 *   weekWinProbability ....... weekBoard.ts buildProfiles, SIGMA_FLOOR 12, priorSeasonRowsFromFacts; lib/core-app/weekBoardRules.ts
 *   formGap .................. weekBoard.ts `card.form`
 *   eliminationCut ........... weekBoard.ts buildEliminationWeeks; lib/core-app/eliminationSettle.ts settleBadge
 *   lineupProjection ......... lib/core-app/weekLineups.ts
 *   flaggedStarter ........... lib/core-app/gameDayTriage.ts; lib/core-app/injuryStatus.ts
 *   lineupLock ............... lib/core-app/lineupLock.ts; GamePlan.tsx `firstKickoff`
 *
 * ⚠ `weekWinProbability` IS NOT `matchupWinProbability` (rankings.ts). Your Week and Rivalry Radar
 * use a team-average estimate; the Matchup screen runs a different model. Keep them two topics.
 * ⚠ `outlookPlayoffOdds` IS NOT `playoffOdds` (rankings.ts), which explains the Standings columns.
 */
export const OUTLOOK_TOPICS = {
  competitiveStatus: {
    en: {
      title: 'Competitive status',
      body: 'If you told Chimmy you are contending or rebuilding, that wins. Otherwise your place in the standings (after 2+ games) and your roster value rank (once at least half the league is priced) each count as top, middle or bottom third, and together they decide it. With neither, there is not enough to say.',
    },
    es: {
      title: 'Situación competitiva',
      body: 'Si le dijiste a Chimmy que compites o que reconstruyes, eso manda. Si no, tu puesto en la clasificación (tras 2 o más partidos) y el ranking del valor de tu plantilla (cuando al menos la mitad de la liga tiene precio) cuentan como tercio alto, medio o bajo, y juntos lo deciden. Sin ninguno de los dos, no hay suficiente para decirlo.',
    },
  },
  portfolioActions: {
    en: {
      title: 'Leagues that need you',
      body: 'A league is listed for a live draft (or one not yet held), empty starting slots, starters ruled out, on bye or questionable, positions with no healthy backup, or key players (value 1,500+) down 15% or more. Bigger problems rank higher; favorites count ×1.5, paid leagues ×1.3 and leagues you commission ×1.1. Importance only reorders — it never adds a league.',
    },
    es: {
      title: 'Ligas que te necesitan',
      body: 'Una liga aparece por un draft en vivo (o aún no celebrado), puestos titulares vacíos, titulares descartados, en descanso o en duda, posiciones sin un suplente sano, o jugadores clave (valor 1.500+) que bajaron un 15% o más. Los problemas mayores van primero; las favoritas cuentan ×1,5, las ligas de pago ×1,3 y las que administras ×1,1. La importancia solo reordena: nunca añade una liga.',
    },
  },
  ppr: {
    en: {
      title: 'Scoring format',
      body: 'Read from each league’s own points per catch: under 0.25 is Standard, under 0.75 is Half PPR, anything higher is PPR. “Rulebook not stored” means we have no per-catch setting for that league.',
    },
    es: {
      title: 'Formato de puntuación',
      body: 'Se lee de los puntos por recepción de cada liga: menos de 0,25 es Standard, menos de 0,75 es Half PPR y cualquier valor mayor es PPR. «Rulebook not stored» significa que no tenemos ese ajuste de puntos por recepción para esa liga.',
    },
  },
  diversification: {
    en: {
      title: 'One bad Sunday',
      body: 'Single events that would hit two or more of your NFL lineups at once: one player ruled out (counting every roster he is on), one club having a bad day (your starters from it), or one bye week taking two or more starters from a lineup. Ranked by how many lineups each reaches, then by starters lost.',
    },
    es: {
      title: 'Un mal domingo',
      body: 'Eventos únicos que golpearían a dos o más de tus alineaciones de la NFL a la vez: un jugador descartado (cuenta cada plantilla en la que está), un equipo con un mal día (tus titulares de ese equipo) o una semana de descanso que deja a una alineación sin dos o más titulares. Se ordenan por cuántas alineaciones alcanzan y luego por titulares perdidos.',
    },
  },
  playerValueBook: {
    en: {
      title: 'Player exposure',
      body: '“3/5” means he is on 3 of the 5 rosters we could read; “starts 2” means 2 of those lineups start him. Values come from one FantasyCalc dynasty superflex price list whatever each league’s own format, so every player is on one scale.',
    },
    es: {
      title: 'Exposición por jugador',
      body: '«3/5» significa que está en 3 de las 5 plantillas que pudimos leer; «starts 2», que 2 de esas alineaciones lo ponen de titular. Los valores salen de una sola lista de precios de FantasyCalc (dynasty, superflex), sea cual sea el formato de cada liga, para que todos los jugadores estén en la misma escala.',
    },
  },
  riskLevels: {
    en: {
      title: 'Risk levels',
      body: 'Each cell counts your starters in that NFL league. Injuries weigh an Out as 2 and an at-risk tag such as Questionable as 1: 1 is Low, 2–3 Medium, 4+ High. Byes and thin spots (positions with no healthy backup) are Low at 1, Medium at 2, High at 3+; a stack (starters from one club) is Low at 2, Medium at 3, High at 4+. A dash means it cannot be judged: no roster imported, draft not finished, or lineup slots not stored.',
    },
    es: {
      title: 'Niveles de riesgo',
      body: 'Cada celda cuenta tus titulares en esa liga de la NFL. En lesiones, un Out pesa 2 y una etiqueta de riesgo como Questionable pesa 1: 1 es Bajo, 2–3 Medio, 4+ Alto. Descansos y puntos débiles (posiciones sin suplente sano) son Bajo con 1, Medio con 2 y Alto con 3+; un stack (titulares de un mismo equipo) es Bajo con 2, Medio con 3 y Alto con 4+. Un guion significa que no se puede juzgar: plantilla no importada, draft sin terminar o puestos de alineación no guardados.',
    },
  },
  outlookTiles: {
    en: {
      title: 'Your odds across leagues',
      body: 'On track: 50% or better to make the playoffs. Clinched: guaranteed by arithmetic under supported, league-stated qualification rules. A 99% forecast alone is not a clinch. On the bubble: between 25% and 75%. On pace for a bye: 50% or better to earn one.',
    },
    es: {
      title: 'Tus probabilidades en todas las ligas',
      body: 'Con opciones: 50% o más de llegar a playoffs. Clasificado: asegurado por aritmética según reglas compatibles y declaradas por la liga. Un pronóstico del 99% no garantiza la clasificación. En la burbuja: entre 25% y 75%. En ritmo de descanso: 50% o más de conseguir uno.',
    },
  },
  swingGame: {
    en: {
      title: 'Swing game',
      body: 'Your next unplayed game, re-run 2,000 times as a win and 2,000 times as a loss. The swing is the gap between the two playoff odds, in percentage points; the “±” figure on the all-leagues list is half of it.',
    },
    es: {
      title: 'Partido decisivo',
      body: 'Tu próximo partido sin jugar, simulado 2.000 veces como victoria y 2.000 como derrota. La diferencia entre ambas probabilidades de playoffs, en puntos porcentuales, es lo que está en juego; la cifra «±» de la lista de todas las ligas es la mitad.',
    },
  },
  clinchHelp: {
    en: {
      title: 'The help you need',
      body: 'In the 2,000 runs where you lose, we compare your odds when each rival misses the playoffs with your odds overall. A rival is named only if their missing out lifts your odds by 4+ points across at least 200 runs, and at most two are named.',
    },
    es: {
      title: 'La ayuda que necesitas',
      body: 'En las 2.000 simulaciones en que pierdes, comparamos tus probabilidades cuando cada rival se queda fuera de playoffs con tus probabilidades en general. Solo se nombra a un rival si su eliminación sube tus probabilidades 4 puntos o más en al menos 200 simulaciones, y como máximo se nombran dos.',
    },
  },
  outlookPlayoffOdds: {
    en: {
      title: 'Playoff odds',
      body: 'The share of simulated seasons — up to 10,000 per league — that end with you in the playoff field. The small range is the 10th to 90th percentile when every team’s scoring average is re-drawn. Green is 75% or more, amber 25–74%, red under 25%.',
    },
    es: {
      title: 'Probabilidad de playoffs',
      body: 'La proporción de temporadas simuladas (hasta 10.000 por liga) en las que terminas dentro de playoffs. El rango pequeño va del percentil 10 al 90 al volver a sortear el promedio de anotación de cada equipo. Verde es 75% o más, ámbar 25–74% y rojo menos de 25%.',
    },
  },
  strengthOfSchedule: {
    en: {
      title: 'Hardest schedule left',
      body: 'Every team is ranked by the average weekly score of the opponents it still has to play, using each opponent’s fitted average rather than what they happened to score in that game. 1st is the hardest in the league.',
    },
    es: {
      title: 'Calendario restante más difícil',
      body: 'Cada equipo se ordena por la anotación semanal promedio de los rivales que le quedan, usando el promedio ajustado de cada rival y no lo que anotó en ese partido concreto. El 1.º es el más difícil de la liga.',
    },
  },
  winsMilestones: {
    en: {
      title: 'Odds by final record',
      body: 'Each bar is how often a simulated season that ends on that many wins makes the playoffs. A record reached in fewer than 40 runs is left blank rather than guessed.',
    },
    es: {
      title: 'Probabilidad según el récord final',
      body: 'Cada barra muestra con qué frecuencia una temporada simulada que termina con esas victorias llega a playoffs. Un récord alcanzado en menos de 40 simulaciones queda en blanco en lugar de estimarse.',
    },
  },
  playoffPts: {
    en: {
      title: 'Playoff pts',
      body: 'How many percentage points a move adds to your playoff odds: the season is simulated 2,000 times with the move and 2,000 times without it, from the same starting point. A move must be worth at least 1 lineup point a week to be listed, and at most two waiver adds are shown.',
    },
    es: {
      title: 'Puntos de playoffs',
      body: 'Cuántos puntos porcentuales suma un movimiento a tu probabilidad de playoffs: la temporada se simula 2.000 veces con el movimiento y 2.000 sin él, desde el mismo punto de partida. Un movimiento debe valer al menos 1 punto de alineación por semana para aparecer, y se muestran como máximo dos fichajes.',
    },
  },
  whatDecidesIt: {
    en: {
      title: 'What decides it',
      body: 'A plain reading of each team’s playoff odds. 99%+ is very likely, but only an explicit arithmetic status counts as clinched; 85%+ is in barring a collapse; 60%+ needs to win about a third of the games left; 30%+ needs about half, plus help; 5%+ must win out and get help; 1–5% is alive, barely; 1% or less is a long shot, not mathematical elimination. A team with too few completed weeks is not read at all.',
    },
    es: {
      title: 'Qué lo decide',
      body: 'Una lectura simple de la probabilidad de playoffs de cada equipo. Con 99%+ es muy probable, pero solo un estado aritmético explícito asegura la clasificación; con 85%+ está dentro salvo un derrumbe; con 60%+ necesita ganar cerca de un tercio de los partidos restantes; con 30%+, cerca de la mitad y ayuda; con 5%+, ganarlo todo y recibir ayuda; entre 1 y 5%, sigue vivo a duras penas; con 1% o menos, es poco probable, sin afirmar eliminación matemática. Un equipo con muy pocas semanas jugadas no se evalúa.',
    },
  },
  rivalrySeries: {
    en: {
      title: 'Series record',
      body: 'Every completed meeting on file with that team in that league, across seasons, as wins–losses — plus a third number for ties when a meeting finished level. On Rivalry Radar, a series of one meeting or with equal wins and losses sits in the middle tier, and so does a series whose leader is projected to lose this week.',
    },
    es: {
      title: 'Historial de la serie',
      body: 'Cada enfrentamiento completado que tenemos contra ese equipo en esa liga, a lo largo de las temporadas, como victorias–derrotas, y un tercer número para los empates cuando algún partido terminó igualado. En Rivales, una serie de un solo partido o con tantas victorias como derrotas va en el grupo del medio, igual que una serie cuyo líder tiene proyectada una derrota esta semana.',
    },
  },
  weekWinProbability: {
    en: {
      title: 'This week’s win probability',
      body: 'A simple estimate from each team’s average weekly score and how much it varies, over every completed week on file — earlier seasons included. The “projected” scores are those averages, not lineup projections, and it knows nothing about injuries or byes. A team needs 3 completed weeks; a coin flip means a history-based win probability between 40% and 60%, so different sports are not compared using raw points.',
    },
    es: {
      title: 'Probabilidad de ganar esta semana',
      body: 'Una estimación sencilla a partir de la anotación semanal promedio de cada equipo y de cuánto varía, con todas las semanas completadas que tenemos, incluidas temporadas anteriores. Las puntuaciones «proyectadas» son esos promedios, no proyecciones de alineación, y no tiene en cuenta lesiones ni descansos. Cada equipo necesita 3 semanas completadas; un partido ajustado tiene una probabilidad histórica de ganar entre el 40% y el 60%, sin comparar deportes por puntos brutos.',
    },
  },
  formGap: {
    en: {
      title: 'Form so far',
      body: 'With fewer than 3 completed weeks for a team there is no win probability. If both teams have scored at least once, the gap between their average weekly scores so far is shown instead — form, not a prediction.',
    },
    es: {
      title: 'Forma hasta ahora',
      body: 'Si un equipo tiene menos de 3 semanas completadas, no hay probabilidad de ganar. Si ambos equipos ya puntuaron al menos una vez, se muestra en su lugar la diferencia entre sus promedios semanales hasta ahora: es forma, no un pronóstico.',
    },
  },
  eliminationCut: {
    en: {
      title: 'Lowest score is out',
      body: 'There is no opponent: the week’s lowest score is eliminated. “+N clear” is your score minus the lowest among the teams that have scored so far; “OUT · on the block” means yours is currently the lowest. “Decided” means your starters and enough teams below you have finished (SAFE), or every team has finished (OUT).',
    },
    es: {
      title: 'La puntuación más baja queda fuera',
      body: 'No hay rival: la puntuación más baja de la semana queda eliminada. «+N» es tu puntuación menos la más baja entre los equipos que ya puntuaron; «OUT · en riesgo» significa que la tuya es ahora la más baja. «Decidido» significa que tus titulares y suficientes equipos por debajo ya terminaron (SAFE), o que todos los equipos terminaron (OUT).',
    },
  },
  lineupProjection: {
    en: {
      title: 'Lineup proj',
      body: 'The line under a matchup adds up each lineup as set, scored under that league’s rules: AF is AllFantasy’s own projection, API is the provider’s. It is a different measure from the team-average scores and win probability. “Partial” means some starters had no projection.',
    },
    es: {
      title: 'Proyección de alineación',
      body: 'La línea bajo un enfrentamiento suma cada alineación tal como está, con la puntuación de esa liga: AF es la proyección propia de AllFantasy y API la del proveedor. Es una medida distinta de los promedios por equipo y de la probabilidad de ganar. Si un total es parcial, a algunos titulares les faltaba proyección.',
    },
  },
  flaggedStarter: {
    en: {
      title: 'Flagged starters',
      body: 'Starters the injury feed lists as ruled out (Out, IR, PUP, NFI, suspended) or at risk (Questionable, Doubtful and the like), plus starters whose club has no game on this week’s schedule. “Active” or no report is not a flag, and a report for a different week is ignored. Starters whose game has kicked off are not counted.',
    },
    es: {
      title: 'Titulares señalados',
      body: 'Titulares que el parte de lesiones marca como descartados (Out, IR, PUP, NFI, suspendidos) o en riesgo (Questionable, Doubtful y similares), más los titulares cuyo equipo no tiene partido en el calendario de esta semana. «Active» o la ausencia de parte no cuentan, y se ignora un parte de otra semana. No se cuentan los titulares cuyo partido ya empezó.',
    },
  },
  lineupLock: {
    en: {
      title: 'First lock',
      body: 'The earliest kickoff among your flagged starters who have not played yet — a countdown inside a day, otherwise the kickoff in Eastern time. Each player locks at his own kickoff by default; a league set to lock every lineup at the week’s first game locks earlier, and that setting is not stored, so this cannot show it.',
    },
    es: {
      title: 'Primer bloqueo',
      body: 'El primer inicio de partido entre tus titulares señalados que aún no jugaron: una cuenta atrás si falta menos de un día y, si no, la hora de inicio del Este. Por defecto cada jugador se bloquea al empezar su partido; una liga configurada para bloquear todas las alineaciones en el primer partido de la semana se bloquea antes, y ese ajuste no se guarda, así que esto no puede reflejarlo.',
    },
  },
} satisfies Record<string, HelpTopic>
