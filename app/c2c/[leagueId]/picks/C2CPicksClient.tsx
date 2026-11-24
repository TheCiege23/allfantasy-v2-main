'use client'

import { useCallback, useEffect, useState } from 'react'
import { C2CPicksBoard, type C2CPickRow } from '@/app/c2c/components/C2CPicksBoard'
import type { C2CConfigClient } from '@/lib/c2c/c2cUiLabels'

export function C2CPicksClient({ leagueId, rosterId }: { leagueId: string; rosterId: string | null }) {
  const [cfg, setCfg] = useState<C2CConfigClient | null>(null)
  const [picks, setPicks] = useState<C2CPickRow[]>([])
  /** Pick owners are roster ids; the season's rosters carry their team names. */
  const [teamNames, setTeamNames] = useState<Record<string, string>>({})
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
      // Names only — a failure here leaves the picks readable with a generic label.
      fetch(`/api/redraft/season?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .then((sj: { season?: { rosters?: { id: string; teamName?: string | null }[] } } | null) => {
          const names: Record<string, string> = {}
          for (const r of sj?.season?.rosters ?? []) if (r.teamName) names[r.id] = r.teamName
          setTeamNames(names)
        })
        .catch(() => {})

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
    return <p className="px-4 py-10 text-center text-[13px] text-[var(--bad)]">{err}</p>
  }
  if (!cfg) {
    return <p className="px-4 py-10 text-center text-[13px] text-[var(--muted)]">Loading picks…</p>
  }

  const fmt = cfg.futureDraftFormat ?? 'combined'
  const teamLabel = (ownerRosterId: string) => teamNames[ownerRosterId] ?? (ownerRosterId === rosterId ? 'your team' : 'another team')

  return (
    <div className="mx-auto max-w-6xl px-4 pb-12 pt-4">
      <p className="mb-4 text-[13px] text-[var(--text2)]">Your future draft picks. Picks you got in a trade say who they came from.</p>
      <C2CPicksBoard picks={picks} format={fmt} teamLabel={teamLabel} />
    </div>
  )
}
