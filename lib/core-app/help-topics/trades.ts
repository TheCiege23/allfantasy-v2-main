import type { HelpTopic } from '../helpTopics'

/**
 * Terms on the /core Trades screens: the Trade Center (league and all-leagues), the trade timeline,
 * Trade history and ideas, and the home's latest-trades band. See ../helpTopics.ts; cite the code each
 * claim rests on.
 *
 *   tradeGrade ............... lib/decision-os/trade/tradeGrade.ts signedGapPct (÷ the LARGER side), gradeTrade
 *                              (any unpriced asset withholds), partnerLetter = mirror; lib/trade-intel/gradeScale.ts
 *                              projectedLetterFor, PROJECTED_EVEN_BAND 10 / PROJECTED_STRONG_BAND 25
 *   tradeFairnessScore ....... lib/lineup-optimizer.ts computeValueFairness (50 + 50·tanh(gap ÷ 0.3·total));
 *                              runTradeConsoleAnalysis.ts (league totals; label = tradeGradeLabel);
 *                              verdictPresentation.ts (null when the grade is withheld)
 *   tradeValueBalance ........ TradeCenter.tsx `balance` (pricedTotal, pct ÷ max), valueOf (market → league)
 *   tradeLeagueValue ......... lib/trade-value/leagueTradeValue.ts LeagueValuedLine.base, LEAGUE_FACTOR_MIN/MAX;
 *                              leagueTradeGrader.ts (the letter's pass has needFactors: null — scoring only)
 *   tradeRosterFit ........... leagueTradeGrader.ts rosterFitGrade (second pass, never the letter);
 *                              lib/trade-value/viewerNeedFactors.ts allocateNeedFactors; rosterNeed.ts counterpartyPriceDelta
 *   tradeAfThisWeek .......... TradeCenter.tsx afWeekTotal (display only); trades/rosters/route.ts afEngineForLeague
 *   tradeProductionLean ...... lib/trade-value-console/build-trade-intelligence.ts whoWinsNow (|net| < 1 = even),
 *                              whoWinsLongTerm = the grade's side; tradeProjectionEnrichment.ts sumEffectiveProjections
 *                              (all players, picks/FAAB excluded, any missing → null)
 *   tradeValueAlerts ......... lib/core-app/crossLeagueValueActions.ts (DYNASTY / ONE_QB, limit 10; the page passes
 *                              the selected league only); lib/trade-intel/playerStock.ts FLAT_BAND 0.01
 *   tradeTimeline ............ app/api/league/trades-panel/route.ts proposalGrade (receipt, else today's, else null);
 *                              TradeInbox.tsx valueNet (received − given), teamGrades + `current` ("Today"), assetValues
 *   tradePartnerFit .......... lib/trade-intel/partnerRanking.ts WEIGHTS .35/.25/.25/.15, MAX_APART 0.35, labelFor 70/50/30
 *   tradeFinderMatches ....... lib/trade-intel/tradeFinderService.ts VALUE_FAIRNESS_PCT 20, FAIRNESS_BAND 30 (ADP)
 *   tradeEvidence ............ lib/decision-os/trade/tradeEvidence.ts tradeEvidence, TRADE_VALUE_STALE_DAYS 7
 *   completedTradeGrade ...... frozenCompletedGrade.ts (a completed trade keeps its grade); gradeMoment.ts (the note
 *                              that says which day's values priced it); gradeLineValues.ts (asset numbers)
 *   tradeIdeas ............... lib/decision-os/trade/tradeAgentRules.ts qualifyDeal (C/C + both rosterFit > 0),
 *                              AGENT_MAX_PER_MANAGER 3, AGENT_WINDOW_UTC_HOURS
 *
 * 🛑 `completedTradeGrade` IS WORDED TO STAY TRUE WHILE THE COMPLETED-TRADE PRICING DATE CHANGES. It
 * says a completed trade keeps the grade it was given and that the note beside the letter says which
 * day's values priced it — never "priced when first graded" or "priced at the time of the trade" as a
 * rule. Whichever the code does, that note (`gradeMoment`) is what names the day.
 *
 * ⚠ NOTHING HERE DESCRIBES A "Realized" LETTER. Whether it stays a letter is an open question.
 */
