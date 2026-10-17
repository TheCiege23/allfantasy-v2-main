'use client'

import { useCallback, useEffect, useState } from 'react'
import { SettingsSection, SettingsRow, Input } from '@/app/league/[leagueId]/tabs/settings/components'
import { getDefaultPayoutRatesForTierLabel, describePayoutTierContext } from '@/lib/zombie/payout-tiers'

type PaidConfig = {
  buyInAmount?: number
  totalPot?: number
  weeklyPayoutPool?: number
  weeklyPayoutRate?: number
  seasonPayoutRate?: number
  survivorBonusRate?: number
  commissionerFeeRate?: number
  ultimateSurvivorEnabled?: boolean
  potIsLocked?: boolean
}

export function ZombiePayoutMatrixPanel({
  leagueId,
  sport,
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
    await fetch('/api/zombie/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ leagueId, ...patch }),
    }).catch(() => {})
    void load()
  }

  const applyTierDefaults = () => {
    const rates = getDefaultPayoutRatesForTierLabel(tierLabel ?? undefined)
    void save({
      weeklyPayoutRate: rates.weeklyPayoutRate,
      seasonPayoutRate: rates.seasonPayoutRate,
      survivorBonusRate: rates.survivorBonusRate,
      commissionerFeeRate: rates.commissionerFeeRate,
    })
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
    <SettingsSection id="zm-payout-matrix" title="Weekly & season payout split">
      <p className="mb-3 text-[11px] leading-relaxed text-white/45">{describePayoutTierContext(sport)}</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={d}
          className="rounded-lg border border-cyan-400/25 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100/95 hover:bg-cyan-500/15 disabled:opacity-40"
          onClick={() => applyTierDefaults()}
          data-testid="zombie-payout-tier-defaults"
        >
          Apply {tierLabel ? `${tierLabel} ` : ''}tier defaults
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
      <SettingsRow
        label="Weekly pool rate"
        description="Fraction of post-fee pot allocated across weekly winners."
        control={
          <Input
            type="number"
            step="0.01"
            disabled={d}
            className="w-28"
            value={r.weeklyPayoutRate ?? 0}
            onChange={(e) => setCfg({ ...r, weeklyPayoutRate: Number(e.target.value) || 0 })}
            onBlur={(e) => void save({ weeklyPayoutRate: Number(e.target.value) || 0 })}
          />
        }
      />
      <SettingsRow
        label="Season / finale rate"
        description="Endgame pot (sole survivor stack) before ultimate bonus slice."
        control={
          <Input
            type="number"
            step="0.01"
            disabled={d}
            className="w-28"
            value={r.seasonPayoutRate ?? 0}
            onChange={(e) => setCfg({ ...r, seasonPayoutRate: Number(e.target.value) || 0 })}
            onBlur={(e) => void save({ seasonPayoutRate: Number(e.target.value) || 0 })}
          />
        }
      />
      <SettingsRow
        label="Survivor bonus rate"
        description="Horde / streak bonuses — should align with ultimate survivor toggle."
        control={
          <Input
            type="number"
            step="0.01"
            disabled={d}
            className="w-28"
            value={r.survivorBonusRate ?? 0}
            onChange={(e) => setCfg({ ...r, survivorBonusRate: Number(e.target.value) || 0 })}
            onBlur={(e) => void save({ survivorBonusRate: Number(e.target.value) || 0 })}
          />
        }
      />
      <SettingsRow
        label="Tracked total pot ($)"
        description="Optional ledger total — does not move money automatically."
        control={
          <Input
            type="number"
            step="1"
            disabled={d}
            className="w-32"
            value={r.totalPot ?? 0}
            onChange={(e) => setCfg({ ...r, totalPot: Number(e.target.value) || 0 })}
            onBlur={(e) => void save({ totalPot: Number(e.target.value) || 0 })}
          />
        }
      />
      <SettingsRow
        label="Weekly payout pool ($)"
        description="Snapshot for weekly distribution display."
        control={
          <Input
            type="number"
            step="1"
            disabled={d}
            className="w-32"
            value={r.weeklyPayoutPool ?? 0}
            onChange={(e) => setCfg({ ...r, weeklyPayoutPool: Number(e.target.value) || 0 })}
            onBlur={(e) => void save({ weeklyPayoutPool: Number(e.target.value) || 0 })}
          />
        }
      />
    </SettingsSection>
  )
}
