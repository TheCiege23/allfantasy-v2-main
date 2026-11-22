'use client'

import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { ZombieUpdatesPanel } from '@/app/zombie/components/commissioner/ZombieUpdatesPanel'
import { ZombieAutomationPanel } from '@/app/zombie/components/commissioner/ZombieAutomationPanel'
import { ZombieAuditLogPanel } from '@/app/zombie/components/commissioner/ZombieAuditLogPanel'
import { ZombieOverridePanel } from '@/app/zombie/components/commissioner/ZombieOverridePanel'
import { ZombiePaidPanel } from '@/app/zombie/components/commissioner/ZombiePaidPanel'

type Tab = 'updates' | 'automation' | 'overrides' | 'audit' | 'paid'

export default function ZombieSettingsPage() {
  const params = useParams<{ leagueId: string }>()
  const leagueId = params?.leagueId ?? ''
  const [tab, setTab] = useState<Tab>('updates')
  const [isCommissioner, setIsCommissioner] = useState(false)
  const [leagueName, setLeagueName] = useState('Zombie League')
  const [isPaid, setIsPaid] = useState(false)

  useEffect(() => {
    if (!leagueId) return

    fetch(`/api/zombie/league?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { league?: { name?: string; isPaid?: boolean }; viewerIsCommissioner?: boolean } | null) => {
        if (d?.viewerIsCommissioner) setIsCommissioner(true)
        if (d?.league?.name) setLeagueName(d.league.name)
        if (d?.league?.isPaid) setIsPaid(d.league.isPaid)
      })
      .catch(() => null)
  }, [leagueId])

  if (!leagueId) {
    return null
  }

  if (!isCommissioner) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <p className="text-[13px] text-[var(--zombie-text-dim)]">
          Commissioner access required.
        </p>
      </div>
    )
  }

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'updates', label: 'Weekly Updates', icon: '📝' },
    { id: 'automation', label: 'Automation', icon: '⚙️' },
    { id: 'overrides', label: 'Overrides', icon: '🔧' },
    { id: 'audit', label: 'Audit Log', icon: '📋' },
    { id: 'paid', label: isPaid ? 'Paid Mode' : 'Free Mode', icon: isPaid ? '💰' : '🏅' },
  ]

  return (
    <div className="mx-auto max-w-4xl">
      {/* Header */}
      <div className="mb-4 rounded-2xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--zombie-text-dim)]">
          Commissioner Settings
        </p>
        <h1 className="mt-1 text-xl font-black text-[var(--zombie-text-full)]">{leagueName}</h1>
        <p className="mt-1 text-[12px] text-[var(--zombie-text-mid)]">
          Manage automation, weekly updates, overrides, and audit logs.
        </p>
      </div>

      {/* Tab nav */}
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={clsx(
              'flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-semibold whitespace-nowrap transition-colors',
              tab === t.id
                ? 'bg-zombie-crimson/15 text-[var(--zombie-crimson)]'
                : 'text-[var(--zombie-text-dim)] hover:text-[var(--zombie-text-mid)]',
            )}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="rounded-2xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)]">
        {tab === 'updates' && <ZombieUpdatesPanel leagueId={leagueId} canEdit />}
        {tab === 'automation' && <ZombieAutomationPanel leagueId={leagueId} canEdit />}
        {tab === 'overrides' && <ZombieOverridePanel leagueId={leagueId} canEdit />}
        {tab === 'audit' && <ZombieAuditLogPanel leagueId={leagueId} canEdit />}
        {/*
          🛑 THIS TAB HAD ITS OWN FORM, AND IT COULD NOT WORK: it loaded with a GET /api/zombie/settings does not have
          (so it always showed defaults) and saved `commissionerFee`, a field the route drops. It now shows the same
          paid/free panel the league's commissioner settings use, which loads and saves the real values.
        */}
        {tab === 'paid' && <ZombiePaidPanel leagueId={leagueId} canEdit />}
      </div>
    </div>
  )
}
