/**
 * English → Spanish for the poll composer's prediction and results options, the poll card's
 * prediction states and the Prediction Leaderboard. Kept in its own block (not the shared i18n
 * files) so this feature's strings travel with it. Missing keys fall back to English.
 */

const ES: Record<string, string> = {
  'Ask a question': 'Hacer una pregunta',
  'Predict a matchup': 'Predecir un partido',
  'No deadline': 'Sin límite',
  'Show results': 'Mostrar resultados',
  Live: 'En vivo',
  'After it closes': 'Al cerrar',
  'Pick a matchup — the poll closes at kickoff and settles itself when the game is final.':
    'Elige un partido: la encuesta cierra al inicio y se resuelve sola cuando termina.',
  'No matchups left to predict this week.': 'No quedan partidos por predecir esta semana.',
  'Prediction polls are available in AllFantasy leagues.': 'Las encuestas de predicción están disponibles en ligas de AllFantasy.',
  'Loading matchups…': 'Cargando partidos…',
  'Already posted': 'Ya publicada',
  'Post prediction': 'Publicar predicción',
  Posting: 'Publicando',
  'Could not post the prediction.': 'No se pudo publicar la predicción.',
  'Results show when the poll closes': 'Los resultados se muestran al cerrar la encuesta',
  'Prediction · closes at kickoff': 'Predicción · cierra al inicio',
  'Correct pick': 'Acierto',
  'Ended in a tie — no points': 'Terminó en empate: sin puntos',
  'Prediction Leaderboard': 'Tabla de predicciones',
  'One point for every correct pick this season.': 'Un punto por cada acierto esta temporada.',
  'No predictions have been settled yet. Post one from the league chat poll button.':
    'Aún no hay predicciones resueltas. Publica una desde el botón de encuesta del chat de la liga.',
  Manager: 'Mánager',
  Points: 'Puntos',
  Picks: 'Picks',
}

export function predictionCopy(english: string, language: string | null | undefined): string {
  if (language !== 'es') return english
  return ES[english] ?? english
}
