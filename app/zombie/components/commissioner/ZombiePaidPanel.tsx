'use client'

import { useCallback, useEffect, useState } from 'react'
import { SettingsSection, SettingsRow, Input } from '@/app/league/[leagueId]/tabs/settings/components'
import { ZombiePaymentTrackerGrid } from '@/app/zombie/components/commissioner/ZombiePaymentTrackerGrid'
import { ZombieExternalPayoutPanel } from '@/app/zombie/components/commissioner/ZombieExternalPayoutPanel'
import { ZombiePayoutMatrixPanel } from '@/app/zombie/components/commissioner/ZombiePayoutMatrixPanel'

type Prefs = {
  leaguesafeUrl?: string
  fancredUrl?: string
  primaryPayment?: 'leaguesafe' | 'fancred'
}

export function ZombiePaidPanel({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const d = !canEdit
  const [loading, setLoading] = useState(true)
  const [paid, setPaid] = useState(false)
  const [buyIn, setBuyIn] = useState<number>(0)
  const [prefs, setPrefs] = useState<Prefs>({})
  const [currencyLabel, setCurrencyLabel] = useState('Outbreak Points')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [sport, setSport] = useState('NFL')
  const [tierLabel, setTierLabel] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/zombie/league?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      if (!res.ok) return
      const data = (await res.json()) as {
        league?: {
          isPaid?: boolean
          buyInAmount?: number | null
          commissionerUiPrefs?: unknown
          freeRewardConfig?: { currencyLabel?: string | null } | null
          sport?: string
          level?: { tierLabel?: string | null } | null
        }
      }
      const L = data.league
      if (L) {
        setPaid(Boolean(L.isPaid))
        setBuyIn(typeof L.buyInAmount === 'number' ? L.buyInAmount : 0)
        setCurrencyLabel(L.freeRewardConfig?.currencyLabel || 'Outbreak Points')
        if (typeof L.sport === 'string') setSport(L.sport)
        const tl = L.level && typeof L.level === 'object' ? L.level.tierLabel : null
        setTierLabel(typeof tl === 'string' ? tl : null)
        const raw = L.commissionerUiPrefs
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          const p = raw as Record<string, unknown>
          setPrefs({
            leaguesafeUrl: typeof p.leaguesafeUrl === 'string' ? p.leaguesafeUrl : '',
            fancredUrl: typeof p.fancredUrl === 'string' ? p.fancredUrl : '',
            primaryPayment: p.primaryPayment === 'fancred' ? 'fancred' : 'leaguesafe',
          })
        }
      }
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  const saveZombie = async (patch: Record<string, unknown>) => {
    setSaving(true)
    setMessage('')
    try {
      const res = await fetch('/api/zombie/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ leagueId, ...patch }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(data.error || 'Settings could not be saved.')
      setMessage('Settings saved.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Settings could not be saved.')
      void load()
    } finally {
      setSaving(false)
    }
  }

  const savePrefs = async (next: Prefs) => {
    setPrefs(next)
    await saveZombie({
      commissionerUiPrefs: {
        leaguesafeUrl: next.leaguesafeUrl,
        fancredUrl: next.fancredUrl,
        primaryPayment: next.primaryPayment,
      },
    })
  }

  return (
    <div className="space-y-5 px-6 py-6 text-[13px] text-white/85">
      <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[11px] leading-relaxed text-amber-100/90">
        <p className="font-semibold uppercase tracking-[0.14em] text-amber-200/90">Zombie rules</p>
        <p className="mt-1 text-amber-100/85">
          Playoffs are disabled for Zombie leagues. Snake drafts only (no auction). Paid leagues route through LeagueSafe or Fancred — direct Stripe checkout is not supported.
        </p>
      </div>
      <p className="text-[11px] text-[#9fe89a]/90">
        Payment mode is configured here — not during league creation. Free leagues hide payouts and payment tracking.
      </p>
      <p role="status" aria-live="polite" className="min-h-[20px] text-[11px] text-amber-200">
        {saving ? 'Saving…' : message}
      </p>
      {loading ? (
        <p className="text-white/45">Loading…</p>
      ) : (
        <>
          <SettingsSection id="zm-payment-mode" title="League payment mode">
            <SettingsRow
              label="Mode"
              description="Free = survival gameplay without money modules. Paid = buy-in, payouts, and external payment links."
              control={
                <select
                  className="rounded-lg border border-white/15 bg-[#050a18] px-2 py-1.5 text-white disabled:opacity-50"
                  value={paid ? 'paid' : 'free'}
                  disabled={d || saving}
                  onChange={(e) => {
                    const next = e.target.value === 'paid'
                    if (next && buyIn <= 0) {
                      setMessage('Enter a buy-in greater than zero before switching to Paid.')
                      return
                    }
                    setPaid(next)
                    void saveZombie({ isPaid: next, buyInAmount: buyIn })
                  }}
                  data-testid="zombie-payment-mode"
                >
                  <option value="free">Free</option>
                  <option value="paid">Paid</option>
                </select>
              }
            />
            <SettingsRow
                  label="Buy-in ($)"
                  control={
                    <Input
                      type="number"
                      disabled={d}
                      className="w-32"
                      value={buyIn}
                      onChange={(e) => setBuyIn(Number(e.target.value) || 0)}
                      min={0.01}
                      step={0.01}
                      onBlur={() => { if (paid) void saveZombie({ buyInAmount: buyIn }) }}
                    />
                  }
                />
          </SettingsSection>

          {paid ? (
            <>
              <SettingsSection id="zm-buyin" title="Buy-in & links">
                <SettingsRow
                  label="Primary button"
                  control={
                    <select
                      className="rounded-lg border border-white/15 bg-[#050a18] px-2 py-1 text-[12px] text-white"
                      value={prefs.primaryPayment ?? 'leaguesafe'}
                      disabled={d}
                      onChange={(e) =>
                        void savePrefs({
                          ...prefs,
                          primaryPayment: e.target.value === 'fancred' ? 'fancred' : 'leaguesafe',
                        })
                      }
                    >
                      <option value="leaguesafe">LeagueSafe</option>
                      <option value="fancred">Fancred</option>
                    </select>
                  }
                />
                <SettingsRow
                  label="LeagueSafe URL"
                  control={
                    <Input
                      className="max-w-md"
                      disabled={d}
                      placeholder="https://www.leaguesafe.com/join/..."
                      value={prefs.leaguesafeUrl ?? ''}
                      onChange={(e) => setPrefs({ ...prefs, leaguesafeUrl: e.target.value })}
                      onBlur={(e) => {
                        const next = { ...prefs, leaguesafeUrl: e.target.value }
                        setPrefs(next)
                        void saveZombie({
                          commissionerUiPrefs: {
                            leaguesafeUrl: next.leaguesafeUrl,
                            fancredUrl: next.fancredUrl,
                            primaryPayment: next.primaryPayment,
                          },
                        })
                      }}
                    />
                  }
                />
                <SettingsRow
                  label="Fancred URL"
                  control={
                    <Input
                      className="max-w-md"
                      disabled={d}
                      placeholder="https://..."
                      value={prefs.fancredUrl ?? ''}
                      onChange={(e) => setPrefs({ ...prefs, fancredUrl: e.target.value })}
                      onBlur={(e) => {
                        const next = { ...prefs, fancredUrl: e.target.value }
                        setPrefs(next)
                        void saveZombie({
                          commissionerUiPrefs: {
                            leaguesafeUrl: next.leaguesafeUrl,
                            fancredUrl: next.fancredUrl,
                            primaryPayment: next.primaryPayment,
                          },
                        })
                      }}
                    />
                  }
                />
              </SettingsSection>
              <ZombiePayoutMatrixPanel
                leagueId={leagueId}
                sport={sport}
                tierLabel={tierLabel}
                canEdit={canEdit}
                isPaid={paid}
              />
              <ZombieExternalPayoutPanel leagueId={leagueId} canEdit={canEdit} />
              <ZombiePaymentTrackerGrid leagueId={leagueId} canEdit={canEdit} />
            </>
          ) : (
            <SettingsSection id="zm-free" title="Free mode">
              <SettingsRow
                label="Cosmetic currency label"
                control={
                  <Input
                    value={currencyLabel}
                    disabled={d || saving}
                    maxLength={40}
                    onChange={(e) => setCurrencyLabel(e.target.value)}
                    onBlur={() => void saveZombie({ currencyLabel: currencyLabel.trim() || 'Outbreak Points' })}
                  />
                }
              />
            </SettingsSection>
          )}
        </>
      )}
    </div>
  )
}
