'use client'

import { useState } from 'react'
import type { MemberActivityRow, MemberStatus } from '@/lib/core-app/commissioner/activity'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { hubCopy } from '@/lib/core-app/commissionerHubCopy'

const STATUS_LABEL: Record<MemberStatus, string> = {
  active: 'Active', at_risk: 'Slowing down', inactive: 'Inactive', unknown: 'Can’t tell',
}

export function MemberActivityList({ rows }: { rows: MemberActivityRow[] }) {
  const { language } = useOptionalLanguage()
  const t = (english: string | null | undefined) => hubCopy(english, language)
  const [filter, setFilter] = useState<'all' | 'attention' | 'active'>('all')
  const visible = rows.filter((row) =>
    filter === 'all' || (filter === 'active' ? row.status === 'active' : row.status !== 'active'),
  )

  return (
    <>
      <div className="af-ch-member-filters" role="group" aria-label={t('Filter managers')}>
        {(['all', 'attention', 'active'] as const).map((value) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {value === 'all' ? t('All') : value === 'attention' ? t('Needs attention') : t('Active')}
          </button>
        ))}
      </div>
      <ul className="af-ch-members">
        {visible.map((row, index) => (
          <li key={`${row.name}-${index}`} data-status={row.status}>
            <span className="af-ch-member-name">{row.name}</span>
            <span className="af-ch-member-when">{t(row.detail)}</span>
            <span className="af-ch-member-status af-label" data-status={row.status}>{t(STATUS_LABEL[row.status])}</span>
          </li>
        ))}
      </ul>
      {visible.length === 0 && <p className="af-ch-muted">{t('No managers match this filter.')}</p>}
    </>
  )
}
