const en = {
  title: "My Brackets", subtitle: "Your saved brackets and leagues, across every season. Open any bracket to continue where you left off.",
  back: "Brackets home", open: "Open bracket", league: "League dashboard", draft: "Draft", finalized: "Finalized", saved: "picks saved",
  empty: "No saved brackets yet", emptyBody: "Create a bracket league or join your friends. Your saved picks will appear here.",
  noEntry: "You created this league but haven’t made a bracket yet. Open the league to get started.",
  create: "Create a bracket league", join: "Join with code", error: "Your brackets could not load. Please try again.", retry: "Try again",
  sports: { ncaaf: "College Football Playoff", nba_cup: "NBA Cup", nba: "NBA Playoffs", nhl: "NHL Playoffs", mlb: "MLB Postseason" },
}
const es: typeof en = {
  title: "Mis cuadros", subtitle: "Tus cuadros y ligas guardados, de todas las temporadas. Abre un cuadro para continuar donde lo dejaste.",
  back: "Inicio de cuadros", open: "Abrir cuadro", league: "Panel de la liga", draft: "Borrador", finalized: "Finalizado", saved: "selecciones guardadas",
  empty: "Aún no tienes cuadros guardados", emptyBody: "Crea una liga de cuadros o únete a tus amigos. Tus selecciones guardadas aparecerán aquí.",
  noEntry: "Creaste esta liga pero aún no tienes un cuadro. Abre la liga para empezar.",
  create: "Crear liga de cuadros", join: "Unirse con código", error: "No se pudieron cargar tus cuadros. Inténtalo de nuevo.", retry: "Reintentar",
  sports: { ncaaf: "Playoff de fútbol universitario", nba_cup: "NBA Cup", nba: "Playoffs de la NBA", nhl: "Playoffs de la NHL", mlb: "Postemporada de MLB" },
}
export const myBracketsCopy = (language?: string) => language?.startsWith("es") ? es : en
