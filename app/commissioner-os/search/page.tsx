'use client'

import { useEffect } from 'react'
import { Search } from 'lucide-react'
import { CommissionerPageContainer } from '@/components/commissioner-os/shell/CommissionerPageContainer'
import { Button } from '@/components/ui/button'
import { useCommissionerPlatform } from '@/components/commissioner-os/providers/CommissionerPlatformProvider'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { toolsText } from '@/lib/commissioner-os/i18n/toolsCopy'

/**
 * Global Search & Command Palette is a platform service, reached
 * primarily via the header's search button or ⌘K/Ctrl+K from anywhere in
 * Commissioner OS — never a primary destination in its own right. This
 * route exists only so the header's search affordance (and any other
 * direct link) has somewhere real to resolve to; landing here opens the
 * same palette automatically. If it's dismissed without navigating away,
 * this fallback stays visible with a manual way to reopen it, rather
 * than an empty page.
 */
export default function SearchPage() {
  const { openService } = useCommissionerPlatform()
  const { language } = useOptionalLanguage()
  const t = (english: string) => toolsText(english, language)

  useEffect(() => {
    openService('search')
  }, [openService])

  return (
    <CommissionerPageContainer>
      <div
        className="flex flex-col items-center gap-3 rounded-[var(--radius-generous)] border px-6 py-16 text-center"
        style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-center rounded-full p-3" style={{ background: 'var(--panel2)', color: 'var(--muted)' }}>
          <Search size={28} aria-hidden />
        </div>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>
          {t('Search')}
        </h1>
        <p className="max-w-md text-sm" style={{ color: 'var(--muted)' }}>
          {t(
            'Global Search & Command Palette is a platform service, not a module — find anything across recommendations, managers, tasks, reports, and automations from the header search button or ⌘K/Ctrl+K, anywhere in Commissioner OS.'
          )}
        </p>
        <Button onClick={() => openService('search')}>{t('Open Search')}</Button>
      </div>
    </CommissionerPageContainer>
  )
}
