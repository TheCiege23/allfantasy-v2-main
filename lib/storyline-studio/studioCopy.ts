/**
 * English → Spanish for the Storyline Studio card. Its own block, so this feature's strings travel
 * with it. Spanish uses «reclamo» for waiver concepts, never «waiver».
 */
const ES: Record<string, string> = {
  'Storyline Studio': 'Estudio de historias',
  'Fact-based trash talk for this week’s matchups, built from your league’s own results. Every number comes from your league’s data.':
    'Picante con datos para los partidos de esta semana, hecho con los resultados de tu liga. Cada número sale de los datos de tu liga.',
  'Storyline Studio is part of AF Commissioner.': 'El Estudio de historias es parte de AF Commissioner.',
  'Weekly rivalry records, revenge games, draft steals and more — ready to post or copy into your league chat.':
    'Rivalidades, partidos de venganza, robos del draft y más, listos para publicar o copiar en el chat de tu liga.',
  'Get AF Commissioner': 'Obtener AF Commissioner',
  'Loading storylines…': 'Cargando historias…',
  'Could not load storylines.': 'No se pudieron cargar las historias.',
  'No head-to-head games this week, and nothing league-wide to say yet.':
    'No hay partidos cara a cara esta semana y todavía no hay nada que contar de la liga.',
  'No storyline for this matchup yet — there is no history between these teams in the data.':
    'Aún no hay historia para este partido: no hay historial entre estos equipos en los datos.',
  'League-wide': 'Toda la liga',
  Week: 'Semana',
  Copy: 'Copiar',
  Copied: 'Copiado',
  'Post to league chat': 'Publicar en el chat de la liga',
  Posted: 'Publicado',
  'Add poll': 'Agregar encuesta',
  'Poll added': 'Encuesta agregada',
  Tone: 'Tono',
  Template: 'Plantilla',
  Announcer: 'Narrador',
  'Trash talk': 'Picante',
  Neutral: 'Neutral',
  'Rewriting…': 'Reescribiendo…',
  'The AI rewrite did not hold to the facts, so the template is shown instead.':
    'La reescritura con IA no se ajustó a los datos, así que se muestra la plantilla.',
  'Auto-post storylines': 'Publicar historias automáticamente',
  'Once a week, the top storyline goes into the league chat at the time you choose.':
    'Una vez por semana, la mejor historia se publica en el chat de la liga a la hora que elijas.',
  'Auto-post is available in AllFantasy leagues. For leagues on Sleeper/ESPN/etc., copy and paste the storyline into your league chat.':
    'La publicación automática está disponible en ligas de AllFantasy. Para ligas en Sleeper/ESPN/etc., copia y pega la historia en el chat de tu liga.',
  'Include a prediction poll': 'Incluir una encuesta de predicción',
  Day: 'Día',
  Time: 'Hora',
  'Saved.': 'Guardado.',
  'Could not save.': 'No se pudo guardar.',
  'Could not post.': 'No se pudo publicar.',
  'Edit before posting': 'Edita antes de publicar',
  'Sources:': 'Fuentes:',
  'Last auto-post:': 'Última publicación automática:',
}

export function studioCopy(english: string, language: string | null | undefined): string {
  if (language !== 'es') return english
  return ES[english] ?? english
}

export const WEEKDAY_NAMES: Record<'en' | 'es', string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
}
