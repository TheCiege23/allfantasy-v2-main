const en = {
  title: "Your games, your race, your next move", eyebrow: "Chimmy · your bracket companion",
  tonight: "My games tonight", rooting: "Who to root for", compare: "Compare brackets", recap: "My recap", paths: "Qualification scenarios",
  facts: "Show matchup facts", analysis: "Ask Chimmy for full analysis", adviceTitle: "A grounded read before you pick", loading: "Loading…", working: "Working…",
  adviceIntro: "Compare verified form, season records, time between games, current injury reports and tournament stakes.",
  price: "Full analysis uses your existing coaching access. Any token cost is shown for approval before use.",
  noAutomaticPicks: "A recommendation never changes or finalizes your picks automatically. Official game locks still apply.",
  sources: "Sources and uncertainty", signin: "Sign in", signinBody: "to see your picks, personal recap and locked-pick comparisons.",
  privacy: "Only finalized picks for games that have locked are revealed. Future picks and drafts stay private.",
  draft: "Your bracket is a draft. Finalize eligible picks before their games start to earn points.",
  nextLocks: "Next locks", calendar: "Add calendar reminder", fewer: "Show fewer games", fullSlate: (n: number) => `Show all ${n} games tonight`,
  matchup: "Matchup facts & Chimmy", close: "Close matchup analysis", review: "Review pick →", copy: "Copy my recap",
}
const es: typeof en = {
  title: "Tus partidos, tu posición, tu siguiente paso", eyebrow: "Chimmy · tu asistente de brackets",
  tonight: "Mis partidos de hoy", rooting: "A quién apoyar", compare: "Comparar brackets", recap: "Mi resumen", paths: "Escenarios de clasificación",
  facts: "Ver datos del partido", analysis: "Pedir análisis completo a Chimmy", adviceTitle: "Datos verificados antes de elegir", loading: "Cargando…", working: "Analizando…",
  adviceIntro: "Compara resultados verificados, récords, tiempo entre partidos, reportes actuales de lesiones y lo que está en juego.",
  price: "El análisis usa tu acceso de coaching actual. Cualquier costo en tokens se muestra para tu aprobación antes de usarlos.",
  noAutomaticPicks: "Una recomendación nunca cambia ni finaliza tus selecciones automáticamente. Se respetan los bloqueos oficiales.",
  sources: "Fuentes e incertidumbre", signin: "Iniciar sesión", signinBody: "para ver tus selecciones, resumen y comparaciones de selecciones bloqueadas.",
  privacy: "Solo se muestran selecciones finalizadas de partidos bloqueados. Las futuras selecciones y los borradores son privados.",
  draft: "Tu bracket es un borrador. Finaliza las selecciones elegibles antes de que empiecen sus partidos para ganar puntos.",
  nextLocks: "Próximos bloqueos", calendar: "Añadir recordatorio al calendario", fewer: "Ver menos partidos", fullSlate: (n: number) => `Ver los ${n} partidos de hoy`,
  matchup: "Datos del partido y Chimmy", close: "Cerrar análisis del partido", review: "Revisar selección →", copy: "Copiar mi resumen",
}
export function bracketCoachCopy(language: string) { return ({ en, es } as Record<string, typeof en>)[language] ?? en }
