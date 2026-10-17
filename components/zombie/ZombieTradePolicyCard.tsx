'use client'

import { useCallback, useEffect, useState } from 'react'
import { Lock } from 'lucide-react'

/**
 * Zombie-only trades policy: lock Serum/Weapon trades after games complete (stored in `commissionerUiPrefs`).
 */
export function ZombieTradePolicyCard({ leagueId }: { leagueId: string }) {
  const [locked, setLocked] = useState(false)
  const [commissioner, setCommissioner] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/zombie/league?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      if (!res.ok) return
      const data = (await res.json()) as {
        viewerIsCommissioner?: boolean
        league?: { commissionerUiPrefs?: unknown }
      }
      setCommissioner(Boolean(data.viewerIsCommissioner))
      const prefs = data.league?.commissionerUiPrefs
      if (prefs && typeof prefs === 'object' && !Array.isArray(prefs)) {
        const v = (prefs as Record<string, unknown>).lockSerumWeaponTradesAfterGames
        setLocked(v === true)
      }
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async () => {
    if (!commissioner) return
    const next = !locked
    setLocked(next)
    await fetch('/api/zombie/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        leagueId,
        commissionerUiPrefs: { lockSerumWeaponTradesAfterGames: next },
      }),
    }).catch(() => setLocked(!next))
  }

  return (
    <div className="mb-3 rounded-xl border border-[#39ff14]/20 bg-gradient-to-r from-[#0f1f12]/90 to-[#0a1228] px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#39ff14]/10 text-[#9fe89a]">
          <Lock className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold text-[#c8ffc0]">Zombie item trades</p>
          <p className="mt-1 text-[11px] leading-relaxed text-white/45">
            When enabled, Serums and Weapons cannot be traded after the relevant game window for the week has completed.
            Commissioners can still review history. @chimmy enforces this when configured.
          </p>
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-[11px] text-white/75">
            <input
              type="checkbox"
              className="size-4 rounded border-white/20 bg-black/40 accent-[#39ff14]"
              checked={locked}
              disabled={loading || !commissioner}
              onChange={() => void toggle()}
              data-testid="zombie-lock-item-trades-after-games"
            />
            Do not allow trading Serums and Weapons after games have been completed
          </label>
          {!commissioner ? (
            <p className="mt-2 text-[11px] text-white/35">Only the commissioner can change this policy.</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
