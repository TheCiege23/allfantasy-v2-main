/**
 * The Finder's follow surfaces (2026-10-08): the "Alert me" button on the open card and the
 * "Following" board on the "My players" home. Pure, client-safe; English and Spanish.
 */

export type FollowCopy = {
  off: string
  on: string
  startLabel: (name: string) => string
  stopLabel: (name: string) => string
  followedNote: (name: string) => string
  limit: string
  failed: string
  // ── The "My players" home ──────────────────────────────────────────────
  homeTitle: string
  homeSub: string
  boardTitle: string
  boardEmpty: string
  freeIn: (league: string) => string
  freeMore: (n: number) => string
  more: (n: number) => string
  statusUnavailable: string
}

const EN: FollowCopy = {
  off: 'Alert me',
  on: 'Following',
  startLabel: (n) => `Alert me about ${n}: news, and when he is free in one of your leagues`,
  stopLabel: (n) => `Stop following ${n}`,
  followedNote: (n) => `We'll tell you when ${n} has news, or is free to claim in one of your leagues.`,
  limit: "You're following the most players you can — unfollow one first.",
  failed: "Couldn't save that. Try again.",
  homeTitle: 'My players',
  homeSub: 'Who is flagged today, who you roster most, and who you follow.',
  boardTitle: 'Following',
  boardEmpty: 'Open any player and tap “Alert me” to follow him. You will hear when he has news or is free in one of your leagues.',
  freeIn: (l) => `Free in ${l}`,
  freeMore: (n) => `+${n}`,
  more: (n) => `+${n} more you follow`,
  statusUnavailable: 'Status unavailable right now — the injury feed has not updated.',
}

const ES: FollowCopy = {
  off: 'Avísame',
  on: 'Siguiendo',
  startLabel: (n) => `Avísame sobre ${n}: noticias, y cuándo está libre en una de tus ligas`,
  stopLabel: (n) => `Dejar de seguir a ${n}`,
  followedNote: (n) => `Te avisaremos cuando ${n} tenga noticias o esté libre en una de tus ligas.`,
  limit: 'Ya sigues el máximo de jugadores: deja de seguir a uno primero.',
  failed: 'No se pudo guardar. Inténtalo de nuevo.',
  homeTitle: 'Mis jugadores',
  homeSub: 'Quién está en duda hoy, a quién tienes más y a quién sigues.',
  boardTitle: 'Seguidos',
  boardEmpty: 'Abre cualquier jugador y toca «Avísame» para seguirlo. Te avisaremos cuando tenga noticias o esté libre en una de tus ligas.',
  freeIn: (l) => `Libre en ${l}`,
  freeMore: (n) => `+${n}`,
  more: (n) => `+${n} más que sigues`,
  statusUnavailable: 'Estado no disponible ahora: el parte de lesiones no se ha actualizado.',
}

export function followCopy(language: string): FollowCopy {
  return language === 'es' ? ES : EN
}
