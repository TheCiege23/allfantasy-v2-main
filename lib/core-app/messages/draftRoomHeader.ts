import { defineMessages } from '@/lib/i18n/messages'

/**
 * Room v2 header (2026-11): the one pick pill, Ask Chimmy, the ⋯ room menu's sound row, and the
 * board's on-the-clock tile. Spanish is complete: `__tests__/core-app/message-catalogs-complete.test.ts`
 * fails on a missing key.
 */
export const draftRoomHeaderMessages = defineMessages({
  en: {
    upIn: (n: number): string => (n === 1 ? 'You’re up next' : `You’re up in ${n}`),
    askChimmy: 'Ask Chimmy',
    roomMenu: 'Room menu',
    sound: 'Sound',
    soundOn: 'On',
    soundOff: 'Off',
    soundHint: 'Beeps in the last 10 seconds of a pick',
    onTheClock: 'On the clock',
  },
  es: {
    upIn: (n: number): string => (n === 1 ? 'Te toca después' : `Te toca en ${n}`),
    askChimmy: 'Pregúntale a Chimmy',
    roomMenu: 'Menú de la sala',
    sound: 'Sonido',
    soundOn: 'Activado',
    soundOff: 'Desactivado',
    soundHint: 'Pitidos en los últimos 10 segundos de cada selección',
    onTheClock: 'En el reloj',
  },
})
