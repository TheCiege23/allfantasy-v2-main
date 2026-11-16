/**
 * English + Spanish copy for app-wide music: the chat panel's Music tab
 * (components/app-music/MusicPanel.tsx), the corner player and the draft-room
 * launcher (components/app-music/AppMusicDock.tsx). Same shape as
 * trade-settings-copy.ts: components read the language through
 * `useOptionalLanguage()`, and anything that is not Spanish reads English.
 *
 * ⚠ THE ENGINE NEVER STORES A SENTENCE. AppMusicDock publishes Apple's messages
 * as a code (`AppleMsg` in musicBus) and the Music tab turns the code into words,
 * so switching language changes a message already on screen instead of leaving
 * it in the language it was raised in.
 */
type AppMusicLang = 'en' | 'es'

export function appMusicLang(language: string | null | undefined): AppMusicLang {
  return String(language ?? '').toLowerCase().startsWith('es') ? 'es' : 'en'
}

export const APP_MUSIC_COPY = {
  notHere: { en: 'Music isn’t available on this page.', es: 'La música no está disponible en esta página.' },
  nowPlaying: { en: 'Now playing', es: 'Sonando ahora' },
  stop: { en: 'Stop', es: 'Detener' },
  previousTrack: { en: 'Previous track', es: 'Canción anterior' },
  nextTrack: { en: 'Next track', es: 'Siguiente canción' },
  unknownTrack: { en: 'Unknown track', es: 'Canción desconocida' },
  pause: { en: 'Pause', es: 'Pausa' },
  play: { en: 'Play', es: 'Reproducir' },
  musicSource: { en: 'Music source', es: 'Fuente de música' },
  search: { en: 'Search', es: 'Buscar' },
  searching: { en: 'Searching…', es: 'Buscando…' },
  clear: { en: 'Clear', es: 'Borrar' },
  resultsFor: { en: 'Results for', es: 'Resultados para' },
  nothingFound: { en: 'Nothing found for “{{q}}”.', es: 'No se encontró nada para “{{q}}”.' },
  keepsPlaying: {
    en: 'Keeps playing when you close chat or change pages. YouTube shrinks to a small box; Apple Music plays hidden.',
    es: 'Sigue sonando cuando cierras el chat o cambias de página. YouTube se reduce a un recuadro pequeño; Apple Music suena oculto.',
  },

  // YouTube
  searchYouTube: { en: 'Search YouTube', es: 'Buscar en YouTube' },
  ytSignIn: { en: 'Sign in to search YouTube.', es: 'Inicia sesión para buscar en YouTube.' },
  ytLimitUser: {
    en: 'You’ve used today’s YouTube searches. Stations and pasted links still work.',
    es: 'Ya usaste tus búsquedas de YouTube de hoy. Las estaciones y los enlaces pegados siguen funcionando.',
  },
  ytLimitApp: {
    en: 'YouTube search is resting until tomorrow. Stations and pasted links still work.',
    es: 'La búsqueda de YouTube descansa hasta mañana. Las estaciones y los enlaces pegados siguen funcionando.',
  },
  ytBroken: {
    en: 'YouTube search isn’t working right now. Stations and pasted links still work.',
    es: 'La búsqueda de YouTube no funciona en este momento. Las estaciones y los enlaces pegados siguen funcionando.',
  },
  pasteLink: {
    en: 'Or paste any YouTube song or playlist link',
    es: 'O pega el enlace de cualquier canción o lista de YouTube',
  },
  yourLink: { en: 'Your YouTube link', es: 'Tu enlace de YouTube' },
  linkIsMix: {
    en: 'That’s a YouTube Mix, which only plays on YouTube. Paste a song or a playlist link instead.',
    es: 'Ese es un Mix de YouTube, que solo se reproduce en YouTube. Pega el enlace de una canción o de una lista.',
  },
  linkNotYouTube: {
    en: 'That isn’t a YouTube video or playlist link.',
    es: 'Ese no es un enlace de un video ni de una lista de YouTube.',
  },

  // Apple Music
  appleChecking: { en: 'Checking Apple Music…', es: 'Revisando Apple Music…' },
  appleUnavailable: {
    en: 'Apple Music isn’t set up yet. YouTube works for everyone.',
    es: 'Apple Music todavía no está configurado. YouTube funciona para todos.',
  },
  appleLoadFailed: { en: 'Apple Music didn’t load.', es: 'Apple Music no cargó.' },
  tryAgain: { en: 'Try again', es: 'Intentar de nuevo' },
  searchApple: { en: 'Search Apple Music', es: 'Buscar en Apple Music' },
  playlist: { en: 'Playlist', es: 'Lista' },
  song: { en: 'Song', es: 'Canción' },
  disconnectApple: { en: 'Disconnect Apple Music', es: 'Desconectar Apple Music' },
  connectApple: { en: 'Connect Apple Music', es: 'Conectar Apple Music' },
  reopenAppleSignIn: { en: 'Open Apple sign-in again', es: 'Abrir de nuevo el inicio de sesión de Apple' },
  appleConnecting: {
    en: 'Finish signing in on Apple’s window, including any “Allow” step. Closed it? Press the button again.',
    es: 'Termina de iniciar sesión en la ventana de Apple, incluido cualquier paso de “Permitir”. ¿La cerraste? Vuelve a pulsar el botón.',
  },
  appleSearchAnytime: {
    en: 'Search anytime. To play, connect Apple Music.',
    es: 'Busca cuando quieras. Para reproducir, conecta Apple Music.',
  },
  // ⚠ SAY IT BEFORE THE CLICK. Measured 2026-11-15 with an Apple ID that has no
  // subscription: Connect does not sign in at all — Apple sends the person to its
  // own "subscribe" page (music.apple.com/deeplink?p=subscribe).
  subscriptionNote: {
    en: 'For Apple Music subscribers. Without a subscription, Apple will offer you one instead of playing. That’s Apple’s rule, not ours.',
    es: 'Para suscriptores de Apple Music. Sin suscripción, Apple te ofrecerá una en lugar de reproducir. Es una regla de Apple, no nuestra.',
  },
  appleConnectFailed: {
    en: 'Apple Music didn’t connect. If Apple showed you a “subscribe” page, this Apple ID doesn’t have an Apple Music subscription, so it can’t play here. YouTube works without one.',
    es: 'Apple Music no se conectó. Si Apple te mostró una página para “suscribirte”, este Apple ID no tiene suscripción a Apple Music, así que no puede reproducir aquí. YouTube funciona sin una.',
  },
  appleSearchFailed: { en: 'Search didn’t work. Try again.', es: 'La búsqueda no funcionó. Inténtalo de nuevo.' },
  applePlayFailed: { en: 'That didn’t play.', es: 'Eso no se reprodujo.' },

  // Corner player and draft-room launcher
  playerRegion: { en: 'YouTube music player', es: 'Reproductor de música de YouTube' },
  change: { en: 'Change', es: 'Cambiar' },
  stopMusic: { en: 'Stop music', es: 'Detener la música' },
  onYouTube: { en: '{{label}} on YouTube', es: '{{label}} en YouTube' },
  launcherLabel: { en: 'Music while you draft', es: 'Música mientras haces tu draft' },
  playMusic: { en: 'Play music', es: 'Poner música' },
} as const satisfies Record<string, Record<AppMusicLang, string>>

