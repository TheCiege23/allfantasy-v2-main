'use client'

import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { ZombieUpdatesPanel } from '@/app/zombie/components/commissioner/ZombieUpdatesPanel'
import { ZombieAutomationPanel } from '@/app/zombie/components/commissioner/ZombieAutomationPanel'
import { ZombieAuditLogPanel } from '@/app/zombie/components/commissioner/ZombieAuditLogPanel'
import { ZombieOverridePanel } from '@/app/zombie/components/commissioner/ZombieOverridePanel'

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
                ? 'bg-[var(--zombie-crimson)]/15 text-[var(--zombie-crimson)]'
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
        {tab === 'paid' && <ZombiePaidFreePanel leagueId={leagueId} isPaid={isPaid} canEdit />}
      </div>
    </div>
  )
}

function ZombiePaidFreePanel({ leagueId, isPaid, canEdit }: { leagueId: string; isPaid: boolean; canEdit: boolean }) {
  const [mode, setMode] = useState(isPaid ? 'paid' : 'free')
  const [buyIn, setBuyIn] = useState('0')
  const [fee, setFee] = useState('0')
  const [currencyLabel, setCurrencyLabel] = useState('Outbreak Points')
  const [weeklyPayouts, setWeeklyPayouts] = useState(true)
  const [ultimatePot, setUltimatePot] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    fetch(`/api/zombie/settings?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Record<string, unknown> | null) => {
        if (!d) return
        if (typeof d.buyInAmount === 'number') setBuyIn(String(d.buyInAmount))
        if (typeof d.commissionerFee === 'number') setFee(String(d.commissionerFee))
        if (typeof d.isPaid === 'boolean') setMode(d.isPaid ? 'paid' : 'free')
        if (typeof d.currencyLabel === 'string') setCurrencyLabel(d.currencyLabel)
        if (typeof d.weeklyPayoutEnabled === 'boolean') setWeeklyPayouts(d.weeklyPayoutEnabled)
        if (typeof d.ultimateSurvivorPot === 'boolean') setUltimatePot(d.ultimateSurvivorPot)
      })
      .catch(() => null)
  }, [leagueId])

  async function save() {
    setStatus('Saving...')
    const r = await fetch('/api/zombie/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        leagueId,
        isPaid: mode === 'paid',
        buyInAmount: parseFloat(buyIn),
        commissionerFee: parseFloat(fee),
        currencyLabel,
        weeklyPayoutEnabled: weeklyPayouts,
        ultimateSurvivorPot: ultimatePot,
      }),
    })
    setStatus(r.ok ? 'Saved' : 'Save failed')
    setTimeout(() => setStatus(''), 3000)
  }

  return (
    <div className="px-6 py-5 text-[13px] text-white/85">
      {/* Mode selector */}
      <div className="mb-5 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setMode('free')}
          disabled={!canEdit}
          className={clsx(
            'rounded-xl border p-4 text-left transition',
            mode === 'free'
              ? 'border-sky-400/40 bg-sky-400/[0.06]'
              : 'border-[var(--zombie-border)] bg-[var(--zombie-panel)] hover:bg-white/[0.02]',
          )}
        >
          <p className="text-lg font-bold">🏅 Free Mode</p>
          <p className="mt-1 text-[11px] text-[var(--zombie-text-mid)]">
            Symbolic points and achievements. No real money involved.
          </p>
        </button>
        <button
          type="button"
          onClick={() => setMode('paid')}
          disabled={!canEdit}
          className={clsx(
            'rounded-xl border p-4 text-left transition',
            mode === 'paid'
              ? 'border-amber-400/40 bg-amber-400/[0.06]'
              : 'border-[var(--zombie-border)] bg-[var(--zombie-panel)] hover:bg-white/[0.02]',
          )}
        >
          <p className="text-lg font-bold">💰 Paid Mode</p>
          <p className="mt-1 text-[11px] text-[var(--zombie-text-mid)]">
            Real buy-ins and pot tracking. Weekly and season payouts.
          </p>
        </button>
      </div>

      {mode === 'paid' ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
            <p className="text-[12px] font-semibold text-amber-200">Paid League Settings</p>
            <p className="mt-1 text-[11px] text-[var(--zombie-text-mid)]">
              All financial tracking is display-only. Actual money handling is between commissioner and players.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] text-[var(--zombie-text-dim)]">Buy-in amount ($)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={buyIn}
                onChange={(e) => setBuyIn(e.target.value)}
                disabled={!canEdit}
                className="w-full rounded-lg border border-[var(--zombie-border)] bg-black/30 px-3 py-2 text-[12px] text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-[var(--zombie-text-dim)]">Commissioner fee (%)</label>
              <input
                type="number"
                min={0}
                max={25}
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                disabled={!canEdit}
                className="w-full rounded-lg border border-[var(--zombie-border)] bg-black/30 px-3 py-2 text-[12px] text-white"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[12px]">Weekly payouts enabled</span>
            <label className="relative inline-flex cursor-pointer items-center">
              <input type="checkbox" checked={weeklyPayouts} onChange={(e) => setWeeklyPayouts(e.target.checked)} disabled={!canEdit} className="peer sr-only" />
              <div className="peer h-5 w-9 rounded-full bg-white/10 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white/60 after:transition-all peer-checked:bg-amber-500/50 peer-checked:after:translate-x-full" />
            </label>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[12px]">Ultimate Survivor pot bonus</span>
            <label className="relative inline-flex cursor-pointer items-center">
              <input type="checkbox" checked={ultimatePot} onChange={(e) => setUltimatePot(e.target.checked)} disabled={!canEdit} className="peer sr-only" />
              <div className="peer h-5 w-9 rounded-full bg-white/10 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white/60 after:transition-all peer-checked:bg-amber-500/50 peer-checked:after:translate-x-full" />
            </label>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-sky-400/20 bg-sky-400/[0.04] p-4">
            <p className="text-[12px] font-semibold text-sky-200">Free League Settings</p>
            <p className="mt-1 text-[11px] text-[var(--zombie-text-mid)]">
              All rewards are symbolic. Same gameplay mechanics as paid mode without real money.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-[var(--zombie-text-dim)]">Currency name</label>
            <input
              type="text"
              value={currencyLabel}
              onChange={(e) => setCurrencyLabel(e.target.value)}
              disabled={!canEdit}
              placeholder="Outbreak Points"
              className="w-full rounded-lg border border-[var(--zombie-border)] bg-black/30 px-3 py-2 text-[12px] text-white"
            />
          </div>
          <p className="text-[11px] text-[var(--zombie-text-dim)]">
            Players will see "{currencyLabel}" instead of dollar amounts throughout the league.
          </p>
        </div>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => void save()}
          className="rounded-lg bg-sky-500/25 px-5 py-2 text-[12px] font-semibold text-sky-100 transition hover:bg-sky-500/35 disabled:opacity-40"
        >
          Save payment settings
        </button>
        {status && (
          <span className={clsx('text-[11px]', status.includes('fail') ? 'text-red-400' : 'text-white/50')}>
            {status}
          </span>
        )}
      </div>
    </div>
  )
}
