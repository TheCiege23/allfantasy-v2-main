'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { messagesFor, type Catalog, type Messages } from '@/lib/i18n/messages'

/** A message catalog in the reader's language (lib/i18n/messages.ts). Safe without a provider. */
export function useMessages<M extends Messages>(catalog: Catalog<M>): M {
  const { language } = useOptionalLanguage()
  return messagesFor(catalog, language)
}