export type AppMusicCopyKey = keyof typeof APP_MUSIC_COPY

export function appMusicCopy(
  lang: AppMusicLang,
  key: AppMusicCopyKey,
  vars: Record<string, string | number> = {},
): string {
  return APP_MUSIC_COPY[key][lang].replace(/\{\{(\w+)\}\}/g, (_, k: string) => (k in vars ? String(vars[k]) : ''))
}

/**
 * Apple quick-search chips. The chip IS the search, so the Spanish chips search
 * Apple's catalog in Spanish rather than showing one word and sending another.
 */
export const APPLE_QUICK_SEARCHES: Record<AppMusicLang, readonly string[]> = {
  en: ['Game day', 'Hip-hop hits', 'Rock anthems', 'Lo-fi'],
  es: ['Día de juego', 'Éxitos de hip-hop', 'Himnos de rock', 'Lo-fi'],
}

/**
 * Spanish names for the YouTube stations, keyed by station id
 * (`YOUTUBE_STATIONS` in lib/draft-music/youtube.ts). English comes from the
 * station itself. `channel` is given only where the English one is a
 * description rather than a show or channel name — names are not translated.
 * __tests__/app-music/app-music-copy.test.ts fails when a station has no entry.
 */
export const STATION_ES: Record<string, { label: string; channel?: string }> = {
  'game-day': { label: 'Ambiente de día de juego', channel: 'Himnos de estadio' },
  'ff-podcast': { label: 'Podcast de fútbol americano' },
  'fb-podcast': { label: 'Podcast de baloncesto' },
  'mlb-podcast': { label: 'Podcast de béisbol' },
  'nhl-podcast': { label: 'Podcast de hockey' },
  'epl-podcast': { label: 'Podcast de fútbol' },
  'rugby-podcast': { label: 'Podcast de rugby' },
  'golf-podcast': { label: 'Podcast de golf' },
  'nascar-podcast': { label: 'Podcast de NASCAR' },
  'f1-podcast': { label: 'Podcast de F1' },
  'cricket-podcast': { label: 'Podcast de críquet' },
  'esports-podcast': { label: 'Podcast de esports' },
  'lacrosse-podcast': { label: 'Podcast de lacrosse' },
  'hiphop-hype': { label: 'Hip-hop con energía' },
  'rap-workout': { label: 'Rap para entrenar' },
  country: { label: 'Éxitos country' },
  'classic-country': { label: 'Country clásico' },
  rock: { label: 'Éxitos de rock' },
  'classic-rock': { label: 'Rock clásico' },
  pop: { label: 'Éxitos pop' },
  rnb: { label: 'R&B' },
  edm: { label: 'EDM' },
  lofi: { label: 'Ritmos lo-fi' },
}

export function stationText(
  lang: AppMusicLang,
  station: { id: string; label: string; channel: string },
): { label: string; channel: string } {
  if (lang !== 'es') return { label: station.label, channel: station.channel }
  const es = STATION_ES[station.id]
  return { label: es?.label ?? station.label, channel: es?.channel ?? station.channel }
}
