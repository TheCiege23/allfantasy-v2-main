'use client'

import { CommissionerPageContainer } from '@/components/commissioner-os/shell/CommissionerPageContainer'
import { CoreDepthLock } from '@/components/core-app/CoreDepthLock'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { cosLockSubjectText } from '@/lib/commissioner-os/i18n/shellCopy'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'

/**
 * A Commissioner OS page the viewer's plan does not include — lib/commissioner-ui/commissionerOsDepth.ts.
 *
 * Spanish (2026-10-06): a client component so it can read the reader's language; the lock's words
 * are `coreDepthLockCopy`'s (through CoreDepthLock's `lang`) and the page's subject is translated by
 * `cosLockSubjectText`. WORDS ONLY — the page decided `access` on the server, and nothing here reads
 * the language to decide anything else.
 */
export function CommissionerDepthLocked({ access, what }: { access: CoreDepthAccess; what: string }) {
  const { language } = useOptionalLanguage()
  return (
    <CommissionerPageContainer variant="reading">
      <CoreDepthLock access={access} what={cosLockSubjectText(what, language)} lang={language} />
    </CommissionerPageContainer>
  )
}
