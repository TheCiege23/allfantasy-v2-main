'use client'

import { useEffect } from 'react'
import { Bell } from 'lucide-react'
import { CommissionerPageContainer } from '@/components/commissioner-os/shell/CommissionerPageContainer'
import { Button } from '@/components/ui/button'
import { useCommissionerPlatform } from '@/components/commissioner-os/providers/CommissionerPlatformProvider'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { toolsText } from '@/lib/commissioner-os/i18n/toolsCopy'

/**
 * Notification Center is a platform service, reached primarily via the
 * header's bell icon — never a primary destination in its own right, the
 * same framing Global Search's route uses. This route exists only so the
 * bell (and any other direct link) has somewhere real to resolve to;
 * landing here opens the same panel automatically. If it's dismissed
 * without navigating away, this fallback stays visible with a manual way
 * to reopen it, rather than an empty page.
 */
export default function NotificationsPage() {
  const { openService } = useCommissionerPlatform()
  const { language } = useOptionalLanguage()
  const t = (english: string) => toolsText(english, language)

  useEffect(() => {
    openService('notifications')
  }, [openService])

  return (
    <CommissionerPageContainer>
      <div
        className="flex flex-col items-center gap-3 rounded-[var(--radius-generous)] border px-6 py-16 text-center"
        style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-center rounded-full p-3" style={{ background: 'var(--panel2)', color: 'var(--muted)' }}>
          <Bell size={28} aria-hidden />
        </div>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>
          {t('Notifications')}
        </h1>
        <p className="max-w-md text-sm" style={{ color: 'var(--muted)' }}>
          {t(
            "Notification Center is a platform service, not a module — the inbox for what needs a commissioner's attention across League Health, Recommendations, Automations, Reports, and more, reached from the header's bell icon anywhere in Commissioner OS."
          )}
        </p>
        <Button onClick={() => openService('notifications')}>{t('Open Notifications')}</Button>
      </div>
    </CommissionerPageContainer>
  )
}
