import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreLang } from '@/lib/core-app/messages/coreLocale'

const spanish: Record<string, string> = {
  "My Team Highlights": "Videos de mi equipo",
  "Official NFL · YouTube": "NFL oficial · YouTube",
  "Recent clips for your current roster. Team recaps may not feature every player.": "Videos recientes de tu plantilla actual. Los resúmenes de equipo pueden no mostrar a todos los jugadores.",
  "Show": "Mostrar",
  "Highlights roster filter": "Filtrar videos por plantilla",
  "Full roster": "Plantilla completa",
  "Starters": "Titulares",
  "Bench": "Suplentes",
  "Finding highlights…": "Buscando videos…",
  "Refresh highlights": "Actualizar videos",
  "Find team highlights": "Buscar videos del equipo",
  "Highlights could not be loaded. Please try again later.": "No se pudieron cargar los videos. Inténtalo más tarde.",
  "No recent highlights for this roster filter.": "No hay videos recientes para este filtro de plantilla.",
  "Finding highlights loads YouTube thumbnails. Videos open on YouTube in a new tab.": "Buscar videos carga miniaturas de YouTube. Los videos se abren en YouTube en una pestaña nueva.",
  "Privacy": "Privacidad",
  "YouTube Terms": "Términos de YouTube",
  "PLAYER HIGHLIGHT": "JUGADA DEL JUGADOR",
  "TEAM GAME RECAP": "RESUMEN DEL PARTIDO",
  "Watch on YouTube": "Ver en YouTube",
  "HIGHLIGHTS · YouTube": "VIDEOS · YouTube",
  "Try highlights again": "Volver a buscar videos",
  "Find highlights": "Buscar videos",
  "Highlights are available for NFL players first.": "Los videos están disponibles primero para jugadores de la NFL.",
  "Highlights are not available right now.": "Los videos no están disponibles ahora.",
  "No matching highlights in the NFL channel’s recent uploads. Check back after the game.": "No hay videos coincidentes entre las publicaciones recientes del canal de la NFL. Vuelve después del partido.",
  "Highlights are temporarily unavailable. Please try again later.": "Los videos no están disponibles temporalmente. Inténtalo más tarde."
}

const BY_LANG: Partial<Record<'en' | 'es', Record<string, string>>> = { es: spanish }

export function useHighlightCopy() {
  const { language } = useOptionalLanguage()
  const table = BY_LANG[coreLang(language)]
  return { language, copy: (text: string) => table?.[text] ?? text }
}
