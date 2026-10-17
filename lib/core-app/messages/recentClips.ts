import { defineMessages } from '@/lib/i18n/messages'

/**
 * Recent clips (components/core-app/highlights/RecentClips.tsx). Every string is the one the feed
 * printed before the move, byte for byte, in both languages — this is a relocation, not a rewrite.
 */
export const recentClipsMessages = defineMessages({
  en: {
    xPosts: 'X posts',
    matchNote: 'Matched by full name or verified handle in the caption; this does not confirm who appears in the video.',
    show: 'Show',
    allClips: 'All clips',
    plays: 'Plays',
    interviewsCommentary: 'Interviews & commentary',
    loadFailed: 'Clips could not be loaded.',
    retry: 'Retry',
    finding: 'Finding recent clips…',
    unavailable: 'The clip feed is temporarily unavailable.',
    noMatches: 'No matching clips from the last 24 hours.',
    kindPlay: 'Play',
    kindInterview: 'Interview',
    kindCommentary: 'Commentary',
    feedChecked: 'Feed checked',
    hourlyRefresh: 'Hourly pilot refresh',
    privacyNote: 'Loading a post shares browser data with X. Some videos only play on X.',
    xPrivacy: 'X privacy',
  },
  es: {
    xPosts: 'Publicaciones de X',
    matchNote: 'Coincidencias por nombre o usuario verificado en el texto; no confirman quién aparece en el video.',
    show: 'Mostrar',
    allClips: 'Todos los clips',
    plays: 'Jugadas',
    interviewsCommentary: 'Entrevistas y comentarios',
    loadFailed: 'No se pudieron cargar los clips.',
    retry: 'Reintentar',
    finding: 'Buscando clips recientes…',
    unavailable: 'El feed de clips no está disponible temporalmente.',
    noMatches: 'No hay clips coincidentes de las últimas 24 horas.',
    kindPlay: 'Jugada',
    kindInterview: 'Entrevista',
    kindCommentary: 'Comentario',
    feedChecked: 'Feed actualizado',
    hourlyRefresh: 'Actualización cada hora',
    privacyNote: 'Al cargar una publicación, X recibe datos del navegador. Algunos videos solo se reproducen en X.',
    xPrivacy: 'Privacidad de X',
  },
})
