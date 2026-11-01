import { defineMessages } from '@/lib/i18n/messages'

/**
 * English and Spanish for the Survivor Commissioner Hub's tab labels and panel titles/subtitles.
 *
 * Lookup-only on purpose: several agents add tabs to SurvivorCommissionerDashboard.tsx, so the
 * dashboard keeps its English strings where they are and asks this catalog for a translation. A tab
 * or panel nobody has translated yet falls back to its own English text — never blank, never a key.
 */
export const survivorHubTabMessages = defineMessages({
  en: {
    tab: (_id: string, fallback: string): string => fallback,
    text: (english: string): string => english,
  },
  es: {
    tab: (id: string, fallback: string): string => ({
      overview: 'Resumen', operations: 'Operaciones', tribes: 'Tribus', tribal: 'Consejo de eliminación', governance: 'Reglas y conducta',
      minigames: 'Minijuegos', rewards: 'Recompensas', exile: 'Isla del Exilio', jury: 'Jurado', settings: 'Ajustes',
      chat: 'Comunicaciones', ai: 'IA y automatización', premium: 'Inteligencia premium', subscription: 'Acceso · Fichas', history: 'Historial',
    } as Record<string, string>)[id] ?? fallback,
    text: (english: string): string => HUB_TEXT_ES[english] ?? english,
  },
})

/** Panel titles and subtitles, keyed by the dashboard's own English text. */
const HUB_TEXT_ES: Record<string, string> = {
  'Quick links': 'Accesos rápidos',
  'Tribal councils, challenges, @Chimmy, and exile — all wired to your sport.': 'Consejos tribales, retos, @Chimmy y el Exilio, todo conectado a tu deporte.',
  'Immunity & deadlines': 'Inmunidad y plazos',
  'Engine-driven — updates as councils and challenges lock.': 'Lo lleva el motor: se actualiza a medida que se cierran consejos y retos.',
  'League health': 'Estado de la liga',
  'Live readiness signals from the league database.': 'Señales de preparación en vivo desde la base de datos de la liga.',
  'Draft & trades': 'Draft e intercambios',
  'Current status and review workload.': 'Estado actual y revisiones pendientes.',
  'Fix a problem': 'Arreglar un problema',
  'Score corrections, a manager who quit, or an early merge.': 'Correcciones de puntuación, un mánager que abandonó o una fusión anticipada.',
  'Private idol oversight': 'Supervisión privada de ídolos',
  'Visible only to a non-playing host. Managers see only their own idols.': 'Solo visible para un anfitrión que no juega. Cada mánager ve solo sus propios ídolos.',
  Tribes: 'Tribus',
  'Roster-based tribe assignment runs after the startup draft completes.': 'El reparto de tribus por plantilla se hace cuando termina el draft inicial.',
  'Rules & conduct': 'Reglas y conducta',
  'Conduct strikes, Rooks vs Vets and tribe swaps.': 'Faltas de conducta, Novatos contra Veteranos e intercambios de tribu.',
  'Mini games': 'Minijuegos',
  'Challenges pull real sport schedules for the active week — see Challenges hub.': 'Los retos usan los calendarios reales de la semana activa; mira el centro de Retos.',
  Rewards: 'Recompensas',
  'Grant, reverse and settle pending reward choices.': 'Concede, anula y resuelve las elecciones de recompensa pendientes.',
  'Exile Island': 'Isla del Exilio',
  'Hidden side competition — exile league links on create.': 'Competición paralela oculta: los enlaces de la liga del Exilio aparecen al crearla.',
  Jury: 'Jurado',
  'Jury phase and finale votes — see Jury hub.': 'Fase del jurado y votos de la final; mira el centro del Jurado.',
  'Survivor settings': 'Ajustes de Survivor',
  'Use league settings — Survivor panels are under the specialty format.': 'Usa los ajustes de la liga: los paneles de Survivor están en el formato especial.',
  Communications: 'Comunicaciones',
  'Island chat, tribe threads, jury, and exile channels.': 'Chat de la isla, hilos de tribu, jurado y canales del Exilio.',
  'AI & automation': 'IA y automatización',
  '@Chimmy ingests votes, timestamps picks, and posts official results.': '@Chimmy recoge los votos, registra la hora de las elecciones y publica los resultados oficiales.',
  'History / archive': 'Historial / archivo',
  'Recent Survivor audit events.': 'Eventos de auditoría recientes de Survivor.',
}
