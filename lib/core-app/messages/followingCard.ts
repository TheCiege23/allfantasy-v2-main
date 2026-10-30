import { defineMessages } from '@/lib/i18n/messages'

/**
 * The home "Following" card (components/core-app/screens/FollowingCard.tsx). Every string is the one
 * the card printed before the move, byte for byte, in both languages — a relocation, not a rewrite.
 * (The empty-state sentence was JSX text across two lines; this is it as rendered, one space at the break.)
 */
export const followingCardMessages = defineMessages({
  en: {
    title: 'FOLLOWING',
    empty: 'Tap ☆ on any player card to follow him across every league. His status and next game will show here.',
    freeAgentInLeague: (leagueName: string) => `Free agent in ${leagueName} →`,
    freeAgentInLeagues: (count: number) => `Free agent in ${count} of your leagues →`,
    statusesHidden: 'The injury feed can’t answer right now, so statuses are hidden.',
    moreYouFollow: 'more you follow.',
  },
  es: {
    title: 'SEGUIDOS',
    empty: 'Toca ☆ en la ficha de cualquier jugador para seguirlo en todas tus ligas. Aquí verás su estado y su próximo partido.',
    freeAgentInLeague: (leagueName) => `Agente libre en ${leagueName} →`,
    freeAgentInLeagues: (count) => `Agente libre en ${count} de tus ligas →`,
    statusesHidden: 'El parte de lesiones no responde ahora, así que ocultamos los estados.',
    moreYouFollow: 'más que sigues.',
  },
})
