import { defineMessages } from '@/lib/i18n/messages'

/**
 * "This screen's data did not load" (components/core-app/ScreenLoadError.tsx). A server component, so
 * it reads this with `messagesFor(…, language)` and the language page.tsx passes it.
 * Every string is the one the component wrote before the move, byte for byte, in both languages — a
 * relocation, not a rewrite. The screen name arrives already through `coreUiCopy`.
 */
export const screenLoadErrorMessages = defineMessages({
  en: {
    title: (name: string) => `${name} did not load`,
    body: 'Something failed on our side while reading this league. Your league and its settings are untouched — nothing has changed.',
  },
  es: {
    title: (name) => `${name}: no se pudo cargar`,
    body: 'Algo falló de nuestra parte al leer esta liga. Tu liga y su configuración no se han tocado: no cambió nada.',
  },
})
