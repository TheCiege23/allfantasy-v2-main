'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { C2CPicksBoard, type C2CPickRow } from '@/app/c2c/components/C2CPicksBoard'
import type { C2CConfigClient } from '@/lib/c2c/c2cUiLabels'

export function C2CPicksClient({ leagueId, rosterId }: { leagueId: string; rosterId: string | null }) {
  const [cfg, setCfg] = useState<C2CConfigClient | null>(null)
  const [picks, setPicks] = useState<C2CPickRow[]>([])
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const c = await fetch(`/api/c2c?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      if (!c.ok) throw new Error('C2C not configured')
      const cj = (await c.json()) as { c2c: C2CConfigClient }
      setCfg(cj.c2c)

      const q = rosterId
        ? `leagueId=${encodeURIComponent(leagueId)}&rosterId=${encodeURIComponent(rosterId)}`
        : `leagueId=${encodeURIComponent(leagueId)}`
      const pr = await fetch(`/api/c2c/picks?${q}`, { credentials: 'include' })
      if (!pr.ok) throw new Error('Picks unavailable')
      const pj = (await pr.json()) as { picks?: C2CPickRow[] }
      setPicks((pj.picks ?? []).map((p) => ({ ...p, pickSide: p.pickSide ?? 'combined' })))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
    }
  }, [leagueId, rosterId])

  useEffect(() => {
    void load()
  }, [load])

  if (err) {
    return <p className="px-4 py-10 text-center text-[13px] text-red-300/90">{err}</p>
  }
  if (!cfg) {
    return <p className="px-4 py-10 text-center text-[13px] text-white/45">Loading…</p>
  }

  const fmt = cfg.futureDraftFormat ?? 'combined'

  return (
    <div className="mx-auto max-w-3xl px-4 pb-12 pt-4">
      <div className="scrollbar-none mb-4 flex gap-2 overflow-x-auto">
        <span className="rounded-full border border-violet-500/35 bg-violet-500/15 px-3 py-1 text-[11px] font-bold uppercase text-violet-100">
          Campus
        </span>
        <span className="rounded-full border border-blue-500/35 bg-blue-500/15 px-3 py-1 text-[11px] font-bold uppercase text-blue-100">
          Canton
        </span>
      </div>

      <C2CPicksBoard picks={picks} format={fmt} />

      <div className="mt-10 overflow-x-auto rounded-xl border border-white/[0.06]">
        <table className="w-full min-w-[480px] text-left text-[11px] text-white/70">
          <thead>
            <tr className="border-b border-white/[0.06] text-white/45">
              <th className="p-2">Team × Round</th>
              <th className="p-2">Side</th>
            </tr>
          </thead>
          <tbody>
            {picks.slice(0, 24).map((p) => (
              <tr key={p.id} className="border-b border-white/[0.04]">
                <td className="p-2 font-mono text-white/80">
                  {p.currentOwnerId.slice(0, 6)}… · R{p.round}
                </td>
                <td className="p-2">
                  <span
                    className={
                      p.pickSide === 'campus'
                        ? 'text-violet-300'
                        : p.pickSide === 'canton'
                          ? 'text-blue-300'
                          : 'text-white/80'
                    }
                  >
                    {p.pickSide}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Link href={`/league/${leagueId}`} className="mt-8 block text-center text-[12px] text-cyan-300/90">
        ← League hub
      </Link>
    </div>
  )
}
