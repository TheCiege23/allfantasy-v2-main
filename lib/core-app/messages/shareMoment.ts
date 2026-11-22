import { defineMessages } from '@/lib/i18n/messages'

/**
 * The share-a-moment button (components/core-app/screens/ShareMomentButton.tsx). Every string is the
 * one the button printed before the move, byte for byte, in both languages — a relocation, not a
 * rewrite. A `label` the caller passes is still the caller's to translate.
 */
export const shareMomentMessages = defineMessages({
  en: {
    building: 'Building card…',
    saved: 'Card saved ✓',
    shared: 'Shared ✓',
    retry: 'Retry share',
    share: 'Share',
  },
  es: {
    building: 'Creando tarjeta…',
    saved: 'Tarjeta guardada ✓',
    shared: 'Compartida ✓',
    retry: 'Reintentar',
    share: 'Compartir',
  },
})
