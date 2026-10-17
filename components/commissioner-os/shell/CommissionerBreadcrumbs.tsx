'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { useCommissionerNavigation } from '@/components/commissioner-os/providers/CommissionerNavigationProvider'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { commissionerSectionName, shellText } from '@/lib/commissioner-os/i18n/shellCopy'

/**
 * Per the Design Language & Experience System §3: breadcrumbs appear only
 * at depth 2 and depth 3 — this component renders nothing on a depth-1
 * module landing page, where the sidebar already shows where you are.
 */
export function CommissionerBreadcrumbs() {
  const { breadcrumbs } = useCommissionerNavigation()
  const { language } = useOptionalLanguage()
  if (breadcrumbs.length === 0) return null

  return (
    <nav aria-label={shellText('Breadcrumb', language)} className="flex items-center gap-1 px-1 py-2 text-sm" style={{ color: 'var(--muted)' }}>
      {breadcrumbs.map((crumb, index) => {
        const isLast = index === breadcrumbs.length - 1
        return (
          <span key={crumb.href} className="flex items-center gap-1">
            {index > 0 && <ChevronRight size={14} aria-hidden />}
            {isLast ? (
              <span aria-current="page" style={{ color: 'var(--text)' }}>
                {commissionerSectionName(crumb.label, language)}
              </span>
            ) : (
              <Link href={crumb.href} className="focus-ring rounded" style={{ color: 'var(--muted)' }}>
                {commissionerSectionName(crumb.label, language)}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
