import { defineMessages } from '@/lib/i18n/messages'

/**
 * Auction bid ladder (components/app/draft-room/AuctionBidLadder.tsx): the accepted bids for the
 * player on the block and for each recently sold player, newest first.
 */
export const auctionBidLadderMessages = defineMessages({
  en: {
    title: 'Bid history',
    aria: (player: string) => `Bid history for ${player}`,
    show: (n: number) => `${n} ${n === 1 ? 'bid' : 'bids'}`,
    /** BCP 47 tag for the bid times. */
    timeLocale: 'en-US',
  },
  es: {
    title: 'Historial de pujas',
    aria: (player: string) => `Historial de pujas por ${player}`,
    show: (n: number) => `${n} ${n === 1 ? 'puja' : 'pujas'}`,
    timeLocale: 'es',
  },
})
