import { defineMessages } from '@/lib/i18n/messages'

/**
 * The top-bar language chip (components/core-app/CoreLanguageChip.tsx). Every string is the one the
 * chip wrote before the move, byte for byte, in both languages — a relocation, not a rewrite. Both
 * language names arrive already rendered by `getLanguageDisplayName`.
 */
export const coreLanguageChipMessages = defineMessages({
  en: {
    label: (current: string, next: string) => `Language: ${current}. Switch to ${next}`,
  },
  es: {
    label: (current, next) => `Idioma: ${current}. Cambiar a ${next}`,
  },
})
