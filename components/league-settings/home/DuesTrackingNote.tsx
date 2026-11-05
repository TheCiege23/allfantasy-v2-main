'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * The one sentence every dues surface owes the commissioner: AllFantasy records who has paid, and
 * that is all. It never holds entry fees or pays winnings (owner's ruling, 2026-11-01).
 */
export function DuesTrackingNote() {
  const { t } = useOptionalLanguage()
  return (
    <p className="cc-dues-note" data-testid="dues-tracking-note">
      {t('lsh.cc.duesNote')}
    </p>
  )
}
