'use client'

import { useCallback, useEffect, useState } from 'react'
import { SettingsSection, SettingsRow, Input } from '@/app/league/[leagueId]/tabs/settings/components'
import { getDefaultPayoutRatesForTierLabel } from '@/lib/zombie/payout-tiers'

type PaidConfig = {
  buyInAmount?: number
  commissionerFeeRate?: number
  ultimateSurvivorEnabled?: boolean
  potIsLocked?: boolean
}

export function ZombiePayoutMatrixPanel({
  leagueId,
  tierLabel,
  canEdit,
  isPaid,
}: {
  leagueId: string
  sport?: string
  tierLabel?: string | null
  canEdit: boolean
  isPaid: boolean
}) {
  const d = !canEdit || !isPaid
  const [loading, setLoading] = useState(true)
  const [cfg, setCfg] = useState<PaidConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/zombie/league?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      if (!res.ok) return
      const data = (await res.json()) as { league?: { paidConfig?: PaidConfig | null } }
      setCfg(data.league?.paidConfig ?? null)
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (patch: Record<string, unknown>) => {
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
      if (!res.ok) throw new Error(data.error || 'Payout settings could not be saved.')
      setMessage('Payout settings saved.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Payout settings could not be saved.')
    } finally {
      setSaving(false)
      void load()
    }
  }

  // Only the fee: it is the one rate the payouts read (lib/zombie/seasonOperations.ts).
  const applyTierDefaults = () => {
    const rates = getDefaultPayoutRatesForTierLabel(tierLabel ?? undefined)
    void save({ commissionerFeeRate: rates.commissionerFeeRate })
  }

  if (!isPaid) return null
  if (loading) return <p className="text-[12px] text-white/45">Loading payout matrix…</p>
  if (!cfg) {
    return (
      <p className="text-[11px] text-amber-200/80">
        Paid config will appear after the first paid save. Use buy-in above, then set rates.
      </p>
    )
  }

  const r = cfg

  return (
    <SettingsSection id="zm-payout-matrix" title="Commissioner fee & payouts">
      <p role="status" aria-live="polite" className="mb-2 text-[11px] text-amber-200">{saving ? 'Saving…' : message}</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={d || saving}
          className="rounded-lg border border-cyan-400/25 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100/95 hover:bg-cyan-500/15 disabled:opacity-40"
          onClick={() => applyTierDefaults()}
          data-testid="zombie-payout-tier-defaults"
        >
          Use the {tierLabel ? `${tierLabel} ` : ''}tier fee
        </button>
      </div>
      <SettingsRow
        label="Commissioner fee rate"
        description="Share of the pot retained for hosting (0–1)."
        control={
          <Input
            type="number"
            step="0.01"
            disabled={d}
            className="w-28"
            value={r.commissionerFeeRate ?? 0}
            onChange={(e) => setCfg({ ...r, commissionerFeeRate: Number(e.target.value) || 0 })}
            onBlur={(e) => void save({ commissionerFeeRate: Number(e.target.value) || 0 })}
          />
        }
      />
      {/*
        🛑 FIVE INPUTS HERE MOVED NO MONEY. "Weekly pool rate", "Season / finale rate", "Survivor bonus rate",
        "Tracked total pot" and "Weekly payout pool" saved to ZombiePaidConfig and nothing read them: weekly winnings
        are the 2025 settlement transfers (lib/zombie/beta2025Winnings.ts) and the season pot is what is left after
        the fee and weekly winnings (lib/zombie/seasonAccountingPlan.ts). A commissioner who changed them changed
        nothing. They are gone; this says how the money really moves. (2026-11-15, the honest-settings audit.)
      */}
      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-white/60" data-testid="zombie-payout-how-it-works">
        <p className="font-semibold text-white/80">How the money moves</p>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          <li>Each week, winnings move between teams by result: infections, maulings, bashings and weekly loot.</li>
          <li>The commissioner fee above comes off the collected pot.</li>
          <li>At season&apos;s end, what&apos;s left after the fee and weekly winnings is split among the Survivors.</li>
        </ul>
      </div>
    </SettingsSection>
  )
}