export const TRADES_TOPICS = {
  tradeGrade: {
    en: {
      title: 'The trade grade',
      body: 'The letter compares the value a side receives with the value it sends, as a percent of the larger side. Within 10% is a C (even); 10–24% is a B or a D; 25% or more is an A or an F. The other team’s letter is the exact mirror, so the partner in an A deal holds an F. If any asset can’t be priced, no letter is given — a missing price is never counted as zero.',
    },
    es: {
      title: 'La calificación del intercambio',
      body: 'La letra compara el valor que recibe un lado con el que envía, como porcentaje del lado mayor. Dentro del 10% es una C (equilibrado); del 10 al 24%, una B o una D; 25% o más, una A o una F. La letra del otro equipo es el reflejo exacto, así que el socio de un intercambio A tiene una F. Si algún activo no tiene precio, no se da letra: un precio que falta nunca cuenta como cero.',
    },
  },
  tradeFairnessScore: {
    en: {
      title: 'Score out of 100',
      body: '50 is even. Above 50 the deal favours you, below 50 it favours the other team, and it flattens toward 0 or 100 as the gap grows: 50 + 50 × tanh(the value gap ÷ 30% of both sides’ combined value). It uses the same league values as the letter, and the word beside it uses the letter’s own bands.',
    },
    es: {
      title: 'Puntuación sobre 100',
      body: '50 es equilibrado. Por encima de 50 el intercambio te favorece, por debajo favorece al otro equipo, y se aplana hacia 0 o 100 a medida que crece la diferencia: 50 + 50 × tanh(diferencia de valor ÷ 30% del valor combinado de ambos lados). Usa los mismos valores de liga que la letra, y la palabra de al lado usa las mismas franjas que la letra.',
    },
  },
  tradeValueBalance: {
    en: {
      title: 'Value balance',
      body: 'Each side’s total counts priced assets only: an asset with no value is left out and shown as unpriced, never added as zero. “% apart” is the gap divided by the larger side, the same measure the letter uses. Before you analyze, the totals are market values; after, they are this league’s values, the ones the grade reads.',
    },
    es: {
      title: 'Balance de valor',
      body: 'El total de cada lado solo cuenta activos con valor calculado: un activo sin valor se deja fuera y se marca como sin precio, nunca se suma como cero. «% de diferencia» es la diferencia dividida entre el lado mayor, la misma medida que usa la letra. Antes de analizar, los totales son valores de mercado; después, son los valores de esta liga, los que lee la calificación.',
    },
  },
  tradeLeagueValue: {
    en: {
      title: 'Market value and league value',
      body: 'Market value is the trade-chart price for this league’s format: dynasty or redraft, 1QB or superflex, team count and PPR. League value adjusts it for this league’s own scoring, such as a real tight-end premium, and the combined change stays between half and double the market price. The letter is graded on league value; each asset listed here shows its change and the rule behind it.',
    },
    es: {
      title: 'Valor de mercado y valor de liga',
      body: 'El valor de mercado es el precio de la tabla de intercambios para el formato de esta liga: dinastía o redraft, 1QB o superflex, número de equipos y PPR. El valor de liga lo ajusta según la puntuación propia de esta liga, como un premio real para tight ends, y el cambio total se queda entre la mitad y el doble del precio de mercado. La letra se califica con el valor de liga; cada activo de esta lista muestra su cambio y la regla que lo explica.',
    },
  },
  tradeRosterFit: {
    en: {
      title: 'Your roster fit',
      body: 'The same deal re-priced for your roster. A player who fills a starting slot you would otherwise leave open is worth more to you, most of all when the waiver wire has nobody at that position; sending a starter the deal doesn’t replace costs more, and sending surplus depth costs a little less. It’s a second calculation beside the grade: it never changes the letter, and it isn’t a win probability.',
    },
    es: {
      title: 'Encaje en tu plantilla',
      body: 'El mismo intercambio, revalorado para tu plantilla. Un jugador que cubre un puesto titular que quedaría vacío vale más para ti, sobre todo si no hay nadie en esa posición en waivers; enviar a un titular que el intercambio no reemplaza cuesta más, y enviar profundidad sobrante cuesta un poco menos. Es un segundo cálculo junto a la calificación: nunca cambia la letra y no es una probabilidad de ganar.',
    },
  },
  tradeAfThisWeek: {
    en: {
      title: 'AF this week',
      body: 'AllFantasy’s own projection for this week, adjusted to this league’s scoring and added up over the players on this side that have one. Picks, FAAB and players without a projection add nothing. It’s shown for context and never feeds the grade.',
    },
    es: {
      title: 'AF esta semana',
      body: 'La proyección propia de AllFantasy para esta semana, ajustada a la puntuación de esta liga y sumada sobre los jugadores de este lado que la tienen. Las selecciones, el FAAB y los jugadores sin proyección no suman nada. Se muestra como contexto y nunca entra en la calificación.',
    },
  },
  tradeProductionLean: {
    en: {
      title: 'Asset production lean',
      body: 'Whose players project for more combined fantasy points this week, scored for this league where its rules are known; within 1 point is even. It counts every player in the deal, not only starters, so it isn’t a lineup change or a win forecast, and one player with no projection makes it Unavailable. League value lean is which side receives more league value: the same direction as the letter.',
    },
    es: {
      title: 'Ventaja en rendimiento de activos',
      body: 'Qué jugadores proyectan más puntos de fantasy combinados esta semana, con la puntuación de esta liga cuando se conocen sus reglas; dentro de 1 punto es empate. Cuenta a todos los jugadores del intercambio, no solo a los titulares, así que no es un cambio de alineación ni un pronóstico de victoria, y un solo jugador sin proyección la deja en «No disponible». La ventaja en valor de liga es qué lado recibe más valor de liga: la misma dirección que la letra.',
    },
  },
  tradeValueAlerts: {
    en: {
      title: 'Value change alerts',
      body: 'Players on your roster in this league whose market value moved over the last 30 days, read from daily value snapshots. A move smaller than 1% of the player’s value isn’t listed, and at most the 10 biggest are shown. The change is read from the dynasty one-QB value series, whatever this league’s format.',
    },
    es: {
      title: 'Alertas de cambios de valor',
      body: 'Jugadores de tu plantilla en esta liga cuyo valor de mercado cambió en los últimos 30 días, según capturas diarias de valor. Un cambio menor al 1% del valor del jugador no aparece, y se muestran como mucho los 10 mayores. El cambio se lee de la serie de valores de dinastía con un QB, sea cual sea el formato de esta liga.',
    },
  },
  tradeTimeline: {
    en: {
      title: 'Unified trade timeline',
      body: '“Then” is the grade saved when an offer was made; where none was saved it repeats today’s grade or shows a dash. “Now” is today’s. The number under each is net value: what you receive minus what you send. A row showing each team’s letter instead is a completed trade: it keeps the grade it was given, and “Today” appears beside it only when today’s values would give a different letter. The number beside an asset is the value that row’s grade used.',
    },
    es: {
      title: 'Historial de intercambios',
      body: '«Antes» es la calificación guardada cuando se hizo la oferta; si no se guardó ninguna, repite la de hoy o muestra un guion. «Ahora» es la de hoy. El número debajo de cada una es el valor neto: lo que recibes menos lo que envías. Una fila que muestra la letra de cada equipo es un intercambio completado: conserva la calificación que recibió, y «Hoy» aparece a su lado solo si los valores de hoy darían otra letra. El número junto a un activo es el valor que usó la calificación de esa fila.',
    },
  },
  tradePartnerFit: {
    en: {
      title: 'Partner fit',
      body: 'A 0–100 score from four checks: they have a spare player, not one of their starters, who would upgrade one of your weakest starting spots (35%); you have one for them (25%); a value-matched deal can be built from those spares (25%, higher the closer it is, none past 35% apart); and how often they trade, and whether they have traded with you (15%). A check that can’t be measured is left out rather than scored as zero. 70+ is a Strong fit, 50+ Good, 30+ Possible, below that Weak.',
    },
    es: {
      title: 'Encaje del socio',
      body: 'Una puntuación de 0 a 100 con cuatro comprobaciones: tiene un jugador sobrante, no uno de sus titulares, que mejoraría uno de tus puestos titulares más débiles (35%); tú tienes uno para él (25%); con esos sobrantes se puede armar un intercambio de valor parejo (25%, más alto cuanto más cerca, ninguno con más de 35% de diferencia); y cuánto intercambia, y si lo ha hecho contigo (15%). Una comprobación que no se puede medir se deja fuera en lugar de contar como cero. 70+ es Encaje fuerte, 50+ Buen encaje, 30+ Encaje posible y, por debajo, Encaje débil.',
    },
  },
  tradeFinderMatches: {
    en: {
      title: 'Trade Finder',
      body: 'One-for-one swaps where your spare player fills an open or weakest starting slot on their team, and theirs does the same on yours. “% apart” is the market-value gap as a share of the larger value; only swaps within 20% are suggested, or within 30 ADP spots when one side has no market value. These are starting points, not grades: build one in the trade builder to grade it.',
    },
    es: {
      title: 'Trade Finder',
      body: 'Intercambios uno por uno en los que tu jugador sobrante cubre un puesto titular vacío o el más débil de su equipo, y el suyo hace lo mismo en el tuyo. «% de diferencia» es la diferencia de valor de mercado como parte del valor mayor; solo se sugieren intercambios dentro del 20%, o dentro de 30 puestos de ADP cuando un lado no tiene valor de mercado. Son puntos de partida, no calificaciones: arma uno en el constructor de intercambios para calificarlo.',
    },
  },
  tradeEvidence: {
    en: {
      title: 'Dated, mixed or limited evidence',
      body: 'How good the price evidence is, not the odds the trade works out. Dated: every asset is priced from a dated source with nothing flagged. Mixed: everything is priced but something is flagged, such as a source more than 7 days old, a price from an estimate or formula, a value that isn’t a market quote, or a source or date that wasn’t recorded. Limited: an asset has no value, or no price carries a date.',
    },
    es: {
      title: 'Datos con fecha, mixtos o limitados',
      body: 'Qué tan buenos son los datos de precio, no las probabilidades de que el intercambio salga bien. Con fecha: cada activo tiene precio de una fuente con fecha y no hay nada señalado. Mixtos: todo tiene precio, pero algo está señalado, como una fuente de más de 7 días, un precio de una estimación o fórmula, un valor que no es una cotización de mercado, o una fuente o fecha sin registrar. Limitados: algún activo no tiene valor, o ningún precio tiene fecha.',
    },
  },
  completedTradeGrade: {
    en: {
      title: 'A completed trade’s grade',
      body: 'A completed trade keeps the grade it was given; it isn’t re-graded every time values move. The note with the grade says which day’s values priced it, and a number beside an asset is the value that grade used for it.',
    },
    es: {
      title: 'La calificación de un intercambio completado',
      body: 'Un intercambio completado conserva la calificación que recibió; no se vuelve a calificar cada vez que cambian los valores. La nota junto a la calificación indica con qué día de valores se calculó, y el número junto a un activo es el valor que usó esa calificación.',
    },
  },
  tradeIdeas: {
    en: {
      title: 'Trade ideas',
      body: 'Suggested overnight and shown only to you; nothing is sent. A deal is suggested only when it grades C for both teams (within 10% on this league’s values) and each roster comes out ahead on its own roster fit. “+X%” is how far ahead each roster comes out on that fit. At most three a night per league.',
    },
    es: {
      title: 'Ideas de intercambio',
      body: 'Se sugieren durante la noche y solo las ves tú; no se envía nada. Un intercambio solo se sugiere si recibe C para ambos equipos (dentro del 10% en los valores de esta liga) y cada plantilla sale ganando según su propio encaje. «+X%» es cuánto sale ganando cada plantilla en ese encaje. Como máximo tres por noche en cada liga.',
    },
  },
} satisfies Record<string, HelpTopic>
