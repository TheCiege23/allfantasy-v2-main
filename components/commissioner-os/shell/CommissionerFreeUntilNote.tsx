'use client'

import { FreeUntilNote } from '@/components/core-app/CoreDepthLock'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'

/**
 * The "Free until Oct 15 — then AF Commissioner" note for a Commissioner OS page, in the reader's
 * language. The pages are server components and must not decide the language themselves, so they
 * render this instead of `FreeUntilNote` directly; the words are `coreDepthLockCopy`'s.
 */
export function CommissionerFreeUntilNote({ access }: { access: CoreDepthAccess }) {
  const { language } = useOptionalLanguage()
  return <FreeUntilNote access={access} lang={language} />
}
